#!/usr/bin/env node
/**
 * Loads Trader Joe's seed data from data/seed/trader-joes.json into Supabase.
 *
 * Run: node --env-file=.env.local scripts/fetch-trader-joes.js
 *
 * Prices in the JSON are placeholder "0.00" — fill them in before running
 * if you want price data. The script skips inserting a price row when price = 0.
 * See docs/tj-data-collection.md for how to collect prices in-store.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const supabaseUrl = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.')
  console.error('Run: node --env-file=.env.local scripts/fetch-trader-joes.js')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey)

const seedPath = join(__dirname, '../data/seed/trader-joes.json')
const seed = JSON.parse(readFileSync(seedPath, 'utf8'))

async function upsertStore() {
  const { data: existing } = await supabase
    .from('stores')
    .select('id')
    .eq('name', seed.store.name)
    .eq('chain', seed.store.chain)
    .maybeSingle()

  if (existing) return existing

  const { data, error } = await supabase
    .from('stores')
    .insert({ name: seed.store.name, chain: seed.store.chain, location: 'seed' })
    .select()
    .single()

  if (error) throw new Error(`Store upsert failed: ${error.message}`)
  return data
}

async function upsertFood(item) {
  const { data: existing } = await supabase
    .from('foods')
    .select('id')
    .eq('name', item.name)
    .eq('source', 'tj')
    .maybeSingle()

  if (existing) return { food: existing, wasNew: false }

  const { data, error } = await supabase
    .from('foods')
    .insert({
      name: item.name,
      brand: item.brand,
      category: item.category,
      serving_size_g: item.serving_size_g ?? null,
      calories_per_serving: item.calories_per_serving ?? null,
      protein_g: item.protein_g ?? null,
      carbs_g: item.carbs_g ?? null,
      fat_g: item.fat_g ?? null,
      fiber_g: item.fiber_g ?? null,
      micros: {},
      source: 'tj',
      external_id: item.sku ?? null,
    })
    .select()
    .single()

  if (error) throw new Error(`Food insert failed for "${item.name}": ${error.message}`)
  return { food: data, wasNew: true }
}

async function insertPrice(foodId, storeId, item) {
  const priceCents = Math.round(parseFloat(item.price) * 100)
  if (priceCents === 0) return false

  const { error } = await supabase.from('prices').insert({
    food_id: foodId,
    store_id: storeId,
    price_cents: priceCents,
    unit: item.unit ?? null,
    package_size: item.package_size ?? null,
  })

  if (error) throw new Error(`Price insert failed for food ${foodId}: ${error.message}`)
  return true
}

async function run() {
  console.log(`Loading ${seed.items.length} items from ${seedPath}\n`)

  const store = await upsertStore()
  console.log(`Store: "${store.name}" (id: ${store.id})\n`)

  let inserted = 0
  let skipped = 0
  let withPrices = 0
  let errors = 0

  for (const item of seed.items) {
    try {
      const { food, wasNew } = await upsertFood(item)

      if (!wasNew) {
        console.log(`  SKIP  ${item.name} (already exists)`)
        skipped++
        continue
      }

      const hadPrice = await insertPrice(food.id, store.id, item)
      if (hadPrice) withPrices++

      const priceLabel = hadPrice ? `$${item.price}` : 'no price'
      console.log(`  ✓  [${item.category.padEnd(9)}] ${item.name} — ${priceLabel}`)
      inserted++
    } catch (err) {
      console.error(`  ✗  ${item.name}: ${err.message}`)
      errors++
    }
  }

  console.log('\n─────────────────────────────────────────')
  console.log(`  Inserted : ${inserted}`)
  console.log(`  Skipped  : ${skipped} (already in DB)`)
  console.log(`  With price: ${withPrices} (prices in JSON are placeholder 0.00)`)
  console.log(`  Errors   : ${errors}`)
  console.log('─────────────────────────────────────────')

  if (inserted === 0 && skipped === 0) {
    console.warn('\nNo items processed — check your Supabase credentials and schema.')
    process.exit(1)
  }
}

run().catch(err => {
  console.error('\nFatal:', err.message)
  process.exit(1)
})
