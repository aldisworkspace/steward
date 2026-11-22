import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { packageCsv } from "@/lib/packageCsv";

/** Expenditure report CSV for a signed package, built only from its frozen snapshot. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return Response.json({ ok: false, error: "NEXT_PUBLIC_CONVEX_URL is not set" }, { status: 500 });
  const { id } = await params;
  const client = new ConvexHttpClient(url);
  let data;
  try {
    data = await client.query(api.packages.getSigned, { packageId: id as Id<"packages"> });
  } catch {
    return Response.json({ ok: false, error: "Unknown package id" }, { status: 400 });
  }
  if (!data) return Response.json({ ok: false, error: "Package not found or not signed yet" }, { status: 409 });
  let csv: string;
  try {
    csv = packageCsv(data.snapshot, {
      organization: data.organization, invoiceNo: data.invoiceNo, funder: data.funder, program: data.program,
      preparedBy: data.preparedBy, reviewedBy: data.reviewedBy, signedAt: data.signedAt,
    });
  } catch (e) {
    // packageCsv asserts the printed totals equal the snapshot to the cent.
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
  const name = `${data.invoiceNo.replace(/[^A-Za-z0-9._-]+/g, "_")}_expenditure_report.csv`;
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` },
  });
}
