# CLAUDE.md — Pickup Soccer (DeepSpace build project)

## What this app is
A live map of pickup soccer games. Signed-in players browse games on a map, open a game card
(weather, field, cost, spots left), join or leave, and chat with other players in that game.
Organizers create games with a player limit and get notified when someone joins.

**The one path that must always work:**
sign in → see games on the map → open a game card → join → spot count updates live for
everyone → organizer is notified → registered players can chat.

Do not add features that are not listed here without asking me first.

## Stack
- DeepSpace SDK (`deepspace` frontend hooks, `deepspace/worker` backend, `deepspace/testing` for tests)
- React + TypeScript
- MapLibre GL with OpenFreeMap tiles (no API key)
- Open-Meteo for weather (no API key)
- OpenStreetMap Nominatim for place search
- Resend for email (API key stored as a DeepSpace secret)

Reference app: `../runningmap` (DeepSpace + MapLibre). Read it to learn patterns. Do not copy it.

## Rules for you
1. **Never guess DeepSpace APIs.** Before using any DeepSpace function, hook, or class, find it in
   `node_modules/deepspace` (types and source) or on docs.deep.space. Tell me which file or docs
   page you used. If you can't find it, stop and ask me.
2. **Use DeepSpace primitives; don't reimplement them.** Auth, data sync, permissions, messaging,
   scheduled jobs, and secrets all come from DeepSpace. No custom auth, no custom WebSocket
   layer, no hand-rolled permission system.
3. **Never commit secrets.** API keys come from `npx deepspace secrets` only. Never put them in
   code, `.env` files tracked by git, or the frontend bundle.
4. **External APIs are called from the worker, not the browser** (Nominatim, Open-Meteo, Resend).
   Cache Nominatim and weather results. Send a proper User-Agent to Nominatim.
5. **One feature at a time.** For anything involving joining games, permissions, or scheduled
   jobs: write a short plan first and wait for my OK before writing code.
6. **Keep diffs small and readable.** Explain what you changed and why in plain words after each
   step. Don't refactor unrelated code.
7. **Don't touch files outside this project** (including `../runningmap`).
8. If a command or test fails, show me the actual error and your hypothesis before trying a fix.

## Data model

### games
| Field | Type | Notes |
| --- | --- | --- |
| id | string | Set by DeepSpace |
| organizerId | user id | Creator; only they can edit or cancel |
| organizerName | string | Display name on the card |
| title | string | e.g. "Saturday 7v7" |
| fieldName | string | e.g. "Crossroads Park" |
| address | string | From Nominatim |
| lat, lng | number | Map pin position |
| startsAt | datetime | Must be in the future |
| durationMin | number | e.g. 90 |
| maxPlayers | number | 2–30, required |
| playerCount | number | Server-only |
| cost | string | Info only, e.g. "Free" or "$5, pay at the field" |
| skillLevel | enum | casual / intermediate / competitive |
| surface | enum | grass / turf / indoor |
| notes | string | Optional |
| status | enum | open / full / cancelled / past — server-only |

### registrations
| Field | Type | Notes |
| --- | --- | --- |
| gameId | string | |
| userId | user id | One registration per user per game |
| userName | string | Shown on roster |
| createdAt | datetime | |

Never store a user's email or phone in a public record.

## Permissions
1. Anyone (even signed out) can view games and the map.
2. Signed-in users can create games and join/leave games.
3. Only the organizer can edit or cancel their game.
4. Only registered players and the organizer can read/post in a game's chat channel.
5. `playerCount` and `status` are changed only by the server, never from the browser.

## Critical logic: joining a game
Joining must be a single server-side atomic operation:
1. Check the user is signed in.
2. Check the game is `open` and starts in the future.
3. Check the user isn't already registered.
4. Check `playerCount < maxPlayers`.
5. Create the registration, increment `playerCount`, set `status = full` if it reached `maxPlayers`.

Leaving reverses it and sets `status` back to `open` if there's room.
Two users joining the last spot at the same time → exactly one succeeds. Explain how DeepSpace
guarantees this (e.g. Durable Object serialization) with a reference to the source or docs.

## Features
- Full-screen map with pins (gray pin when full), side panel list matching the pins
- Top-right bar: sign in (DeepSpace auth + Google OAuth), user name, "Create game"
- Small dismissible welcome card (never blocks the map)
- Create game form: search field by name or drop a pin, then time, max players, cost, skill, surface, notes
- Game card: weather theme (sunny / cloudy / rainy / snowy) with °F and rain chance, field info,
  cost, organizer name, roster, "X / Y spots", Join/Leave button (or "Full")
- Weather: Open-Meteo by lat/lng/start hour, cached ~1h; more than 16 days out → "Forecast not available yet"
- Per-game chat channel (DeepSpace messaging)
- Live in-app notice to the organizer when someone joins
- Email to the organizer on join/leave via Resend (if email fails, the join still succeeds; log it)
- Scheduled jobs: reminder 2h before kickoff (never sent twice), mark finished games `past`

## Out of scope (do not build)
Phone/Apple sign-in, 2FA, SMS, real payments/Stripe, showing organizer phone or email,
waitlist, AI team balancing, video (LiveKit). These are explained in the writeup.

## Testing
- Use `deepspace/testing` (Playwright) for multi-user tests.
- Required test: two users try to join the last spot at the same time → exactly one succeeds.
- Test: a non-organizer cannot edit or cancel a game.
- Test: a signed-out user can view but not create or join.
- Manual check before every deploy: two browsers (normal + incognito, two accounts),
  create a game in one, see it appear in the other without refresh, join, watch the count update.

## Commands
- Scaffold: `npx deepspace`
- Local dev: `npx deepspace dev start` (check the CLI help if this differs)
- Deploy: `npx deepspace deploy` → `<name>.app.space`
- Secrets: `npx deepspace secrets`
- Before every commit: `git grep -i -E "re_|api[_-]?key|secret"` must show no real keys

## Workflow
- Commit after each working step with a clear message.
- Deploy at the end of each working session.
- After each feature, tell me what to verify by hand.
- Keep `NOTES.md` updated: date | what the agent did | what I checked | what I changed.