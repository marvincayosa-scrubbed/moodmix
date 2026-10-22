import { checkConfig, errorResponse } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    checkConfig();
    return Response.json(
      { rateLimitMode: process.env.VERCEL === "1" ? "vercel" : "local" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
