HomeRef Mobile (Expo)

Overview
- Expo (React Native) app with local SQLite DB and on-device file storage.
- Optional Supabase Auth (email/Apple/Google) for reserving an account; cloud sync comes later.
- Talks to your existing FastAPI API for upload/ingest/chat (no n8n).

Structure
- Routing: expo-router with tabs: Chat, Library, Settings.
- DB: `expo-sqlite` with tables `appliances` and `files` (id uuid, updated_at, deleted_at, changed flag).
- Files: stored under app sandbox (`FileSystem.documentDirectory/manuals/`).
- API: uses `/upload`, `/ingest`, `/query`, `/chat` from your server.

Run (iOS Simulator)
1) Install deps: `cd apps/mobile && npm i`
2) Fastest path (no prebuild): `npx expo start --clear` then press `i`
3) For a native prebuild: `npx -y expo@51.0.39 prebuild --platform ios --clean && npx pod-install && npx -y expo@51.0.39 run:ios`
3) In Settings tab, set API Base to your server (e.g., http://localhost:8000 or your LAN IP for device testing).

Features
- Chat: select an appliance or “All” and ask questions. Calls server `/query` + `/chat`.
- Library: create appliance, add files from device. Optionally Upload and Ingest via API.
- Settings: set API base; configure Supabase URL/Anon for future auth.

Notes
- For uploading from a physical device to your local server, use your machine’s LAN IP (e.g., http://192.168.1.10:8000) rather than localhost.
- Sign-in with Apple/Google will be wired in Phase 1 along with cloud sync.
