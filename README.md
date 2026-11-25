# ⚽ Pickup Soccer

**A live map of pickup soccer games around Bellevue, WA.** Find a game near you, check the forecast for kickoff, grab a spot, and chat with the people you'll be playing with. Organizers create games in a few clicks and get notified when someone joins.

**Live app → [pickup-soccer.app.space](https://pickup-soccer.app.space)**

Built with the [DeepSpace SDK](https://docs.deep.space) on Cloudflare Workers, React, and MapLibre GL.

---

## 🎬 Demo

<!--
  Demo video goes here.
  On GitHub: edit this file in the browser and drag-and-drop your .mp4/.mov
  (under 100 MB) onto this spot — GitHub uploads it and inserts a link that
  plays inline. Or link a YouTube/Loom video with a thumbnail:
  [![Watch the demo](docs/demo-thumbnail.png)](https://youtu.be/YOUR_VIDEO_ID)
-->

> 📹 _Demo video coming soon._

<!-- Optional screenshots:
| Map | Game card | Create a game |
|---|---|---|
| ![Map](docs/screenshots/map.png) | ![Game card](docs/screenshots/card.png) | ![Create](docs/screenshots/create.png) |
-->

---

## ✨ Features

**For players**
- 🗺️ **Full-screen live map** of upcoming games: each game is a small floating card showing title, kickoff and spots ("Sat 10:00 AM · 6/14"), grey when full.
- 🔎 **Search any address or park** (top right) and fly straight there.
- 🌤️ **Game card with animated weather** for the kickoff hour: a shining sun, drifting clouds, rain or falling snow, with °F and chance of rain. More than 16 days out it says "Forecast not available yet".
- ✅ **Join / Leave in one tap.** The spot count and roster update **live for everyone**, no refresh.
- 💬 **Private per-game chat.** Only registered players and the organizer can read or post.
- ⏰ **Reminder email 2 hours before kickoff**, sent once and never twice.

**For organizers**
- ➕ **Create a game** by clicking a spot on the map or searching for a field, then pick the day and time from a calendar and time picker, set max players (2–30), cost, skill level, surface and notes.
- ✏️ **Edit** any detail later, or ❌ **cancel**: players are emailed and their spots released.
- 📧 **Email when someone joins or leaves** your game.

**Accounts**: sign in with Google (DeepSpace auth). Anyone can browse the map; signing in is needed to create, join or chat.

---

## 🧠 How it works

```
Browser (React + MapLibre)                    Cloudflare Worker (DeepSpace)
──────────────────────────                    ─────────────────────────────
useQuery('games' | 'registrations' | …)  ◀──WebSocket──▶  RecordRoom (Durable Object + SQLite)
   live data, permission-filtered                          • schemas + per-role permissions
                                                           • one atomic write at a time
POST /api/actions/joinGame | leaveGame |  ───────────▶   Server actions (src/actions)
     updateGame | cancelGame | postGameMessage …            • business rules + validation
GET  /api/games/:id/weather               ───────────▶   Open-Meteo  (cached 1 h)
GET  /api/places/search | reverse         ───────────▶   OpenStreetMap Nominatim (cached 7 days)
                                                         Resend (email) · CronRoom (scheduled jobs)
```

- **Live data:** every list on screen is a DeepSpace `useQuery` subscription over a WebSocket, so a new game, a join, or a chat message shows up for everyone instantly.
- **Permissions are enforced on the server**, inside the Durable Object, before data is sent:
  - anyone can view games
  - signed-in users can create games
  - only the organizer can edit or cancel their game
  - `playerCount` and `status` can only be changed by the server
  - chat messages are only delivered to the game's members
- **External APIs are called from the worker only** (never the browser), with caching and an identifying User-Agent.

### 🏁 "Two people join the last spot at the same time": exactly one wins

A DeepSpace RecordRoom is a single Durable Object, so each **individual write** is atomic: the uniqueness check and the insert run with no `await` in between. A server action as a whole, though, is *several* writes, and other requests can slip in between them. So the decisions that must never be wrong are each made by **one write**:

| Must never happen | Enforced by |
|---|---|
| The same user registered twice | Registration id is `${gameId}__${userId}` (primary key) |
| More players than `maxPlayers` | Each registration claims a numbered **spot** `1…maxPlayers`, with `uniqueOn: ['gameId', 'slot']` |

Two players racing for the last spot both try to claim the same spot number. The second write is rejected (`Duplicate`), finds no free spot, and gets "This game is full". The same claim-first pattern (`reminders_sent`, `uniqueOn ['gameId','userId']`) makes sure a reminder email is never sent twice.

### ⏱️ Scheduled jobs (DeepSpace CronRoom)

| Job | Every | Does |
|---|---|---|
| `send-reminders` | 5 min | Emails each registered player ~2 h before kickoff, at most once |
| `mark-past-games` | 15 min | Marks finished games (kickoff + duration) as `past` |

---

## 🧰 Tech stack

| | |
|---|---|
| Platform | [DeepSpace SDK](https://docs.deep.space): auth, realtime records, permissions, server actions, cron, secrets, deploy to `*.app.space` |
| Runtime | Cloudflare Workers + Durable Objects (SQLite) |
| Frontend | React 19, TypeScript, Tailwind CSS v4, Vite |
| Map | [MapLibre GL](https://maplibre.org) + [OpenFreeMap](https://openfreemap.org) tiles (no API key) |
| Weather | [Open-Meteo](https://open-meteo.com) (no API key) |
| Places | [OpenStreetMap Nominatim](https://nominatim.org) |
| Email | [Resend](https://resend.com) (API key stored as a DeepSpace secret) |
| Tests | Vitest (unit) + Playwright via `deepspace/testing` (browser, multi-user) |

---

## 🚀 Getting started

**Prerequisites:** Node 22+, npm 11+, and a [DeepSpace](https://deep.space) account.

```sh
git clone https://github.com/Bektur13/pickup-soccer.git
cd pickup-soccer
npm install
npx deepspace auth login      # opens the browser once
npx deepspace dev start       # local app at http://localhost:5173
```

### Secrets (optional: enables email)

Secrets live in DeepSpace's encrypted store. **Never** put them in code or `.env` files.

```sh
npx deepspace secrets set RESEND_API_KEY=<your Resend key>
# Optional, after verifying a domain in Resend (otherwise mail only reaches your own inbox):
npx deepspace secrets set EMAIL_FROM="Pickup Soccer <games@yourdomain.com>"
```

Without `RESEND_API_KEY` the app works normally. Emails are skipped and logged as `[email] … not set`.

### Deploy

```sh
npx deepspace deploy          # → https://<name>.app.space
npx deepspace logs --follow   # watch it run (cron, email, errors)
```

> ℹ️ On the DeepSpace **free tier**, wrangler custom bindings (KV, R2, D1, Queues…) are refused at deploy. This app keeps its caches in RecordRoom collections instead.

---

## 🧪 Testing

```sh
npm run test:unit            # Vitest: actions, permissions, races, weather, places, email, cron
npx deepspace test run       # Playwright smoke + API tests against a local server
npx deepspace test run all   # everything, including multi-user specs
npm run type-check && npm run lint
```

Highlights:
- **Race tests:** two users for the last spot (×40 runs), 25 users joining a 10-player game at once (never overbooks), overlapping reminder runs (never a double email).
- **Permission tests** run through DeepSpace's own RBAC functions against the real schemas: organizer-only edit and cancel, signed-out can't create or join, chat privacy.
- **Multi-user browser test** (`tests/join-race.spec.ts`): two signed-in users join the last spot at once. Needs two test accounts:
  ```sh
  npx deepspace test accounts create --email alice@deepspace.test --name "Alice" --password-stdin
  npx deepspace test accounts create --email bob@deepspace.test   --name "Bob"   --password-stdin
  ```

---

## 📁 Project structure

```
src/
├── pages/
│   ├── index.tsx                 "/" → redirects straight to the map (keeps link previews)
│   └── (app)/home.tsx            the map page: search, pins, games list, card, create/edit
├── components/
│   ├── map/                      PickupMap (MapLibre + floating pins), PlaceSearch
│   ├── games/                    GameCard, WeatherScene, GameChat, CreateGameDialog, KickoffPicker, GamesPanel
│   └── Navigation.tsx            transparent floating nav
├── schemas/                      games, registrations, chat (messages + team_members), reminders, caches
├── actions/                      server actions: join/leave, chat, edit/cancel (+ tests)
├── server/                       worker routes & logic: weather, places, email, scheduled jobs
├── cron.ts                       scheduled job definitions
└── lib/                          shared types, API helper, weather themes
worker.ts                         Cloudflare Worker entry (routes, Durable Objects)
tests/                            Playwright specs (smoke, api, multi-user)
NOTES.md                          build log
```

---

## 🗺️ Roadmap

- [ ] Live in-app notice to the organizer when someone joins (email already exists)
- [ ] Small dismissible welcome card for first-time visitors
- [ ] Verified email domain, so notifications reach every user
- [ ] Run the two-user browser race test in CI

---

## 📄 License

No license yet: all rights reserved by the author. Add a `LICENSE` file if you'd like others to reuse the code.

---

<sub>Built by [Bektur Duishembekov](https://github.com/Bektur13) on the DeepSpace SDK. Map data © OpenStreetMap contributors, tiles by OpenFreeMap, weather by Open-Meteo.</sub>
