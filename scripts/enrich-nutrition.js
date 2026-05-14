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
// e.g. "Organic Boneless Skinless Chicken Breast" → "chicken breast"
function cleanName(name) {
  return name
    .replace(/organic|raw|frozen|shelled|fresh|lowfat|low-fat|reduced fat|unsalted|salted|creamy|crunchy|wild|alaskan|boneless|skinless|virgin|unrefined|extra virgin/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

async function fetchNutrition(foodName) {
  const query = cleanName(foodName)
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${process.env.FDC_API_KEY}&query=${encodeURIComponent(query)}&pageSize=1`
  const res = await fetch(url)

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`FDC ${res.status}: ${text.slice(0, 200)}`)
  }

  const data = await res.json()
  if (!data.foods || data.foods.length === 0) return null

  const nutrients = data.foods[0].foodNutrients
  const get = id => nutrients.find(n => n.nutrientId === id)?.value ?? null

  return {
    calories_per_serving: get(1008),
    protein_g:            get(1003),
    fat_g:                get(1004),
    carbs_g:              get(1005),
    fiber_g:              null,  // FDC ID 1079; not in specified set — leave null
    serving_size_g:       null,  // not reliably present in search results
    micros:               {},
  }
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

  console.log(`Enriching ${foods.length} foods (1 req/sec)...\n`)

  let enriched = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < foods.length; i++) {
    const food = foods[i]
    process.stdout.write(`[${i + 1}/${foods.length}] ${food.name} ... `)

    try {
      const nutrition = await fetchNutrition(food.name)

      if (!isCleanMatch(nutrition)) {
        console.log('SKIP (no clean match)')
        skipped++
      } else {
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
            micros: nutrition.micros,
            updated_at: new Date().toISOString(),
          })
          .eq('id', food.id)

        if (updateErr) throw new Error(updateErr.message)
        console.log(`OK (${nutrition.calories_per_serving} kcal)`)
        enriched++
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`)
      failed++
    }

    // Rate limit: 1 req/sec — skip the sleep after the last item
    if (i < foods.length - 1) await sleep(1000)
  }

  console.log('\n─────────────────────────────────────────')
  console.log(`  Enriched : ${enriched}`)
  console.log(`  Skipped  : ${skipped} (no clean FDC match)`)
  console.log(`  Failed   : ${failed} (API or DB errors)`)
  console.log('─────────────────────────────────────────')
}

run().catch(err => {
  console.error('\nFatal:', err.message)
  process.exit(1)
})
