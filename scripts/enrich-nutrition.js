#!/usr/bin/env node
/**
 * Enriches foods rows that have null macros using the Nutritionix /v2/natural/nutrients API.
 *
 * Run: node --env-file=.env.local scripts/enrich-nutrition.js
 *
 * Rate limit: 1 req/sec to stay under Nutritionix free tier (500 req/day).
 * Foods that don't match cleanly are skipped — no fabricated data is written.
 */

import { createClient } from '@supabase/supabase-js'

const NUTRITIONIX_URL = 'https://trackapi.nutritionix.com/v2/natural/nutrients'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const nixAppId = process.env.NUTRITIONIX_APP_ID
const nixAppKey = process.env.NUTRITIONIX_APP_KEY

function checkEnv() {
  const missing = []
  if (!process.env.VITE_SUPABASE_URL) missing.push('VITE_SUPABASE_URL')
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!nixAppId) missing.push('NUTRITIONIX_APP_ID')
  if (!nixAppKey) missing.push('NUTRITIONIX_APP_KEY')
  if (missing.length) {
    console.error('Missing env vars:', missing.join(', '))
    console.error('Run: node --env-file=.env.local scripts/enrich-nutrition.js')
    process.exit(1)
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Strips brand/packaging noise so Nutritionix can match cleanly.
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
  const res = await fetch(NUTRITIONIX_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-app-id': nixAppId,
      'x-app-key': nixAppKey,
    },
    body: JSON.stringify({ query }),
  })

  if (res.status === 404) return null
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Nutritionix ${res.status}: ${text.slice(0, 200)}`)
  }

  const data = await res.json()
  if (!data.foods || data.foods.length === 0) return null

  const f = data.foods[0]
  return {
    calories_per_serving: f.nf_calories ?? null,
    protein_g: f.nf_protein ?? null,
    carbs_g: f.nf_total_carbohydrate ?? null,
    fat_g: f.nf_total_fat ?? null,
    fiber_g: f.nf_dietary_fiber ?? null,
    serving_size_g: f.serving_weight_grams ?? null,
    micros: {
      vitamin_c_mg: f.full_nutrients?.find(n => n.attr_id === 401)?.value ?? null,
      iron_mg: f.full_nutrients?.find(n => n.attr_id === 303)?.value ?? null,
      calcium_mg: f.full_nutrients?.find(n => n.attr_id === 301)?.value ?? null,
      potassium_mg: f.full_nutrients?.find(n => n.attr_id === 306)?.value ?? null,
      vitamin_d_mcg: f.full_nutrients?.find(n => n.attr_id === 324)?.value ?? null,
      vitamin_b12_mcg: f.full_nutrients?.find(n => n.attr_id === 418)?.value ?? null,
      omega3_g: f.full_nutrients?.find(n => n.attr_id === 851)?.value ?? null,
    },
  }
}

// A result is considered a clean match if calories are present.
// Foods where Nutritionix returns null calories are skipped.
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
  console.log(`  Skipped  : ${skipped} (no clean Nutritionix match)`)
  console.log(`  Failed   : ${failed} (API or DB errors)`)
  console.log('─────────────────────────────────────────')
}

run().catch(err => {
  console.error('\nFatal:', err.message)
  process.exit(1)
})
