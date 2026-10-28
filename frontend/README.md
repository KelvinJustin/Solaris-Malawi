# SmartPay Malawi — Frontend

React + Vite single-page app for merchants. UI taken from the `pixel-perfect-prototype`, wired to the
cookie-based auth API described in `docs/architecture/authContract.md`.

## Run it

```bash
# 1. Backend (from the repo root) — must be running on http://localhost:3000
npm run start:dev

# 2. Frontend
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Open http://localhost:5173 — the login page is the main page.

`VITE_API_URL` (copy `.env.example` to `.env`) is the API **origin** and defaults to `http://localhost:3000`; the app adds the `/v1` prefix itself. The backend's `FRONTEND_URL`
must be exactly `http://localhost:5173` (it already is in `.env.example`), because credentialed CORS
cannot use a wildcard origin.

## Screens

| Route       | Who sees it        | What it does                                                    |
| ----------- | ------------------ | --------------------------------------------------------------- |
| `/`         | Logged-out         | **Login** (main page). Logged-in merchants are sent to `/home`. |
| `/register` | Logged-out         | Register, then on to `/verify-email`.                           |
| `/verify-email` | Logged-out     | Enter the emailed 6-digit code, or request a new one.           |
| `/home`     | Logged-in only     | Account status, what's left to do, business details. Logged-out visitors go to `/`. |
| `/payments` | Logged-in only     | Placeholder (empty state). Payment history is not built yet.    |
| `/profile`  | Logged-in only     | Placeholder (empty state). Profile form and document upload are not built yet. |

## The signed-in shell

Everything under `src/routes/_authed/` renders inside `AppShell` (`src/components/AppShell.tsx`): a sidebar
on large screens that becomes a slide-over menu on phones, with the nav, the account status pill, the
merchant's email and Logout. Add a page by creating a route file under `_authed/` and one entry in `NAV`.

- **Account status**: `GET /merchants/profile` is fetched once by `ProfileProvider` (`src/lib/merchant-profile.tsx`);
  the sidebar and the home page both read it with `useProfile()`. Status wording and tones live in
  `src/lib/profile.ts` (`ACCOUNT_STATUS`), so copy changes happen in one place.
- **Loading / error / empty**: `src/components/states.tsx`. For any GET that feeds a page, use `useResource`
  (`src/lib/use-resource.ts`) with `<ResourceBoundary>`; the page then only describes its success view.
  `ErrorState` has a retry. A 401 from any `useResource` call ends the session and returns to login.

## How auth works here

- Every request uses `credentials: "include"` (`src/lib/api.ts`). No token is ever read or stored in JS.
- On load the app calls `GET /auth/me` (`src/lib/auth.tsx`): 200 → logged in, 401 → logged out,
  network error → "Can't reach SmartPay" with a retry button (not treated as an expired session).
- Login is two steps: `POST /auth/login` (password, emails a code) then `POST /auth/verify-login` (code, server sets the cookie), then `GET /auth/me` for the identity. The JWT is never read or stored by JS.
- Register does not log in; the merchant verifies their email (`POST /auth/verify-email`, `POST /auth/resend-verification`) and then logs in.
- Logout = `POST /auth/logout` (server revokes the token and clears the cookie); local state is cleared only after the server confirms.

## Scripts

`npm run dev` · `npm run build` (typecheck + production build) · `npm test`

Routes live in `src/routes` (TanStack Router, file-based; `src/routeTree.gen.ts` is generated).
`components.json` is kept so more shadcn/ui components can be added with the shadcn CLI.
