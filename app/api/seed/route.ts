import { readFile } from "fs/promises";
import path from "path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { parseBank, parseGl, parseStaff } from "@/lib/parse";
import type { Precedent } from "@/lib/types";

export async function POST() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    return Response.json({ error: "NEXT_PUBLIC_CONVEX_URL is not set" }, { status: 500 });
  }

  const dataDir = path.join(process.cwd(), "steward-data");
  const [bankText, glText, staffText, precedentsText] = await Promise.all([
    readFile(path.join(dataDir, "bank_transactions_q3_2026.csv"), "utf-8"),
    readFile(path.join(dataDir, "gl_export_bookkeeper.csv"), "utf-8"),
    readFile(path.join(dataDir, "staff_allocation.csv"), "utf-8"),
    readFile(path.join(dataDir, "precedents.json"), "utf-8"),
  ]);

  const transactions = parseBank(bankText);
  const glRows = parseGl(glText);
  const staffAllocations = parseStaff(staffText);
  const rawPrecedents = JSON.parse(precedentsText) as Omit<Precedent, "id">[];
  const precedents = rawPrecedents.map((p, i) => ({
    date: p.date,
    by: p.by,
    ruling: p.ruling,
    scope: p.scope,
  }));

  const client = new ConvexHttpClient(url);
  await client.mutation(api.ingest.loadDemo, {
    transactions,
    glRows,
    staffAllocations,
    precedents,
  });
  const counts = await client.query(api.ingest.counts, {});

  return Response.json({ ok: true, counts });
}
