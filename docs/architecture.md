# Architecture Overview

> Stub — to be expanded in Week 2.

## High-level

```
Browser (Vite + React + Tailwind)
   │
   ├── Supabase JS client  ──►  Supabase Postgres (RLS enforced)
   │                               ├── stores
   │                               ├── foods
   │                               ├── prices
   │                               └── baskets
   │
   └── Supabase Edge Functions  ──►  Anthropic API (Claude)
                                      Kroger API
                                      Nutritionix API
```

## Data flow

1. Scripts (`scripts/`) seed the database with food and price data.
2. The React frontend queries Supabase directly for foods/prices (public read).
3. Basket creation calls a Supabase Edge Function that invokes Claude to optimise the basket.
4. Baskets are stored in Supabase and are user-scoped via RLS.

## Key files

| Path | Purpose |
|------|---------|
| `src/lib/supabase.js` | Browser Supabase client (anon key) |
| `src/lib/kroger.js` | Kroger API client (OAuth + product search) |
| `src/lib/agent/` | Claude agent logic (Week 2+) |
| `supabase/migrations/` | SQL migrations — apply via Supabase dashboard |
| `supabase/functions/` | Edge Functions (Week 2+) |
| `scripts/` | One-time data loaders — run locally with service role key |
| `data/seed/` | Static seed data (TJ items with placeholder prices) |
