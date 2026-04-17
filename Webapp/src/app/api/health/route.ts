import { NextResponse } from "next/server";
import { appEnv } from "@/lib/env";

export function GET() {
  return NextResponse.json({
    ok: true,
    mode: appEnv.hasConvex ? "convex" : "demo",
    authProvider: "pending-choice",
  });
}
