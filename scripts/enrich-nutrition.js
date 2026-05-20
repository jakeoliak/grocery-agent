#!/usr/bin/env node
/**
 * Enriches foods rows that have null macros using the USDA FoodData Central API.
 *
 * Run: node --env-file=.env.local scripts/enrich-nutrition.js
 *
 * Rate limit: 1 req/sec (FDC free tier is generous but courtesy limit).
 * Foods that don't match cleanly are skipped — no fabricated data is written.
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function checkEnv() {
  const missing = []
  if (!process.env.VITE_SUPABASE_URL) missing.push('VITE_SUPABASE_URL')
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!process.env.FDC_API_KEY) missing.push('FDC_API_KEY')
  if (missing.length) {
    console.error('Missing env vars:', missing.join(', '))
    console.error('Run: node --env-file=.env.local scripts/enrich-nutrition.js')
    process.exit(1)
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Strips brand/packaging noise so FDC can match cleanly.
// e.g. "Kroger® 85/15 Fresh Ground Turkey Tray 3 LB" → "ground turkey"
function cleanName(name) {
  return name
    // strip brand word(s) immediately before ® or ™ (e.g. "Kroger®", "Western Hearth®")
    .replace(/[\w][\w\s'-]*?[®™]/g, '')
    // strip remaining ® ™ © symbols
    .replace(/[®™©]/g, '')
    // strip numeric noise: ratios (85/15), percentages (2%), weight/count units (3 LB, 12 OZ)
    .replace(/\d+\/\d+|\d+\s*%|\d+\s*(?:lb|oz|g|kg|ml|ct|lbs)\b/gi, '')
    // strip common brand names without trademark symbols
    .replace(/\b(?:barilla|bob'?s\s+red\s+mill|western\s+hearth|simple\s+truth|private\s+selection)\b/gi, '')
    // strip packaging, marketing, and descriptor noise
    .replace(/\b(?:organic|raw|frozen|shelled|fresh|low.?fat|reduced\s+fat|unsalted|salted|creamy|crunchy|wild|alaskan|boneless|skinless|virgin|unrefined|extra\s+virgin|gluten.?free|non.?gmo|kosher|old\s+fashioned|wild\s+caught|value\s+pack|big\s+deal|made\s+with|bag\s+salad|tray|fillets?|cut\s+and\s+peeled|long\s+grain|small\s+curd|tender)\b/gi, '')
    // strip punctuation that causes FDC query errors
    .replace(/[!?#@$^&*()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// FDC nutrient ID → output field name. Units are encoded in the field name.
const MICRO_NUTRIENTS = {
  1003: 'protein_g',
  1079: 'fiber_g',
  1004: 'fat_g',
  1258: 'sat_fat_g',
  1093: 'sodium_mg',
  2000: 'sugars_g',
  1087: 'calcium_mg',
  1089: 'iron_mg',
  1092: 'potassium_mg',
}

async function fetchNutrition(foodName) {
  const query = cleanName(foodName)
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${process.env.FDC_API_KEY}&query=${encodeURIComponent(query)}&pageSize=1`
  const res = await fetch(url)

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`FDC search ${res.status}: ${text.slice(0, 200)}`)
  }

  const data = await res.json()
  if (!data.foods || data.foods.length === 0) return null

  const hit = data.foods[0]
  const nutrients = hit.foodNutrients
  const get = id => nutrients.find(n => n.nutrientId === id)?.value ?? null

  return {
    fdcId:                hit.fdcId,
    calories_per_serving: get(1008),
    protein_g:            get(1003),
    fat_g:                get(1004),
    carbs_g:              get(1005),
    fiber_g:              null,
    serving_size_g:       null,
    micros:               {},
  }
}

// Second call: food-detail endpoint returns full foodNutrients with nested nutrient.id
async function fetchMicros(fdcId) {
  const url = `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${process.env.FDC_API_KEY}`
  const res = await fetch(url)

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`FDC detail ${res.status}: ${text.slice(0, 200)}`)
  }

  const data = await res.json()
  const micros = {}

  for (const entry of data.foodNutrients ?? []) {
    const id = entry.nutrient?.id
    const field = MICRO_NUTRIENTS[id]
    if (field && entry.amount != null) {
      micros[field] = entry.amount
    }
  }

  return micros
}

// A result is considered a clean match if calories are present.
// Foods where FDC returns null calories are skipped.
function isCleanMatch(nutrition) {
  return nutrition !== null && nutrition.calories_per_serving !== null
}

async function run() {
  checkEnv()

  // Fetch foods that still have null calories (unenriched)
  const { data: foods, error } = await supabase
    .from('foods')
    .select('id, name, calories_per_serving, micros')
    .is('calories_per_serving', null)
    .order('name')

  if (error) throw new Error(`Supabase fetch failed: ${error.message}`)
  if (foods.length === 0) {
    console.log('No foods need enrichment.')
    return
  }

  console.log(`Enriching ${foods.length} foods (2 reqs/match, 1 req/skip)...\n`)

  let enriched = 0
  let microsPopulated = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < foods.length; i++) {
    const food = foods[i]
    const isLast = i === foods.length - 1
    process.stdout.write(`[${i + 1}/${foods.length}] ${food.name} ... `)

    try {
      const nutrition = await fetchNutrition(food.name)

      if (!isCleanMatch(nutrition)) {
        console.log('SKIP (no clean match)')
        skipped++
        if (!isLast) await sleep(1000)
      } else if (!nutrition.fdcId) {
        console.log('SKIP (no fdcId in search result)')
        skipped++
        if (!isLast) await sleep(1000)
      } else {
        // Second call: fetch detailed micronutrients using fdcId from search result
        const micros = await fetchMicros(nutrition.fdcId)

        const { error: updateErr } = await supabase
          .from('foods')
          .update({
            calories_per_serving: nutrition.calories_per_serving,
            protein_g: nutrition.protein_g,
            carbs_g: nutrition.carbs_g,
            fat_g: nutrition.fat_g,
            fiber_g: nutrition.fiber_g,
            // Only overwrite serving_size_g if we didn't already have one
            ...(food.serving_size_g === null && nutrition.serving_size_g
              ? { serving_size_g: nutrition.serving_size_g }
              : {}),
            micros,
            updated_at: new Date().toISOString(),
          })
          .eq('id', food.id)

        if (updateErr) throw new Error(updateErr.message)
        const microsCount = Object.keys(micros).length
        if (microsCount > 0) microsPopulated++
        console.log(`OK (${nutrition.calories_per_serving} kcal, ${microsCount} micros)`)
        enriched++
        if (!isLast) await sleep(2000)  // 2 reqs made — pace accordingly
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`)
      failed++
      if (!isLast) await sleep(1000)
    }
  }

  console.log('\n─────────────────────────────────────────')
  console.log(`  Enriched        : ${enriched}`)
  console.log(`  Micros populated: ${microsPopulated}`)
  console.log(`  Skipped         : ${skipped} (no clean FDC match)`)
  console.log(`  Failed          : ${failed} (API or DB errors)`)
  console.log('─────────────────────────────────────────')
}

run().catch(err => {
  console.error('\nFatal:', err.message)
  process.exit(1)
})
