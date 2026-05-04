// app/api/load/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function busyWait(ms: number) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    Math.sqrt(Math.random() * 1000);
  }
}

export async function GET() {
  busyWait(40);

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
  });
}
