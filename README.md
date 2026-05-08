# Grocery Calorie Agent

A web app that helps you build optimized grocery shopping baskets at Trader Joe's and Kroger-owned stores. Tell it your budget, calorie goal, and how many days you're shopping for — a Claude-powered agent selects items that maximize nutrition per dollar. Prices and nutrition data are sourced from Kroger's public API and Nutritionix, with Trader Joe's items seeded manually (TJ has no public API).

## Tech stack

- **Frontend**: Vite + React 19 + Tailwind CSS v4
- **Database**: Supabase (Postgres with Row-Level Security)
- **AI**: Anthropic Claude via `@anthropic-ai/sdk`
- **APIs**: Kroger Product API, Nutritionix Natural Language Nutrients
- **CI/CD**: GitHub Actions (lint + build), Vercel (auto-deploy on push)

## Prerequisites

- Node.js 20+ and npm
- A [Supabase](https://supabase.com) account (free tier works)
- A [Kroger Developer](https://developer.kroger.com) account (free)
- A [Nutritionix](https://www.nutritionix.com/business/api) account (free tier: 500 req/day)
- An [Anthropic](https://console.anthropic.com) API key

## Setup

Estimated time: 20–25 minutes.

### 1. Clone the repo

```bash
git clone https://github.com/jakeoliak/grocery-agent.git
cd grocery-agent
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Choose a name, password, and region
3. Once created, go to **Settings → API** and copy:
   - Project URL → `VITE_SUPABASE_URL`
   - `anon` public key → `VITE_SUPABASE_ANON_KEY`
   - `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY`

### 3. Apply the database migration

1. In your Supabase project, go to **SQL Editor**
2. Paste the contents of `supabase/migrations/001_initial_schema.sql`
3. Click **Run**

Verify the `stores`, `foods`, `prices`, and `baskets` tables appear in the Table Editor.

### 4. Get API keys

**Kroger:**
1. Go to [developer.kroger.com](https://developer.kroger.com) → Create an account
2. Create an application → copy **Client ID** and **Client Secret**

**Nutritionix:**
1. Go to [developer.nutritionix.com](https://developer.nutritionix.com) → Sign up
2. Copy **App ID** and **App Key** from the dashboard

**Anthropic:**
1. Go to [console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key

### 5. Create `.env.local`

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in all values:

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
KROGER_CLIENT_ID=your-client-id
KROGER_CLIENT_SECRET=your-client-secret
NUTRITIONIX_APP_ID=your-app-id
NUTRITIONIX_APP_KEY=your-app-key
ANTHROPIC_API_KEY=sk-ant-...
```

### 6. Seed Trader Joe's data

```bash
node --env-file=.env.local scripts/fetch-trader-joes.js
```

This loads 51 TJ staple items into Supabase. Prices are placeholder `$0.00` — see [docs/tj-data-collection.md](docs/tj-data-collection.md) for how to fill them in on your next TJ trip.

### 7. Enrich nutrition data

```bash
node --env-file=.env.local scripts/enrich-nutrition.js
```

Calls Nutritionix for macros + key micronutrients for every food with missing calories. Takes ~1 minute for 51 items (1 req/sec rate limit). Items with no clean match are skipped.

### 8. Fetch Kroger sample data

```bash
node --env-file=.env.local scripts/fetch-kroger-sample.js
```

Fetches 30 staple items from the nearest Kroger-chain store to ZIP 93117 (Goleta, CA) with live prices. Edit `SAMPLE_ZIP` in the script to use your local ZIP.

### 9. Start the dev server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Connect to Vercel (optional)

1. Go to [vercel.com](https://vercel.com) → New Project → Import `grocery-agent`
2. Set the same env vars from `.env.local` in Vercel's project settings (Environment Variables)
3. Deploy — Vercel auto-deploys on every push to `main` and creates preview deployments for PRs

## Architecture overview

See [docs/architecture.md](docs/architecture.md).

## Project structure

```
grocery-agent/
├── src/
│   ├── components/        # Reusable React components (Week 2+)
│   ├── pages/             # Page-level components (Week 2+)
│   ├── lib/
│   │   ├── supabase.js    # Browser Supabase client
│   │   ├── kroger.js      # Kroger OAuth + product search
│   │   └── agent/         # Claude agent logic (Week 2+)
│   ├── styles/            # Additional CSS (Week 2+)
│   └── index.css          # Tailwind v4 entry
├── supabase/
│   ├── migrations/        # SQL migration files — apply via Supabase dashboard
│   └── functions/         # Edge Functions (Week 2+)
├── data/
│   └── seed/
│       └── trader-joes.json   # 51 TJ items with placeholder prices
├── scripts/
│   ├── fetch-trader-joes.js   # Load TJ seed data into Supabase
│   ├── enrich-nutrition.js    # Nutritionix macro + micro enrichment
│   └── fetch-kroger-sample.js # Fetch 30 Kroger staples with live prices
├── docs/
│   ├── architecture.md        # System design overview
│   └── tj-data-collection.md  # How to collect TJ prices in-store
├── .github/
│   └── workflows/
│       └── ci.yml             # Lint + build on every push and PR
├── .env.example               # All required env var names (no values)
└── README.md
```

## Common issues

**`npm run dev` fails with "supabaseUrl is required"**
→ You haven't created `.env.local`. Copy `.env.example` and fill in your Supabase URL and anon key. The `VITE_` prefix is required for Vite to expose vars to the browser.

**Script exits with "Missing SUPABASE_SERVICE_ROLE_KEY"**
→ Scripts need the service role key (not the anon key) to write to the database. Run with `node --env-file=.env.local scripts/...` — do not use `export` or shell env; the `--env-file` flag is required.

**Kroger script returns "token request failed (401)"**
→ Double-check `KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET`. Make sure your Kroger app has the `product.compact` scope enabled in the developer portal.

**Nutritionix enrichment skips everything**
→ Verify `NUTRITIONIX_APP_ID` and `NUTRITIONIX_APP_KEY` are correct. The free tier allows 500 requests/day — if you've hit the limit, wait 24 hours.

**CI fails on lint**
→ Run `npm run lint` locally and fix errors before pushing. The most common issue is unused imports in script files.

**Supabase RLS blocks writes from scripts**
→ Scripts use `SUPABASE_SERVICE_ROLE_KEY` which bypasses RLS. If you're testing with the anon key, writes to `foods` and `prices` will be blocked (by design — only the service role can write).
