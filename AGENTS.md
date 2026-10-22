# MoodMix

Use the existing checkout; each cloud task is already isolated. Do not create a worktree unless requested.

Next.js App Router, TypeScript, Tailwind CSS. Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`. Start with `npm run dev`. Secrets belong in `.env.local` or hosting settings, never in client code or commits.

On Vercel, protect generation with the native @vercel/firewall check using rate-limit ID moodmix-generation. Fail closed if the rule is missing or the check fails. No database or Redis. Local development skips platform rate limiting; do not claim exact daily quotas or remaining counts. Never automatically retry client generation. Only malformed model output may receive one server retry. Keep API errors free of secrets, raw provider responses, IPs, and user moods. Do not introduce mock playlists into the production experience.
