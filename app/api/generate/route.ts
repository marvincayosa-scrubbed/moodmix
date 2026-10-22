import { parseInput, type Usage } from "@/lib/contracts";
import { quota, generate, errorResponse, ServiceError } from "@/lib/server";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  let usage: Usage | undefined;
  let consumed = false;
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      throw new ServiceError(
        "Cross-site requests are not allowed.",
        403,
        "INVALID_ORIGIN",
      );
    if (!request.headers.get("content-type")?.includes("application/json"))
      throw new ServiceError("Send JSON input.", 415, "INVALID_INPUT");
    const raw = await request.text();
    if (raw.length > 4096)
      throw new ServiceError("Request is too large.", 413, "INVALID_INPUT");
    let input;
    try {
      input = parseInput(JSON.parse(raw));
    } catch (e) {
      throw new ServiceError(
        e instanceof Error ? e.message : "Invalid input.",
        400,
        "INVALID_INPUT",
      );
    }
    const reservation = await quota(request, true);
    usage = reservation.usage;
    if (!reservation.accepted)
      throw new ServiceError(
        "All five generations have been used. Your next slot opens at the time shown below.",
        429,
        "RATE_LIMITED",
      );
    consumed = true;
    const playlist = await generate(input.mood, input.count);
    return Response.json(
      { ...playlist, usage },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e, usage, consumed);
  }
}
