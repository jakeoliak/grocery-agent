/**
 * Kroger API client — OAuth client credentials + product/location search.
 *
 * Browser usage: import from this module.
 * Script usage: also importable in Node 20+ (no bundler needed).
 *
 * Env vars required:
 *   KROGER_CLIENT_ID, KROGER_CLIENT_SECRET  (scripts via --env-file)
 *   VITE_KROGER_CLIENT_ID, VITE_KROGER_CLIENT_SECRET  (if exposed to Vite frontend)
 */

const BASE_URL = 'https://api.kroger.com/v1'

// Token cache — module-level so it survives across calls in the same process.
let _token = null
let _tokenExpiresAt = 0

function getCredentials() {
  // Support both Node script env vars and Vite-prefixed browser env vars.
  const clientId =
    globalThis.process?.env?.KROGER_CLIENT_ID ||
    import.meta.env?.VITE_KROGER_CLIENT_ID

  const clientSecret =
    globalThis.process?.env?.KROGER_CLIENT_SECRET ||
    import.meta.env?.VITE_KROGER_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing Kroger credentials. Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET.'
    )
  }
  return { clientId, clientSecret }
}

/**
 * Returns a valid OAuth access token, refreshing if expired.
 * Kroger client credentials tokens last 30 minutes.
 */
export async function getAccessToken() {
  if (_token && Date.now() < _tokenExpiresAt - 60_000) return _token

  const { clientId, clientSecret } = getCredentials()
  const credentials = btoa(`${clientId}:${clientSecret}`)

  const res = await fetch(`${BASE_URL}/connect/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: 'grant_type=client_credentials&scope=product.compact',
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kroger token request failed (${res.status}): ${text.slice(0, 300)}`)
  }

  const data = await res.json()
  _token = data.access_token
  _tokenExpiresAt = Date.now() + data.expires_in * 1000
  return _token
}

/**
 * Search for products by term at a specific store location.
 * @param {string} term - Search query (e.g. "chicken breast")
 * @param {string} locationId - Kroger location ID from getStoreLocations()
 * @param {number} limit - Max results (default 10, max 50)
 * @returns {Promise<Array>} Array of product objects with prices
 */
export async function searchProducts(term, locationId, limit = 10) {
  const token = await getAccessToken()
  const params = new URLSearchParams({
    'filter.term': term,
    'filter.locationId': locationId,
    'filter.limit': String(Math.min(limit, 50)),
  })

  const res = await fetch(`${BASE_URL}/products?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kroger product search failed (${res.status}): ${text.slice(0, 300)}`)
  }

  const data = await res.json()
  return (data.data ?? []).map(normalizeProduct)
}

/**
 * Returns nearby Kroger-chain stores for a ZIP code.
 * @param {string} zip - 5-digit ZIP code
 * @param {number} limit - Max results (default 5)
 * @returns {Promise<Array>} Array of store objects { locationId, name, chain, address }
 */
export async function getStoreLocations(zip, limit = 5) {
  const token = await getAccessToken()
  const params = new URLSearchParams({
    'filter.zipCode.near': zip,
    'filter.limit': String(limit),
    'filter.radiusInMiles': '25',
  })

  const res = await fetch(`${BASE_URL}/locations?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kroger location search failed (${res.status}): ${text.slice(0, 300)}`)
  }

  const data = await res.json()
  return (data.data ?? []).map(loc => ({
    locationId: loc.locationId,
    name: loc.name,
    chain: loc.chain,
    address: [loc.address?.addressLine1, loc.address?.city, loc.address?.state]
      .filter(Boolean)
      .join(', '),
  }))
}

function normalizeProduct(p) {
  const item = p.items?.[0] ?? {}
  const price = item.price ?? {}
  return {
    productId: p.productId,
    name: p.description,
    brand: p.brand ?? null,
    category: p.categories?.[0] ?? null,
    size: item.size ?? null,
    // Kroger returns regular and promo prices in dollars
    priceCents: price.regular != null ? Math.round(price.regular * 100) : null,
    salePriceCents: price.promo != null && price.promo > 0
      ? Math.round(price.promo * 100)
      : null,
    upc: p.upc ?? null,
    imageUrl: p.images?.find(i => i.perspective === 'front')?.sizes?.find(s => s.size === 'medium')?.url ?? null,
  }
}
