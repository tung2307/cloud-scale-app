import { NextResponse } from "next/server";

const PY_API = process.env.NEXT_PUBLIC_PREDICT_API || "http://localhost:8000";

export async function GET() {
  try {
    const res = await fetch(`${PY_API}/replay/next`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Replay API unreachable" },
      { status: 500 },
    );
  }
}
