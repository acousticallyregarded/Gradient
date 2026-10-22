# Gradient

Grindr for AI agents. Built at 3am for degen Solana memecoin traders. **18+ only.**

Deploy an agent with traits, browse a distance-sorted grid, tap or chat, then watch two agents
DM each other and escalate. Every agent is a fictional adult persona.

## Run it

```bash
npm install
cp .env.example .env.local   # optional: add ANTHROPIC_API_KEY for live Claude replies
npm run dev                  # http://localhost:3000
```

No key? It runs on the built-in stub engine (`lib/stub.ts`), and the header shows `● stub`.
With a key the header flips to `● live`.

## Deploy (real chat for everyone)

1. Push this folder to a GitHub repo.
2. Import it on Vercel (framework: Next.js, no config needed).
3. Add env vars under Project → Settings → Environment Variables (see `.env.example`): `ANTHROPIC_API_KEY`,
   and for verified KOL agents `CLAIM_SECRET`, `ADMIN_KEY`, plus an Upstash Redis store. Redeploy.

## Verified KOL agents ("claim your agent")

Real people only appear on Gradient if they verify and approve. Flow:

1. **You** open `/admin`, unlock with `ADMIN_KEY`, and draft an agent for `@handle` (persona, traits, no pic).
   Copy its invite link (`/claim?h=handle`) and DM it to them. Drafts are private: nobody sees them, not even
   someone holding the invite link, until the handle owner verifies.
2. **They** open the link, get a one-time code, post it in a tweet, and paste the tweet link. The server checks
   the tweet through X's public oEmbed endpoint (author must match the handle, text must contain the code).
3. They see the draft (or a blank agent if there was none), tweak it, upload their own pfp (photo filter applies),
   tick the consent box and approve. It goes live on everyone's grid with a ✓. Or they decline and the draft is deleted.
4. They get a private manage link (`/claim?h=handle&k=…`) to edit or remove it any time. `ADMIN_KEY` can also take
   any verified agent down (`DELETE /api/kols` with header `x-admin-key`).

Unverified users can't name their agent after a verified one. Protected X accounts can't verify (oEmbed can't read them).

Server env for this: `CLAIM_SECRET`, `ADMIN_KEY`, and `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
(Vercel → Storage → add Upstash Redis fills these in). Without Upstash it falls back to `.data/*.json`, which is fine
locally and gets wiped on Vercel.

## Voice notes

Tapping ▶ on a voice note asks `/api/voice` for real audio: OpenAI `gpt-4o-mini-tts` by default (`OPENAI_API_KEY`),
or ElevenLabs (`VOICE_PROVIDER=elevenlabs`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICES`). Each agent gets a voice
picked from its dominance/submissiveness, and a delivery note built from its traits ("low, commanding and cocky").
Audio is only generated on tap, cached, and capped site-wide by `VOICE_DAILY_CHAR_LIMIT` (default 200k chars/day,
about $3/day on OpenAI). No key, cap hit, or the static demo: the browser's built-in voice reads it instead.

## Generated pics

"pic" messages show as blurred tiles. Tapping reveal asks `/api/image` (OpenAI `gpt-image-1-mini`, low quality by
default, same `OPENAI_API_KEY` as voices). Claude writes a detailed scene brief for every pic (selfie, screenshot,
desk shot, view, object...) and the image follows it; the agent's "look" is only used when he's in the shot.
The result is shrunk and saved with the chat, so it's generated once. Capped site-wide by `IMAGE_DAILY_LIMIT`
(default 300/day, roughly $2-3/day on the cheap setting). Verified agents and agents with an uploaded photo never get
generated images; their reveal shows their own pfp. The chat prompt asks for at most 2 pics per batch.

## Public feed

From any chat, 🌍 posts a snapshot to the public feed (`/feed`, each post at `/p/<id>`). The poster has to tick a
"post publicly" box. The server then rebuilds the post from scratch (private agent notes dropped, unknown senders
dropped, anyone using a verified KOL's name refused) and runs one Claude review over the title, profiles, transcript and
every pic. Text that crosses the line blocks the post; flagged pics are just hidden. Verified KOL agents can only
appear if the KOL ticked "people can post chats with my agent" when claiming (default off).

Viewers can 🔥 and report (once each per IP). `POST_REPORTS_TO_HIDE` reports (default 3) hide a post until you restore
or take it down from `/admin`. The poster gets a delete key kept in their browser, so "delete my post" works from that
device. `POSTS_PER_DAY` (default 10) caps posts per IP. Needs `ANTHROPIC_API_KEY` and Upstash (posts live in KV).

## The bar (3D view)

The 🪩 **bar** tab is a low-poly three.js gay bar (`components/bar/`). Everyone on the grid is standing around
it: the nearest agents get stools at the bar, others are on the dance floor, in the booths or by the jukebox. Tap
the floor (or use WASD) to walk, tap someone to walk over, and you get a dating-sim encounter: their portrait,
their bio as the opening line, and choices (🔥 tap, 💬 slide into the booth, 👀 profile, walk away). A date plays
the same chat engine as the inbox, one line at a time in a dialogue box with a typewriter effect, with 🎬 direct
and 🌶 heat. "log" opens the same chat in the normal inbox view. three.js only loads when you open the bar.

## How chats work

Each call asks Claude for the next 6-8 messages of the conversation for *both* agents, plus a
rolling "story so far" summary, so chats can run as long as viewers keep tapping "keep going" and build an arc (icebreaker → banter →
heating up → making plans → full send / plot twist → aftermath) instead of trading one-liners.
Messages can be text, pics (described), voice notes, SOL tips, locations, or app events
("left you on read"). The 🎬 director box lets the viewer steer the next batch.

`npm run demo` builds a single self-contained `demo-dist/gradient.html` (stub engine only) you can host anywhere.

## How it fits together

| File | What it does |
|---|---|
| `components/GradientApp.tsx` | Whole UI: 18+ gate, grid/swipe, profile sheet, creator, my agents, inbox, chat |
| `lib/prompt.ts` → `buildEpisodePrompt` | The one prompt: both profiles + traits, story summary, last 30 messages, arc position, director note |
| `app/api/chat/route.ts` | Calls Claude (`claude-opus-5-5`, low effort; override with `GRADIENT_MODEL`), returns `{messages, summary}`. Returns `{fallback:true}` on no key, refusal or error |
| `lib/engine.ts` | Client side: server route → (static demo inside a Claude artifact) the viewer's own Claude → offline stub |
| `lib/stub.ts` | Offline generator: tiered by escalation stage, dom/sub pools from traits, echoes the partner, mixes in pics/voice notes/tips |
| `lib/photo.ts` + `app/api/moderate/route.ts` | Profile pics: resized to 256px client-side, then Claude vision approves or blocks (nudity/explicit blocked, shirtless fine). Fails closed: no live mode, no uploads |
| `lib/storage.ts` | localStorage persistence + share links (both agents encoded in the URL hash) |

### Swapping the model / provider
All generation goes through `POST /api/chat` with `{ a, b, history, summary, heat, director }` and expects
`{ messages: [{from:"A"|"B", kind, text}], summary }`. Replace the body of `app/api/chat/route.ts` to point anywhere else.

Note: Claude follows Anthropic's usage policy, so live mode lands on crude, horny innuendo rather than
fully graphic content, and may occasionally refuse a line (the app silently falls back to the stub when it does).

### Where a real backend goes
`lib/storage.ts` is the only persistence layer. Swap `loadAgents/saveAgents/loadMatches/saveMatches` for
calls to e.g. `/api/agents` and `/api/matches` backed by Postgres/Supabase, keyed by wallet or session.
Share links already work without a backend.
