# SureBall Mobile (Expo React Native)

Simple thesis-prototype mobile frontend for SureBall.

## Included Screens

1. Login Screen
2. Dashboard Screen
3. Coaching Mode Selection Screen
4. Live Camera Analysis Screen
5. Session History Screen

## Features

- Camera capture via `expo-camera`
- Frame upload to FastAPI `/analyze-frame` using `fetch`
- Real-time feedback text + score display
- Skeletal overlay and basketball box placeholders on live view
- Local session history via AsyncStorage
- Backend session fetch from `/sessions`
- Supabase-backed user profile persistence on login

## Run

From `frontend/`:

```bash
npm install
npm run start
```

## Backend URL

Set in `frontend/app.json`:

```json
"extra": {
  "backendUrl": "http://10.0.2.2:8000"
}
```

Use the correct IP for your device setup:

- Android emulator: `http://10.0.2.2:8000`
- iOS simulator: `http://127.0.0.1:8000`
- Physical device: `http://<your-lan-ip>:8000`

## Notes

- Live screen currently sends one captured frame per tap ("Capture and Analyze Frame").
- Video upload endpoint exists in service file (`analyzeVideo`) for future extension.
- UI is intentionally simple for thesis-prototype iteration.

## Supabase Setup (User Information)

Set values in `frontend/app.json`:

```json
"extra": {
  "supabaseUrl": "https://YOUR-PROJECT-REF.supabase.co",
  "supabasePublishableKey": "YOUR_SUPABASE_PUBLISHABLE_KEY"
}
```

Create table in Supabase:

```sql
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  email text,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);
```

The login screen performs an upsert on `users` by `name`. If Supabase keys are not configured, the app falls back to local-only behavior.
