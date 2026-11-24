import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";

/** Landing-page pilot request → convex/pilot.ts. Contact details only; never files. */
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return Response.json({ ok: false, error: "The form isn't available right now." }, { status: 500 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  try {
    const client = new ConvexHttpClient(url);
    await client.mutation(api.pilot.request, {
      name: str("name"), organization: str("organization"), email: str("email"),
      system: str("system"), note: str("note"), website: str("website"),
    });
    return Response.json({ ok: true });
  } catch (e) {
    const message = e instanceof ConvexError ? String(e.data) : "Something went wrong. Please try again.";
    return Response.json({ ok: false, error: message }, { status: e instanceof ConvexError ? 400 : 500 });
  }
}
