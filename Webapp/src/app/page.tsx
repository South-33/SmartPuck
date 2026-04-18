import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { DemoWorkspace } from "@/components/workspace/demo-workspace";
import { LiveWorkspace } from "@/components/workspace/live-workspace";
import { appEnv } from "@/lib/env";

export default async function Home() {
  if (!appEnv.hasConvex) {
    return <DemoWorkspace />;
  }

  if (!appEnv.hasClerk) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-6 py-12">
        <section className="glass-panel metal-border w-full rounded-[2rem] p-8 sm:p-10">
          <p className="font-display text-[10px] uppercase tracking-[0.38em] text-sp-muted">
            Clerk setup needed
          </p>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-slate-950">
            Convex is live, but auth keys are still missing.
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">
            Clerk is now the chosen provider. Add the required variables locally and in Vercel, then
            the workspace will switch from this setup blocker to the real signed-in flow.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <EnvCard
              name="NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
              ready={appEnv.hasClerkPublishableKey}
            />
            <EnvCard name="CLERK_SECRET_KEY" ready={appEnv.hasClerkSecretKey} />
            <EnvCard
              name="CLERK_JWT_ISSUER_DOMAIN"
              ready={appEnv.hasClerkIssuerDomain}
            />
          </div>

          <div className="mt-8 rounded-[1.5rem] border border-sp-line bg-white/82 p-5">
            <p className="font-display text-sm font-semibold text-slate-950">What to do next</p>
            <ol className="mt-3 space-y-2 text-sm leading-7 text-slate-600">
              <li>1. Create the Clerk app and enable the Convex integration in the Clerk dashboard.</li>
              <li>2. Add the publishable key, secret key, and Clerk issuer domain to `.env.local`.</li>
              <li>3. Mirror the same values into Vercel and the Convex deployment environment.</li>
              <li>4. Restart `pnpm dev` and keep `pnpm convex:dev` running.</li>
            </ol>
          </div>
        </section>
      </main>
    );
  }

  const session = await auth();

  if (!session.userId) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-12">
        <section className="glass-panel metal-border w-full rounded-[2rem] p-8 sm:p-10">
          <p className="font-display text-[10px] uppercase tracking-[0.38em] text-sp-muted">
            Sign in required
          </p>
          <h1 className="mt-4 max-w-3xl font-display text-4xl font-semibold tracking-tight text-slate-950">
            SmartPuck is ready to ingest meetings. Sign in to open your workspace.
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">
            Clerk is now the auth boundary for the live Convex workspace. After sign-in, every folder,
            meeting shell, and chat thread is scoped to your authenticated identity.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/sign-in"
              prefetch={false}
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              prefetch={false}
              className="rounded-full border border-sp-line bg-white px-5 py-3 text-sm font-medium text-slate-900"
            >
              Create account
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return <LiveWorkspace />;
}

function EnvCard({ name, ready }: { name: string; ready: boolean }) {
  return (
    <div className="rounded-[1.4rem] border border-sp-line bg-white/82 p-4">
      <p className="text-[10px] uppercase tracking-[0.28em] text-sp-muted">Env var</p>
      <p className="mt-2 break-all font-mono text-sm text-slate-900">{name}</p>
      <p className="mt-3 text-sm font-medium text-slate-700">
        {ready ? "Detected" : "Missing"}
      </p>
    </div>
  );
}
