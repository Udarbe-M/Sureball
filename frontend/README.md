# SureBall Mobile (Expo React Native)

Simple thesis-prototype mobile frontend for SureBall.

## Included Screens

1. Login Screen
2. Dashboard Screen
3. Coaching Mode Selection Screen
4. Coaching Video Analysis Screen
5. Session History Screen

## Features

- Camera capture via `expo-camera`
- Coaching video upload/record flow with in-app preview and download
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

Default is set in `frontend/app.json`:

```json
"extra": {
  "backendUrl": "http://127.0.0.1:8000"
}
```

Use the correct IP for your device setup:

- Android emulator: `http://10.0.2.2:8000`
- iOS simulator: `http://127.0.0.1:8000`
- Physical device: `http://<your-lan-ip>:8000`

For Expo Go on a physical device, you can override the backend at start time:

```bash
EXPO_PUBLIC_BACKEND_URL=http://<your-lan-ip>:8000 npm run start -- --lan
```

## Notes

- Coaching mode now supports uploaded or in-app recorded videos and returns an annotated downloadable result clip.
- Video upload endpoint exists in service file (`analyzeVideo`) for future extension.
- UI is intentionally simple for thesis-prototype iteration.

## Free Local Backend with zrok

If you want to keep the backend on your own PC and avoid paying for hosting, you can expose the local FastAPI server with `zrok` and build the APK against that public HTTPS URL.

### One-time reserve

From the repo root:

```bash
powershell -ExecutionPolicy Bypass -File .\scripts\reserve-sureball-zrok.ps1 -UniqueName sureballapi
```

This creates a stable reserved token such as `sureballapi`.

### Start backend + zrok share

From the repo root:

```bash
powershell -ExecutionPolicy Bypass -File .\scripts\start-sureball-backend-zrok.ps1 -ShareToken sureballapi
```

Keep that terminal window open while testing the mobile app.

### Build an installable APK

From `frontend/`:

```bash
npm run build:apk
```

Or from the repo root with an explicit backend URL:

```bash
powershell -ExecutionPolicy Bypass -File .\scripts\build-sureball-apk.ps1 -BackendUrl https://sureballapi.share.zrok.io
```

The `preview` EAS profile in [eas.json](/C:/Users/W-11-VM/Desktop/Sureball/frontend/eas.json) is configured to output an installable `.apk`.

## Supabase Setup (User Information)

Set values in `frontend/app.json`:

```json
"extra": {
  "supabaseUrl": "https://YOUR-PROJECT-REF.supabase.co",
  "supabasePublishableKey": "YOUR_SUPABASE_PUBLISHABLE_KEY",
  "supabaseEmailRedirectTo": "https://YOUR-APP-URL-OR-CONFIRMATION-PAGE"
}
```

The old prototype `users` table is no longer required for login. The app now uses Supabase Auth plus a `profiles` table linked to `auth.users`.

## Supabase Auth + Profiles Setup

The app now uses Supabase email/password auth together with a `profiles` table keyed by `auth.users.id`.

1. Open the Supabase SQL Editor for your project.
2. Run the migration in [supabase/migrations/20260518_auth_profiles.sql](/C:/Users/Administrator/Documents/Sureball/supabase/migrations/20260518_auth_profiles.sql).
3. In the Supabase dashboard, confirm Email auth is enabled under Authentication > Providers.
4. Keep the publishable key and project URL in `frontend/app.json`, or provide them with:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
EXPO_PUBLIC_SUPABASE_EMAIL_REDIRECT_TO=https://YOUR-APP-URL-OR-CONFIRMATION-PAGE
```

Notes:

- Hosted Supabase projects usually require email confirmation by default, so a new player may need to verify the signup email before logging in.
- As of September 26, 2024, Supabase's built-in email sender only delivers auth emails to addresses that belong to the project's organization team, and it is heavily rate-limited. If outside users are not receiving verification emails, configure `Authentication > SMTP Settings` with a custom provider before testing the APK with real user emails.
- The Register screen also supports a local `Guest User` path for testing without email or password. Guest profiles stay on the current device only.
- Player names now live in `public.profiles.player_name` and can be changed from the in-app Player Menu after login.
- A ready-to-paste SureBall signup verification email template lives in [supabase/email-templates](/C:/Users/Administrator/Documents/Sureball/supabase/email-templates/README.md).
