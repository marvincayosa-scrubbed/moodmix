# MoodMix

Every feeling deserves a soundtrack. A compact, single-page music discovery app built with Next.js App Router, TypeScript, Tailwind CSS, Lucide, Gemini, and Upstash Redis. Fonts are self-hosted Roboto and JetBrains Mono; no Google Fonts request is needed at build or runtime.

## Deploy on Vercel

1. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey). Check model availability, quotas, and billing in your Google project; free-tier availability is not guaranteed.
2. Create an [Upstash Redis](https://console.upstash.com/) database. Copy its **REST URL** and **REST token** (not the Redis connection string).
3. Import this GitHub repository into Vercel. Use the detected **Next.js** preset, repository root as the root directory, and Node.js **24.x**. The install and build commands are `npm ci` and `npm run build`.
4. Add these variables in Vercel → Project → Settings → Environment Variables for every deployment environment you intend to test:

   | Variable                   | Value                                                                                          |
   | -------------------------- | ---------------------------------------------------------------------------------------------- |
   | `GEMINI_API_KEY`           | Your Gemini API key                                                                            |
   | `GEMINI_MODEL`             | Optional; defaults to `gemini-2.5-flash`. Set to a compatible model available to your project. |
   | `UPSTASH_REDIS_REST_URL`   | HTTPS REST URL from Upstash                                                                    |
   | `UPSTASH_REDIS_REST_TOKEN` | REST token from Upstash                                                                        |

5. Deploy, or **redeploy after adding/changing variables**. Never put these values in client code, chat, GitHub, or `NEXT_PUBLIC_*` variables. There is no API-key input in the public UI.
6. Generate a 10-song playlist and check the count drops to 4. Test copy, TXT/CSV export, Spotify search, and regenerate. Five accepted requests in a rolling 24-hour window should disable generation and return HTTP 429. Artwork is best effort and may remain a placeholder.

No Spotify API key, OAuth, login, application database, or additional configuration service is needed. Upstash is required for quota enforcement, including on Vercel previews. Separate Upstash databases can isolate production and preview quotas.

## Local development

Use Node.js 24 and npm. From the existing checkout:

```sh
npm ci --cache /workspace/.npm-cache
cp .env.example .env.local
# Fill .env.local securely with your own values.
npm run dev
```

The explicit workspace cache is useful in this cloud environment. On your own machine, ordinary `npm ci` works. Do not overwrite an existing `.env.local`. Without credentials, the UI runs and explains that generation is unconfigured; generation fails closed before calling Gemini. Local development uses a single shared `local-development` quota identity because client IP headers outside Vercel are untrusted.

## Validation

```sh
npm test                 # Input/output validation and API tests with controlled upstream responses
npm run typecheck
npm run build
npm start                # Run the production build
```

The automated suite covers exact track counts, duplicate detection, export escaping, safe artwork matching, malformed-output retry limits, provider failures, missing configuration, quota rejection, and charged failures. It does not use real credentials or spend Gemini quota.

Optional real Redis integration test (requires installed `redis-server` and `redis-cli`; starts its own temporary Unix-socket instance):

```sh
npm run test:quota
```

`REDIS_SERVER` and `REDIS_CLI` may override the binary paths. This test submits 30 concurrent reservations, asserts exactly 5 succeed, and verifies rolling expiry and read-only usage checks.

Optional browser smoke test with the production server running and Python Playwright installed:

```sh
CHROMIUM_PATH=/usr/bin/chromium python tests/browser_smoke.py
```

The browser test uses mocked generation/usage/artwork responses and checks form interaction, skeletons, 10/20-song results, clipboard, downloads, regeneration, exhausted limits, and 320px/390px layouts. It expects the server to have no real API credentials for its initial fail-closed check. Screenshots go under `/tmp`.

## API and quota behavior

- `POST /api/generate`: JSON `{ "mood": "A nostalgic rainy afternoon", "count": 15 }`. Mood must be nonblank and at most 500 characters; count must be 10, 15, or 20. Returns validated title, description, exact unique track count, and usage.
- `GET /api/usage`: Reads the authoritative quota without reserving a slot.
- `GET /api/artwork?title=...&artist=...`: Best-effort iTunes lookup. Only exact normalized title **and** artist matches can supply artwork, restricted to HTTPS Apple artwork hosts. Missing matches use a placeholder. The browser runs up to three concurrent lookups and caches results in memory for the session.
- Errors use `{ "error": { "code": "...", "message": "...", "consumed": false }, "usage": { ... } }`. Usage is included when known. HTTP 429 includes `Retry-After` and the earliest next slot time.

Quota is five accepted generation requests per rolling 24 hours, implemented as an atomic Redis Lua sorted-set reservation. It is shared across server instances and survives cold starts. Each accepted attempt is counted even if Gemini fails. There are no refunds or client-side automatic generation retries. Only malformed/incomplete model output receives at most one internal retry, within the same reserved slot. Authentication failures, provider quota errors, timeouts, and quota-store failures are never automatically retried.

On Vercel, the platform-provided `x-forwarded-for` client IP is HMAC-hashed using the server-only Redis token; raw IPs are never stored in quota keys or sent to the browser. This assumes direct Vercel ingress; reassess trusted headers before putting another proxy in front of the app or porting to another host. Rotating the Redis token changes quota keys. People sharing a network may share quota; changing networks may yield a new quota. This is approximate abuse control, not per-person identification. Storage failure blocks generation. Add provider spending caps/alerts for a public launch; IP quotas do not impose a global cost ceiling.

AI recommendations are not independently verified against Spotify; Spotify buttons open searches. Conservative artwork matching may miss valid versions or collaborations rather than display unrelated art. Nothing is persisted as application data; playlists live in the current page session. Copy and export work without additional generation requests.

## Verified here / still requires your deployment

The production build, TypeScript checks, controlled-response API tests, real-Redis atomic quota integration, and Chromium UI smoke checks are validated locally. Live Gemini output, your Upstash credentials, and a Vercel deployment require your account configuration and are not claimed as verified. No real credentials are bundled.
