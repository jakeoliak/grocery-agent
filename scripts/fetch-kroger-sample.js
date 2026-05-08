#!/usr/bin/env node
/**
 * Fetches 30 staple items from the nearest Kroger-chain store to ZIP 93117 (Goleta, CA)
 * and inserts them into Supabase.
 *
 * Run: node --env-file=.env.local scripts/fetch-kroger-sample.js
 */

import { createClient } from '@supabase/supabase-js'
import { searchProducts, getStoreLocations } from '../src/lib/kroger.js'

const SAMPLE_ZIP = '93117'

// 30 staple search terms — broad enough that Kroger always returns results
const STAPLE_TERMS = [
  'chicken breast boneless skinless',
  'ground turkey',
  'large eggs',
  'canned tuna water',
  'salmon fillet',
  'black beans canned',
  'peanut butter creamy',
  'rolled oats',
  'brown rice',
  'whole wheat bread',
  'sweet potatoes',
  'russet potatoes',
  'whole wheat pasta',
  'quinoa',
  'corn tortillas',
  'baby spinach',
  'broccoli florets frozen',
  'baby carrots',
  'frozen blueberries',
  'frozen strawberries',
  'bananas',
  'whole milk',
  'low fat cottage cheese',
  'plain greek yogurt',
  'cheddar cheese',
  'extra virgin olive oil',
  'raw almonds',
  'raw walnuts',
  'chia seeds',
  'dark chocolate 70',
]

// Map Kroger category strings to our schema's category enum
function mapCategory(krogerCategory) {
  if (!krogerCategory) return 'other'
  const c = krogerCategory.toLowerCase()
  // dairy checked before protein so "Dairy & Eggs" maps to dairy, not protein
  if (c.includes('dairy') || c.includes('milk') || c.includes('cheese') || c.includes('yogurt')) return 'dairy'
  if (c.includes('meat') || c.includes('poultry') || c.includes('seafood') || c.includes('fish') || c.includes('egg') || c.includes('bean') || c.includes('tofu') || c.includes('protein')) return 'protein'
  if (c.includes('bread') || c.includes('grain') || c.includes('pasta') || c.includes('rice') || c.includes('cereal') || c.includes('oat') || c.includes('tortilla') || c.includes('potato')) return 'carb'
  if (c.includes('oil') || c.includes('nut') || c.includes('butter') || c.includes('seed') || c.includes('fat')) return 'fat'
  if (c.includes('vegetable') || c.includes('produce') || c.includes('greens') || c.includes('salad')) return 'vegetable'
  if (c.includes('fruit') || c.includes('berry') || c.includes('citrus')) return 'fruit'
  if (c.includes('snack') || c.includes('chip') || c.includes('chocolate') || c.includes('candy')) return 'snack'
  if (c.includes('beverage') || c.includes('drink') || c.includes('juice') || c.includes('water')) return 'beverage'
  return 'other'
}

// Heuristic fallback: guess category from product name when Kroger category is unmapped
function mapCategoryFromName(name) {
  const n = name.toLowerCase()
  if (/chicken|turkey|salmon|tuna|egg|beef|pork|tofu|tempeh|edamame|bean/.test(n)) return 'protein'
  if (/rice|oat|bread|pasta|potato|tortilla|quinoa|grain/.test(n)) return 'carb'
  if (/oil|almond|walnut|peanut butter|nut|seed|avocado/.test(n)) return 'fat'
  if (/spinach|broccoli|kale|carrot|pepper|zucchini|brussels/.test(n)) return 'vegetable'
  if (/blueberr|strawberr|mango|banana|apple|lemon|fruit/.test(n)) return 'fruit'
  if (/milk|cheese|yogurt|cottage|kefir/.test(n)) return 'dairy'
  if (/chip|chocolate|snack|bar|popcorn/.test(n)) return 'snack'
  return 'other'
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function checkEnv() {
  const missing = []
  if (!process.env.VITE_SUPABASE_URL) missing.push('VITE_SUPABASE_URL')
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!process.env.KROGER_CLIENT_ID) missing.push('KROGER_CLIENT_ID')
  if (!process.env.KROGER_CLIENT_SECRET) missing.push('KROGER_CLIENT_SECRET')
  if (missing.length) {
    console.error('Missing env vars:', missing.join(', '))
    console.error('Run: node --env-file=.env.local scripts/fetch-kroger-sample.js')
    process.exit(1)
  }
}

async function upsertStore(location) {
  const { data: existing } = await supabase
    .from('stores')
    .select('id')
    .eq('external_id', location.locationId)
    .maybeSingle()

  if (existing) return existing

  const { data, error } = await supabase
    .from('stores')
    .insert({
      name: location.name,
      chain: 'kroger',
      location: location.address,
      external_id: location.locationId,
    })
    .select()
    .single()

  if (error) throw new Error(`Store insert failed: ${error.message}`)
  return data
}

async function insertFoodAndPrice(product, storeId) {
  // Check if food already exists by external_id (productId) + source
  const { data: existing } = await supabase
    .from('foods')
    .select('id')
    .eq('external_id', product.productId)
    .eq('source', 'kroger')
    .maybeSingle()

  if (existing) {
    // Still try to update price
    if (product.priceCents) {
      await supabase.from('prices').insert({
        food_id: existing.id,
        store_id: storeId,
        price_cents: product.priceCents,
        unit: 'each',
        package_size: product.size ?? null,
      })
    }
    return { wasNew: false }
  }

  const rawCategory = product.category
  const category =
    mapCategory(rawCategory) !== 'other'
      ? mapCategory(rawCategory)
      : mapCategoryFromName(product.name)

  const { data: food, error: foodErr } = await supabase
    .from('foods')
    .insert({
      name: product.name,
      brand: product.brand ?? null,
      category,
      serving_size_g: null,
      calories_per_serving: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
      fiber_g: null,
      micros: {},
      source: 'kroger',
      external_id: product.productId,
    })
    .select()
    .single()

  if (foodErr) throw new Error(`Food insert failed: ${foodErr.message}`)

  if (product.priceCents) {
    const { error: priceErr } = await supabase.from('prices').insert({
      food_id: food.id,
      store_id: storeId,
      price_cents: product.priceCents,
      unit: 'each',
      package_size: product.size ?? null,
    })
    if (priceErr) throw new Error(`Price insert failed: ${priceErr.message}`)
  }

  return { wasNew: true }
}

async function run() {
  checkEnv()

  console.log(`Finding nearest Kroger-chain store to ZIP ${SAMPLE_ZIP}...\n`)
  const locations = await getStoreLocations(SAMPLE_ZIP, 3)

  if (!locations.length) {
    console.error('No Kroger locations found near ZIP', SAMPLE_ZIP)
    process.exit(1)
  }

  const location = locations[0]
  console.log(`Store: ${location.name} — ${location.address} (id: ${location.locationId})\n`)

  const store = await upsertStore(location)

  let inserted = 0
  let skipped = 0
  let errors = 0

  for (let i = 0; i < STAPLE_TERMS.length; i++) {
    const term = STAPLE_TERMS[i]
    process.stdout.write(`[${i + 1}/${STAPLE_TERMS.length}] "${term}" ... `)

    try {
      const products = await searchProducts(term, location.locationId, 1)

      if (!products.length) {
        console.log('no results')
        skipped++
      } else {
        const product = products[0]
        const { wasNew } = await insertFoodAndPrice(product, store.id)
        const priceStr = product.priceCents ? `$${(product.priceCents / 100).toFixed(2)}` : 'no price'
        console.log(`${wasNew ? '✓' : 'SKIP (exists)'} ${product.name} — ${priceStr}`)
        wasNew ? inserted++ : skipped++
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`)
      errors++
    }

    // Kroger API doesn't publish a rate limit, but 1 req/sec is safe for free tier
    if (i < STAPLE_TERMS.length - 1) await sleep(1000)
  }

  console.log('\n─────────────────────────────────────────')
  console.log(`  Inserted : ${inserted}`)
  console.log(`  Skipped  : ${skipped}`)
  console.log(`  Errors   : ${errors}`)
  console.log('─────────────────────────────────────────')
}

run().catch(err => {
  console.error('\nFatal:', err.message)
  process.exit(1)
})
