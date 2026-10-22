# MoodMix

Use the existing checkout; each cloud task is already isolated. Do not create a worktree unless requested.

Next.js App Router, TypeScript, Tailwind CSS. Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`. Start with `npm run dev`. Secrets belong in `.env.local` or hosting settings, never in client code or commits.

Generation must fail closed without working Redis. Maintain the atomic rolling 24-hour quota and count accepted failures. Never automatically retry client generation. Only malformed model output may receive one server retry. Keep API errors free of secrets, raw provider responses, IPs, and user moods. Do not introduce mock playlists into the production experience.
