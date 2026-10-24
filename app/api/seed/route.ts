import { readFile } from "fs/promises";
import path from "path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { parseBank, parseGl, parseStaff } from "@/lib/parse";
import type { Precedent } from "@/lib/types";

const DEMO_GRANTS = [
  "grant_A_federal_passthrough.pdf",
  "grant_B_harbor_light_foundation.pdf",
] as const;

async function ensureGrantPdf(
  client: ConvexHttpClient,
  dataDir: string,
  fileName: string,
) {
  const existing = await client.query(api.grants.getByFileName, { fileName });
  if (existing?.status === "ready") {
    return { grantDocId: existing._id as Id<"grants">, extracted: false };
  }
  try {
    if (existing?.storageId && existing.status !== "uploaded") {
      await client.action(api.agent.extractGrant, { grantDocId: existing._id as Id<"grants"> });
      return { grantDocId: existing._id as Id<"grants">, extracted: true, error: null };
    }

    const bytes = await readFile(path.join(dataDir, fileName));
    const uploadUrl = await client.mutation(api.grants.generateUploadUrl, {});
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: bytes,
    });
    if (!uploadRes.ok) throw new Error(`Upload failed for ${fileName}`);
    const { storageId } = (await uploadRes.json()) as { storageId: Id<"_storage"> };
    const grantDocId = await client.mutation(api.grants.registerGrant, { storageId, fileName });
    await client.action(api.agent.extractGrant, { grantDocId });
    return { grantDocId, extracted: true, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      grantDocId: (existing?._id as Id<"grants"> | undefined) ?? null,
      extracted: false,
      error: message,
    };
  }
}

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
  const precedents = rawPrecedents.map((p) => ({
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

  const grantResults = [];
  for (const fileName of DEMO_GRANTS) {
    grantResults.push(await ensureGrantPdf(client, dataDir, fileName));
  }

  const [counts, grants] = await Promise.all([
    client.query(api.ingest.counts, {}),
    client.query(api.grants.list, {}),
  ]);

  return Response.json({ ok: true, counts, grants, grantResults });
}
