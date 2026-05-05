This is the project's AGENTS.md

# AGENTS

## Notes
- Webapp uses Next.js 16 App Router + Convex -> keep `pnpm convex:dev` running while editing backend code -> generated client types drift if the watcher is off.
- Convex backend edits in `Webapp/convex` -> read `Webapp/convex/_generated/ai/guidelines.md` first -> avoids schema/query/auth patterns that Convex rejects.
- Live chat uses Convex Agent component (`@convex-dev/agent`) -> `meetings.agentThreadId` links workspace rows to Agent threads and `useUIMessages` renders streams -> run `pnpm convex:codegen` after component/schema edits.
- Chat attachments are draft-time context only -> text-like files are read in-browser and appended to the Agent prompt, not stored in Convex -> add Convex file storage before promising durable uploads.
- Clerk + Convex auth split envs -> Next.js needs Clerk publishable/secret keys but Convex only needs `CLERK_JWT_ISSUER_DOMAIN` in deployment env -> auth config and `pnpm convex:codegen` fail if the Convex env is missing.
- Gemini chat replies run from Convex actions -> set `GEMINI_API_KEY` and optional `GEMINI_MODEL` in Convex env -> missing key intentionally falls back to local SmartPuck proposal context.
- OV5640 module manual lists optimal image distance 20-250 cm -> keep whiteboard/TV captures within ~0.2-2.5 m or quality drops.
- OV5640 module listings often mislabel USB/UVC in text -> verify DVP pinout (Y2-Y9, PCLK, VSYNC) before purchase to avoid incompatible modules.
- Product direction may pivot audio-first -> treat onboard camera as optional/experimental visual context -> avoids overpromising whiteboard/slide capture on cheap OV5640 hardware.
- Audio-first hardware shortlist favors LOLIN S3 Pro + INMP441 + PH2.0 LiPo -> onboard TF slot and battery port reduce wiring -> verify SD/I2S pin choices before firmware.
