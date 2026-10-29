# Between source project

Created: 2026-10-30

Use Node.js >=22.13, npm and the committed package-lock. The stack is React/TypeScript, Vinext, Cloudflare D1/R2 and Sites hosting. Keep the Sites build integration and immutable Drizzle migration history.

Run `npm test`, `npm run typecheck`, and `npm run build` for changes to access control, storage or API contracts. The isolated governance test uses synthetic trusted identities, never a public endpoint. Inspect desktop/mobile UI for visual changes.

Production identity headers are trusted only behind Sites dispatch. Never introduce a production test bypass or use browser-supplied member IDs for new rooms. Do not read or commit environment/credential files. Do not log user contents, room tokens or complaint receipts. Document operating prerequisites without asserting legal compliance from tests.

Main directories: app, components, lib, db, drizzle, scripts, build and public. The API contract and acceptance criteria are in Compliance-Spec.md. No production data belongs in this repository.
