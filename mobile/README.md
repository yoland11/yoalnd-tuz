# AJN Staff — Mobile (Expo)

Native field-crew app for the AJN platform. It is **not** a standalone system — it
is a thin native client over the existing AJN staff-portal API. No new auth,
database, or booking system: it reuses the platform's bearer-token auth and the
`/staff/koshas/*` and `/staff/photography/*` endpoints in `src/server/api.ts`.

## What's implemented (Task/Booking module)

- **Auth** — username + password → bearer token (`POST /staff/auth/login`),
  stored in Expo SecureStore, sent as `Authorization: Bearer` on every request.
- **Home dashboard** — today / tomorrow / late / completed counts per department.
- **Task list** — assignment-filtered, with bucket chips + debounced search.
- **Task detail** — customer, phones, venue, call + Google Maps quick actions,
  full timeline.
- **Status engine** — the real Koshat execution stages (`booked → preparing →
  ready → out_of_warehouse → on_the_way → executing → executed → event_running →
  dismantling → returned → delivered`), one-tap forward transition with an
  optional note, wired to `POST /staff/koshas/bookings/:id/stage`.
- **Departments** — Koshat (full read + stage advance) and Photography
  (dashboard + events + detail; order-level stage writes are a documented
  follow-up). Adding a department = one `DepartmentStrategy`.

## Architecture (Clean Architecture)

```
src/
  config/          env resolution
  shared/          cn, formatting, theme tokens
  domain/          entities (zod), status-engine, department strategy + registry
  infrastructure/  secure-store, http-client (bearer), auth-api
  application/      DI container, query client/keys, auth + department contexts, hooks
  presentation/    reusable components (Screen, states, TaskCard, StageStepper, ...)
app/               Expo Router screens (login, tabs: home/tasks, task/[id])
```

## Configure the server URL

Copy `.env.example` → `.env` and set the reachable AJN base URL. On a **physical
device** use your machine's LAN IP (not `localhost`):

```
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:3000
```

## Run in development

```bash
cd mobile
pnpm install          # from repo root also works (workspace)
pnpm start            # Expo dev server; open in Expo Go or a dev build
```

## Build an installable APK (local)

Requires a local Android toolchain: **JDK 17**, **Android SDK / Android Studio**,
and `ANDROID_HOME` set.

**Option A — EAS local build (recommended, produces a signed APK):**
```bash
cd mobile
pnpm install
npm i -g eas-cli
eas build -p android --profile preview --local   # outputs an .apk in the folder
```

**Option B — bare Expo run (debug APK on a connected device/emulator):**
```bash
cd mobile
pnpm install
npx expo run:android
# debug APK at: android/app/build/outputs/apk/debug/app-debug.apk
```

> Cloud alternative (no Android Studio): `eas login` then
> `eas build -p android --profile preview` → download-URL for the APK.

## Verify

Both of these are known-green in this repo:

```bash
cd mobile
pnpm typecheck                              # tsc --noEmit → no errors
npx expo export --platform android --clear  # Metro/NativeWind bundle → success
```

> Toolchain note: NativeWind 4.2.x requires **Tailwind CSS v3** (pinned here),
> and `react-native-worklets` + `react-native-css-interop` are direct deps so
> the Reanimated babel plugin and the `nativewind` jsx-runtime resolve under
> pnpm's strict node_modules.

## Backend touchpoints (already in the main app)

- `POST /staff/auth/login`, `GET /staff/auth/me`, `POST /staff/auth/logout`
  (added to `handleStaffPortal`, token in body).
- Existing `/staff/koshas/*` and `/staff/photography/*` accept the bearer token
  via `adminToken(req)` — no change needed.

## Known follow-ups

- Phone-number login (the `staff` table is username-only today).
- Photography order-level stage writes; media upload; push notifications;
  offline queue — the structure is in place for each.
