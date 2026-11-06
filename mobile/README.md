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

Create `mobile/.env` and set the reachable AJN base URL. On a **physical
device** use your machine's LAN IP (not `localhost`):

```
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:3000
```

EAS preview and production profiles use the AJN hosted API. Development builds
can target a local or staging server using the variable above.

## Run in development

```bash
pnpm install --frozen-lockfile --config.node-linker=hoisted  # from the repo root
cd mobile
NODE_PATH="$PWD/node_modules" pnpm start
```

## QR attendance and workplace verification

Open **دوامي** in an installed AJN Staff development or standalone build. Scan
and confirm your QR check-in, then opt in for the current shift. Grant precise
location and background location access. On iOS this needs **Always** access.
On Android this may require **Allow all the time** in system settings. Sign in
again after upgrading from an older AJN Staff build to use the updated session.

Use **إيقاف مشاركة الموقع لهذه الوردية** to stop sharing even if the phone is
offline. Checkout also stops tracking. Verify background exit and return on
physical Android and iOS devices with the display locked and check manager
alerts after granting browser push notifications. Expo Go and web do not
support this background workflow. When the OS stops supplying usable location,
the attendance status shows **تعذر التحقق من الموقع**.

## Build an installable APK (local)

Requires a local Android toolchain: **JDK 17**, **Android SDK / Android Studio**,
and `ANDROID_HOME` set.

**Option A — EAS local build (recommended, produces a signed APK):**
```bash
cd mobile
npm i -g eas-cli
eas build -p android --profile preview --local   # outputs an .apk in the folder
```

**Option B — bare Expo run (debug APK on a connected device/emulator):**
```bash
cd mobile
npx expo run:android
# debug APK at: android/app/build/outputs/apk/debug/app-debug.apk
```

> Cloud alternative (no Android Studio): `eas login` then
> `eas build -p android --profile preview` → download-URL for the APK.

## Verify

```bash
cd mobile
pnpm typecheck
NODE_PATH="$PWD/node_modules" pnpm exec expo export --platform android --platform ios --clear
```

The SDK 53 bundler uses the hoisted install described above. The mobile
workspace pins Tailwind CSS v3 and the SDK-compatible Reanimated 3 runtime
for NativeWind. Set `$env:NODE_PATH = (Resolve-Path node_modules).Path` in
PowerShell from `mobile` before running Expo. This lets the hoisted Expo CLI
resolve packages installed in the mobile workspace. See
[Expo's pnpm monorepo guidance](https://docs.expo.dev/guides/monorepos/#package-managers-with-isolated-dependencies).

## Backend touchpoints (already in the main app)

- `POST /staff/auth/login`, `GET /staff/auth/me`, `POST /staff/auth/logout`
  (added to `handleStaffPortal`, token in body).
- Existing `/staff/koshas/*` and `/staff/photography/*` accept the bearer token
  via `adminToken(req)` — no change needed.

## Known follow-ups

- Phone-number login (the `staff` table is username-only today).
- Photography order-level stage writes; media upload; push notifications;
  offline queue — the structure is in place for each.
