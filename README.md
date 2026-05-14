# Simul

Simul is a mobile-first web app for simultaneous group answers. A host creates a room, shares a link or room code, everyone submits privately, and the host reveals the answers at the same time.

## Current Stack

- React + Vite + TypeScript
- Supabase Postgres + Realtime
- Cloudflare Pages recommended for public hosting
- No accounts required for the MVP

## Features

- Create a room from the public home screen
- Join by invite link or room code
- Free-response answers with 1 to 5 answers per person
- Preset ranking mode
- Host-only reveal control
- Blind reveal mode
- Multi-round rooms with previous results kept
- QR code invite screen
- PWA manifest for add-to-home-screen support

## Local Setup

Install dependencies:

```bash
npm install
```

Create a `.env` file:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Run the app:

```bash
npm run dev
```

The dev server binds to `0.0.0.0`, so phones on the same Wi-Fi can open it with your computer's LAN IP, for example:

```text
http://192.168.1.25:5173
```

That is only for local testing. For using it outside with friends, deploy the frontend publicly.

## Supabase Setup

1. Create a Supabase project.
2. Open the SQL editor.
3. Run the SQL in `supabase/schema.sql`.
4. Copy your project URL and anon key into `.env`.
5. Restart the dev server.

The schema uses RPC functions for room creation, joining, submitting, and revealing. The raw answer table is protected by row-level security, so submissions are not selectable until the room is revealed.

If the schema changes during development, rerun the full `supabase/schema.sql` file in the SQL editor. The app expects the latest schema, including `room_rounds` for multi-round rooms.

## Public Hosting

Cloudflare Pages is the recommended host for the frontend.

Build command:

```bash
npm run build
```

Build output directory:

```text
dist
```

Environment variables to set in Cloudflare Pages:

```bash
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

After deployment, point your domain, such as `simul.xyz`, at the Cloudflare Pages project. The app then works like:

- `https://simul.xyz`
- `https://simul.xyz/room/ABCDE`

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run preview
```

## Notes

- The host token is stored in the creator's browser local storage.
- The normal invite link does not include the host token.
- If a host clears browser storage, they lose host controls for that room.
- New rounds reuse the same room link and participants, while old revealed rounds stay available as history.
- Rooms are currently persistent until manually removed from Supabase.
