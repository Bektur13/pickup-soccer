# NOTES

| Date | What the agent did | What I checked | What I changed |
| --- | --- | --- | --- |
| 2026-11-23 | Scaffolded with `deepspace app create`, registered the app (`app init`), first deploy to pickup-soccer.app.space. | | |
| 2026-11-23 | Sign-in: `AuthOverlay providers={['google']}` in the nav and the protected-page fallback; user name chip visible on phones. | | |
| 2026-11-23 | Full-screen MapLibre map (OpenFreeMap "liberty", centered on Bellevue). Fixed the black map: MapLibre's `.maplibregl-map { position: relative }` overrode Tailwind `absolute inset-0`, collapsing the container to 0px. | | |
| 2026-11-23 | `games` schema (organizer-only update/delete, `playerCount`/`status` server-only via `writableFields`), live pins (green open / gray full) + side list via `useQuery`. | | |
| 2026-11-23 | `registrations` schema + `joinGame`/`leaveGame` server actions. Race safety: one registration per user via fixed recordId `${gameId}__${userId}`; never over `maxPlayers` via a `slot` (1..max) with `uniqueOn: ['gameId','slot']` — each enforced by a single atomic RecordRoom write. Unit tests (`src/actions/games.test.ts`, fake room with interleaving) pass, incl. last-spot race ×40. No Join/Leave UI yet (comes with the game card). E2E two-browser test still pending: test accounts not created. | | |
