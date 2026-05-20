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

// Curated staples — category is authoritative, never trusted from Kroger's API
const STAPLES = [
  // protein (~25)
  { term: 'chicken breast boneless skinless',  category: 'protein' },
  { term: 'chicken thigh boneless',            category: 'protein' },
  { term: 'ground turkey',                     category: 'protein' },
  { term: 'ground beef 93 lean',               category: 'protein' },
  { term: 'salmon fillet',                     category: 'protein' },
  { term: 'tilapia fillet',                    category: 'protein' },
  { term: 'canned tuna water',                 category: 'protein' },
  { term: 'canned salmon',                     category: 'protein' },
  { term: 'canned sardines',                   category: 'protein' },
  { term: 'large eggs',                        category: 'protein' },
  { term: 'egg whites carton',                 category: 'protein' },
  { term: 'black beans canned',               category: 'protein' },
  { term: 'kidney beans canned',              category: 'protein' },
  { term: 'chickpeas canned',                 category: 'protein' },
  { term: 'dried lentils',                    category: 'protein' },
  { term: 'tofu extra firm',                  category: 'protein' },
  { term: 'tempeh',                           category: 'protein' },
  { term: 'edamame frozen shelled',           category: 'protein' },
  { term: 'shrimp frozen peeled',             category: 'protein' },
  { term: 'cod fillet',                       category: 'protein' },
  { term: 'pork tenderloin',                  category: 'protein' },
  { term: 'beef sirloin',                     category: 'protein' },
  { term: 'turkey breast deli',               category: 'protein' },
  { term: 'whey protein powder',              category: 'protein' },
  { term: 'pinto beans canned',              category: 'protein' },

  // carb (~25)
  { term: 'rolled oats',                      category: 'carb' },
  { term: 'quick oats',                       category: 'carb' },
  { term: 'brown rice',                       category: 'carb' },
  { term: 'white rice',                       category: 'carb' },
  { term: 'quinoa',                           category: 'carb' },
  { term: 'whole wheat bread',               category: 'carb' },
  { term: 'whole wheat pasta',               category: 'carb' },
  { term: 'corn tortillas',                  category: 'carb' },
  { term: 'whole wheat tortillas',           category: 'carb' },
  { term: 'sweet potatoes',                  category: 'carb' },
  { term: 'russet potatoes',                 category: 'carb' },
  { term: 'butternut squash',               category: 'carb' },
  { term: 'whole wheat flour',              category: 'carb' },
  { term: 'barley pearled',                 category: 'carb' },
  { term: 'farro',                           category: 'carb' },
  { term: 'millet',                          category: 'carb' },
  { term: 'whole grain cereal',             category: 'carb' },
  { term: 'granola plain',                  category: 'carb' },
  { term: 'rice cakes plain',               category: 'carb' },
  { term: 'whole wheat crackers',           category: 'carb' },
  { term: 'popcorn kernels',               category: 'carb' },
  { term: 'bread sourdough',               category: 'carb' },
  { term: 'couscous',                       category: 'carb' },
  { term: 'brown rice pasta',              category: 'carb' },
  { term: 'acorn squash',                  category: 'carb' },

  // fat (~25)
  { term: 'extra virgin olive oil',         category: 'fat' },
  { term: 'avocado oil',                    category: 'fat' },
  { term: 'coconut oil',                    category: 'fat' },
  { term: 'raw almonds',                    category: 'fat' },
  { term: 'raw walnuts',                    category: 'fat' },
  { term: 'cashews unsalted',              category: 'fat' },
  { term: 'pecans',                         category: 'fat' },
  { term: 'pistachios',                     category: 'fat' },
  { term: 'peanut butter natural',         category: 'fat' },
  { term: 'almond butter',                 category: 'fat' },
  { term: 'tahini',                         category: 'fat' },
  { term: 'chia seeds',                    category: 'fat' },
  { term: 'ground flaxseed',              category: 'fat' },
  { term: 'hemp seeds',                    category: 'fat' },
  { term: 'sunflower seeds',              category: 'fat' },
  { term: 'pumpkin seeds',               category: 'fat' },
  { term: 'dark chocolate 70 percent',   category: 'fat' },
  { term: 'avocados',                     category: 'fat' },
  { term: 'coconut milk full fat',       category: 'fat' },
  { term: 'sesame oil',                  category: 'fat' },
  { term: 'macadamia nuts',             category: 'fat' },
  { term: 'brazil nuts',               category: 'fat' },
  { term: 'ghee',                       category: 'fat' },
  { term: 'olive oil spray',           category: 'fat' },
  { term: 'pine nuts',                 category: 'fat' },

  // vegetable (~25)
  { term: 'baby spinach',               category: 'vegetable' },
  { term: 'kale',                       category: 'vegetable' },
  { term: 'broccoli florets frozen',   category: 'vegetable' },
  { term: 'broccoli fresh',            category: 'vegetable' },
  { term: 'frozen peas',               category: 'vegetable' },
  { term: 'frozen cauliflower',        category: 'vegetable' },
  { term: 'baby carrots',              category: 'vegetable' },
  { term: 'celery',                    category: 'vegetable' },
  { term: 'cucumber',                  category: 'vegetable' },
  { term: 'zucchini',                  category: 'vegetable' },
  { term: 'bell peppers',              category: 'vegetable' },
  { term: 'cherry tomatoes',           category: 'vegetable' },
  { term: 'roma tomatoes',             category: 'vegetable' },
  { term: 'mixed greens',              category: 'vegetable' },
  { term: 'arugula',                   category: 'vegetable' },
  { term: 'brussels sprouts frozen',   category: 'vegetable' },
  { term: 'green beans frozen',        category: 'vegetable' },
  { term: 'asparagus',                 category: 'vegetable' },
  { term: 'baby bella mushrooms',      category: 'vegetable' },
  { term: 'red onion',                 category: 'vegetable' },
  { term: 'garlic',                    category: 'vegetable' },
  { term: 'green cabbage',             category: 'vegetable' },
  { term: 'sugar snap peas',          category: 'vegetable' },
  { term: 'frozen broccoli spinach',  category: 'vegetable' },
  { term: 'sweet corn frozen',        category: 'vegetable' },

  // fruit (~25)
  { term: 'bananas',                   category: 'fruit' },
  { term: 'frozen blueberries',        category: 'fruit' },
  { term: 'frozen strawberries',       category: 'fruit' },
  { term: 'frozen mango chunks',       category: 'fruit' },
  { term: 'frozen mixed berries',      category: 'fruit' },
  { term: 'frozen raspberries',        category: 'fruit' },
  { term: 'frozen peaches',            category: 'fruit' },
  { term: 'gala apples',              category: 'fruit' },
  { term: 'navel oranges',            category: 'fruit' },
  { term: 'lemons',                    category: 'fruit' },
  { term: 'limes',                     category: 'fruit' },
  { term: 'red seedless grapes',      category: 'fruit' },
  { term: 'pineapple chunks fresh',   category: 'fruit' },
  { term: 'kiwi',                      category: 'fruit' },
  { term: 'pears',                     category: 'fruit' },
  { term: 'grapefruit',               category: 'fruit' },
  { term: 'cherries fresh',           category: 'fruit' },
  { term: 'dried cranberries',        category: 'fruit' },
  { term: 'dried apricots',           category: 'fruit' },
  { term: 'raisins',                  category: 'fruit' },
  { term: 'medjool dates',            category: 'fruit' },
  { term: 'plums',                    category: 'fruit' },
  { term: 'watermelon',              category: 'fruit' },
  { term: 'cantaloupe',              category: 'fruit' },
  { term: 'peaches fresh',           category: 'fruit' },

  // dairy (~25)
  { term: 'whole milk',               category: 'dairy' },
  { term: '2 percent milk',           category: 'dairy' },
  { term: 'unsweetened almond milk', category: 'dairy' },
  { term: 'oat milk unsweetened',    category: 'dairy' },
  { term: 'plain greek yogurt',      category: 'dairy' },
  { term: 'plain whole milk yogurt', category: 'dairy' },
  { term: 'low fat cottage cheese',  category: 'dairy' },
  { term: 'cheddar cheese block',    category: 'dairy' },
  { term: 'fresh mozzarella',        category: 'dairy' },
  { term: 'parmesan cheese',         category: 'dairy' },
  { term: 'swiss cheese sliced',     category: 'dairy' },
  { term: 'cream cheese',            category: 'dairy' },
  { term: 'unsalted butter',         category: 'dairy' },
  { term: 'heavy cream',             category: 'dairy' },
  { term: 'sour cream',              category: 'dairy' },
  { term: 'plain kefir',             category: 'dairy' },
  { term: 'ricotta cheese',          category: 'dairy' },
  { term: 'crumbled feta cheese',    category: 'dairy' },
  { term: 'gouda cheese',            category: 'dairy' },
  { term: 'half and half',           category: 'dairy' },
  { term: 'colby jack cheese',       category: 'dairy' },
  { term: 'provolone cheese',        category: 'dairy' },
  { term: 'string cheese',           category: 'dairy' },
  { term: 'shredded mozzarella',     category: 'dairy' },
  { term: 'lactose free whole milk', category: 'dairy' },
]

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

async function insertFoodAndPrice(product, storeId, category) {
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

  for (let i = 0; i < STAPLES.length; i++) {
    const staple = STAPLES[i]
    process.stdout.write(`[${i + 1}/${STAPLES.length}] "${staple.term}" (${staple.category}) ... `)

    try {
      const products = await searchProducts(staple.term, location.locationId, 1)

      if (!products.length) {
        console.log('no results')
        skipped++
      } else {
        const product = products[0]
        const { wasNew } = await insertFoodAndPrice(product, store.id, staple.category)
        const priceStr = product.priceCents ? `$${(product.priceCents / 100).toFixed(2)}` : 'no price'
        console.log(`${wasNew ? '✓' : 'SKIP (exists)'} ${product.name} — ${priceStr}`)
        wasNew ? inserted++ : skipped++
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`)
      errors++
    }

    // Kroger API doesn't publish a rate limit, but 1 req/sec is safe for free tier
    if (i < STAPLES.length - 1) await sleep(1000)
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
