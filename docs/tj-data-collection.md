# Trader Joe's Price Data Collection

Trader Joe's has no public pricing API and blocks server-side scrapers with Akamai WAF.
Prices are collected manually in-store and entered into `data/seed/trader-joes.json`.

## What you need

- A phone or printed copy of `data/seed/trader-joes.json`
- About 30–45 minutes at your local TJ's
- The shelf tags show the price per package; use that value

## How to fill in prices

1. Open `data/seed/trader-joes.json` in any text editor.
2. For each item, find the product at the store and record the shelf price.
3. Update the `"price"` field from `"0.00"` to the actual price (e.g., `"3.99"`).
4. Also update `"package_size"` if it differs from what's listed (TJ reformulates packaging occasionally).
5. If a product is discontinued or not carried at your store, delete that item from the array.
6. Run the loader to push your prices into Supabase:

```bash
node --env-file=.env.local scripts/fetch-trader-joes.js
```

The script is idempotent — running it again skips foods already in the database.
To update a price, run the SQL directly in the Supabase dashboard:

```sql
update prices
set price_cents = <new_cents>
where food_id = (select id from foods where name = '<item name>' and source = 'tj')
  and store_id = (select id from stores where chain = 'tj');
```

## Adding new items

Append a new object to the `items` array using this shape:

```json
{
  "sku": null,
  "name": "Organic Wild Rice Blend",
  "brand": "Trader Joe's",
  "category": "carb",
  "serving_size_g": 45,
  "calories_per_serving": null,
  "protein_g": null,
  "carbs_g": null,
  "fat_g": null,
  "fiber_g": null,
  "price": "3.49",
  "unit": "each",
  "package_size": "16 oz"
}
```

Valid `category` values: `protein`, `carb`, `fat`, `vegetable`, `fruit`, `dairy`, `snack`, `beverage`, `other`

Leave macro fields as `null` — the Nutritionix enrichment script (`scripts/enrich-nutrition.js`) fills them in automatically.

## SKU field

The `sku` field is optional and can remain `null`. If you want to record the TJ item number
(visible on receipts as a 4–6 digit code), fill it in — it helps identify the product if the
name changes.

## Frequency

Trader Joe's prices rarely change but do shift seasonally. Re-collecting prices every 3–6 months
keeps the data useful. A future improvement (Week 2+) is a Playwright-based browser scraper that
reads prices from traderjoes.com product pages, which do display current pricing.
