import { NextResponse } from "next/server";
import { fetchModalRenderProgress } from "@/lib/render/modal";

export const runtime = "nodejs";

// Poll the Modal renderer. The `?bucket=` query param is now ignored (Modal
// tracks its own output bucket) but still accepted so the UI needs no change.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const p = await fetchModalRenderProgress(id);
    return NextResponse.json(p);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
