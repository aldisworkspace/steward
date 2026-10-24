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

function assertPasscode(passcode: string | undefined) {
  const expected = process.env.DEMO_PASSCODE;
  if (!expected) return;
  if (passcode !== expected) {
    throw new Error("Invalid or missing demo passcode.");
  }
}

async function ensureGrantPdf(
  client: ConvexHttpClient,
  dataDir: string,
  fileName: string,
  passcode: string | undefined,
) {
  const existing = await client.query(api.grants.getByFileName, { fileName });
  if (existing?.status === "ready" && existing.terms) {
    return { grantDocId: existing._id as Id<"grants">, extracted: false, skipped: true, error: null };
  }
  try {
    if (existing?.storageId) {
      await client.action(api.agent.extractGrant, { grantDocId: existing._id as Id<"grants">, passcode });
      return { grantDocId: existing._id as Id<"grants">, extracted: true, error: null };
    }

    const bytes = await readFile(path.join(dataDir, fileName));
    const uploadUrl = await client.mutation(api.grants.generateUploadUrl, { passcode });
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: bytes,
    });
    if (!uploadRes.ok) throw new Error(`Upload failed for ${fileName}`);
    const { storageId } = (await uploadRes.json()) as { storageId: Id<"_storage"> };
    const grantDocId = await client.mutation(api.grants.registerGrant, {
      storageId,
      fileName,
      passcode,
      source: "demo",
    });
    await client.action(api.agent.extractGrant, { grantDocId, passcode });
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

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    return Response.json({ ok: false, error: "NEXT_PUBLIC_CONVEX_URL is not set" }, { status: 500 });
  }

  let passcode: string | undefined;
  try {
    const body = (await req.json()) as { passcode?: string };
    passcode = body.passcode;
  } catch {
    passcode = undefined;
  }

  try {
    assertPasscode(passcode);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: message }, { status: 403 });
  }

  const dataDir = path.join(process.cwd(), "steward-data");
  try {
    const [bankText, glText, staffText, precedentsText] = await Promise.all([
      readFile(path.join(dataDir, "bank_transactions_q3_2026.csv"), "utf-8"),
      readFile(path.join(dataDir, "gl_export_bookkeeper.csv"), "utf-8"),
      readFile(path.join(dataDir, "staff_allocation.csv"), "utf-8"),
      readFile(path.join(dataDir, "precedents.json"), "utf-8"),
    ]);

    const transactions = parseBank(bankText).filter((t) => t.date < "2026-09-01");
    const txnIds = new Set(transactions.map((t) => t.txnId));
    const glRows = parseGl(glText).filter((g) => txnIds.has(g.bankRef));
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
      passcode,
      transactions,
      glRows,
      staffAllocations,
      precedents,
    });

    const grantResults = [];
    for (const fileName of DEMO_GRANTS) {
      grantResults.push(await ensureGrantPdf(client, dataDir, fileName, passcode));
    }

    const grantFailed = grantResults.some((g) => g.error);
    const [counts, grants] = await Promise.all([
      client.query(api.ingest.counts, {}),
      client.query(api.grants.list, {}),
    ]);

    return Response.json({
      ok: !grantFailed,
      counts,
      grants,
      grantResults,
      error: grantFailed ? "One or more grant extractions failed." : undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
