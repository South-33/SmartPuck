# SmartPuck Webapp

Next.js 16 App Router frontend with a Convex backend for folders, meeting uploads, and post-meeting chat workflows.

## Current scope

- Folder-first workspace UI for sessions and follow-up chat
- Convex-backed dashboard query and mutations
- Simulated smart puck upload flow for USB/Bluetooth ingestion metadata
- Demo fallback when `NEXT_PUBLIC_CONVEX_URL` is not configured
- Clerk authentication for the live Convex workspace

## Stack

- Next.js 16.2.4
- React 19.2.4
- Convex 1.35.1
- Tailwind CSS 4
- pnpm

## Scripts

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm check
pnpm test
pnpm test:run
pnpm verify
pnpm convex:dev
pnpm convex:codegen
pnpm convex:deploy
```

## Local development

1. Run `pnpm install`
2. Keep `pnpm convex:dev` running in one terminal
3. Run `pnpm dev` in another terminal
4. Open `http://localhost:3000`

## Required environment variables

Local `.env.local`, Vercel, and Convex should be configured with:

- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_JWT_ISSUER_DOMAIN`

## Deployment

- Frontend: Vercel
- Backend/data: Convex cloud deployment
- Vercel needs the Clerk and public Convex vars
- Convex needs `CLERK_JWT_ISSUER_DOMAIN` in its deployment environment
