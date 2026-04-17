This is the project's AGENTS.md

# AGENTS

## Notes
- Webapp uses Next.js 16 App Router + Convex -> keep `pnpm convex:dev` running while editing backend code -> generated client types drift if the watcher is off.
- Convex backend edits in `Webapp/convex` -> read `Webapp/convex/_generated/ai/guidelines.md` first -> avoids schema/query/auth patterns that Convex rejects.
- Clerk + Convex auth split envs -> Next.js needs Clerk publishable/secret keys but Convex only needs `CLERK_JWT_ISSUER_DOMAIN` in deployment env -> auth config and `pnpm convex:codegen` fail if the Convex env is missing.
- OV5640 module manual lists optimal image distance 20-250 cm -> keep whiteboard/TV captures within ~0.2-2.5 m or quality drops.
- OV5640 module listings often mislabel USB/UVC in text -> verify DVP pinout (Y2-Y9, PCLK, VSYNC) before purchase to avoid incompatible modules.
