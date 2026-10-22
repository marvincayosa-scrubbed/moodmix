# MoodMix

Every feeling deserves a soundtrack. Single-page music discovery with Next.js, TypeScript, Tailwind CSS, Gemini, and native Vercel Firewall request limiting. No database, Redis, Upstash, login, or Spotify credentials. Roboto and JetBrains Mono are self-hosted.

## Deploy on Vercel

1. Import this repository using the Next.js preset and Node.js 24.x. Use `npm ci` and `npm run build`.
2. Add `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey) in Project → Settings → Environment Variables. Optionally set `GEMINI_MODEL`; the default is `gemini-2.5-flash`. Use a compatible model available to your Google project. Keep credentials server-side; never use `NEXT_PUBLIC_` names. Remove any old Upstash variables; they are unused.
3. Configure a native **programmatic rate-limit rule** in your Vercel project's **Firewall**, using the **Rate Limit ID / SDK condition** `moodmix-generation`. Set a per-client limit and a duration supported by your plan. The app calls `checkRateLimit('moodmix-generation', { request, timeout: 5000 })` before calling Gemini. Follow [Vercel's SDK guide](https://vercel.com/docs/vercel-waf/rate-limiting-sdk) for the current dashboard controls and plan availability. Enable/enforce the rule rather than leaving it in log-only mode. A normal path-only rule is not a replacement for the required matching SDK rule.
4. Deploy/redeploy. Verify a real request succeeds, then lower the rule's threshold temporarily and confirm further requests are rejected. Restore your intended threshold afterward. Vercel Firewall configuration is a project setting; pushing code does not create or activate it.

The original five-per-rolling-24-hours quota has been replaced by your Vercel rule's semantics. Choose five per day only if your Vercel plan and rule editor support that window; this code does not claim a rolling daily quota. Native rule availability, supported durations, and pricing depend on Vercel's current offering. There is no remaining-count/reset-time API in this SDK, so the UI does not show an exact counter or fabricate a reset time.

On Vercel, missing rules, protection failures, and check timeouts block generation before Gemini is called. If you see “Request protection is not configured yet”, check the rule ID, active domain, deployment, and rule configuration. Rules and deployment protection must allow the SDK's internal request; verify preview deployments separately. The SDK uses Vercel's client identity by default; no application database or IP store is involved.

## Local development

```sh
npm ci --cache /workspace/.npm-cache
cp .env.example .env.local
# Fill in GEMINI_API_KEY securely; don't overwrite existing local configuration.
npm run dev
```

On your own machine, ordinary `npm ci` is sufficient. Node.js 24 is required. Missing Gemini configuration disables generation with a useful message. Platform rate limiting is skipped outside Vercel, including a local production build; the UI labels local development accordingly. Never treat this local behavior as deployed protection. No in-memory counter or localStorage quota is used.

## Validation

```sh
npm test
npm run typecheck
npm run build
npm start
```

Tests use controlled Gemini and native Firewall responses, without credentials or paid requests. Coverage includes input validation, exact unique song counts, artwork matching, exports, retry limits, native rate rejection, missing rules, timeouts, and ensuring rejected requests never call Gemini.

Optional browser checks with the production server running without Gemini credentials, Python Playwright, and Chromium:

```sh
CHROMIUM_PATH=/usr/bin/chromium python tests/browser_smoke.py
```

Browser tests use controlled status/generation/artwork responses, exercise desktop and mobile layouts, copy, TXT/CSV, regeneration, and HTML/JSON rate-limit errors, and preserve the existing playlist after a blocked request. They do not verify a real Vercel rule.

## Behavior

- `POST /api/generate`: JSON `{ "mood": "A nostalgic rainy afternoon", "count": 15 }`. Mood must be nonblank and at most 500 characters. Count must be 10, 15, or 20. Returns validated title, description, and exactly that many unique title/artist pairs.
- `GET /api/status`: Checks Gemini configuration without calling Gemini or consuming a rate-limit check. Returns only `rateLimitMode: "vercel" | "local"`. This is a configuration check, not proof the Firewall rule is active; enforcement happens on POST.
- `GET /api/artwork?title=...&artist=...`: Best-effort iTunes lookup; exact normalized artist/title matches only. Artwork failures never block a playlist. The browser limits concurrency to three and caches lookups in memory for the session.
- Application errors: `{ "error": { "code": "...", "message": "...", "consumed": false } }`. `consumed` indicates the request reached generation, not a precise quota balance. Native rate rejection returns 429. An edge Firewall rule can respond with non-JSON content, which the UI also handles.

Accepted requests may count toward the configured limit even if Gemini fails. No client generation retries occur automatically. Only malformed/incomplete model output gets one internal retry, without a second Firewall check. Authentication failures, provider quota errors, protection failures, and timeouts are not retried automatically.

Copy/export and artwork do not call the programmatic generation limiter. Spotify buttons open searches; AI suggestions are not independently verified on Spotify. Conservative artwork matching prefers a placeholder over unrelated images. Playlists live only in the current page session. Anonymous request limits may be shared by people on the same network.

## Verification limits

Build, type checking, native-SDK API tests with controlled responses, and browser checks run locally. Real Gemini output and an active native Firewall rule require your Vercel account/configuration and are not claimed as verified. Live artwork requests may be blocked by this cloud workspace's network policy. No secrets are bundled.

## Troubleshoot generation errors

The browser console's `502 Bad Gateway` alone does not identify the cause. Open DevTools → Network → the failed `/api/generate` request → Response. Application errors include a safe code and, for rejected Gemini requests, `upstreamStatus`:

- `GEMINI_INVALID_KEY`: check the server-side Gemini key and redeploy after correcting it.
- `GEMINI_ACCESS_DENIED`: check key restrictions, Google project permissions and regional availability.
- `GEMINI_MODEL_NOT_FOUND`: set `GEMINI_MODEL` to a compatible model available to your Google AI Studio project, then redeploy.
- `GEMINI_QUOTA_EXCEEDED`: check Google AI Studio quota and usage. Repeated retries do not restore quota.
- `GEMINI_REQUEST_REJECTED`: check model compatibility with structured JSON output.
- `INVALID_PLAYLIST`: Gemini returned invalid/incomplete output even after the one permitted retry.

`RATE_LIMITED` (429) is the configured Vercel request limit. A non-JSON gateway response may instead be a platform failure; inspect that request in Vercel's runtime logs. Never share API keys or raw environment dumps. Provider response bodies are not exposed to clients.
