import { NextResponse, type NextRequest } from "next/server";
import { getJob } from "@/lib/readiness/jobs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  const full = req.nextUrl.searchParams.get("full") === "1";
  if (full) return NextResponse.json(job);
  const { results: _r, ...rest } = job;
  void _r;
  return NextResponse.json(rest);
}
