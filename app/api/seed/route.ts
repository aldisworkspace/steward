import { readdir, readFile } from "fs/promises";
import path from "path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { parseBank, parseGl, parseStaff } from "@/lib/parse";
import { parseGlDetail } from "@/lib/parseGlDetail";
import type { Precedent } from "@/lib/types";
import { sameSecret } from "@/convex/passcode";

export const maxDuration = 300;

type GlSet = { dir: string; grants: readonly string[]; organizationName: string; fileHistory: boolean; glFile?: string };
/** GL-first sample sets. `holdout-v2` / `holdout-v3` / `holdout-v4` are sealed evaluation sets: every package stays live (no seeded history). */
const GL_SETS: Record<string, GlSet> = {
  v2: { dir: "steward-data-v2", grants: ["contract_city_FS-27-0412.pdf", "grant_foundation_RF-26-118.pdf"],
    organizationName: "Calle Nueva Family Center", fileHistory: true },
  "holdout-v2": { dir: "steward-holdout-v2", grants: ["agreement_county_YR-27-0093.pdf", "grant_foundation_QL-26-052.pdf"],
    organizationName: "Northfen Youth Athletics League", fileHistory: false },
  "holdout-v3": { dir: "steward-holdout-v3",
    grants: ["contract_NONA-27-0193_state_new_americans.pdf", "grant_LAFF-2026-14_linden_ash_foundation.pdf"],
    organizationName: "Cedar Hollow Refugee Welcome Center", fileHistory: false, glFile: "gl_transaction_detail_by_account.csv" },
  "holdout-v4": { dir: "steward-holdout-v4",
    grants: ["contract_OEWD-27-0058_westmere_environmental_workforce.pdf", "grant_HPF-2026-077_halvorsen_pike_foundation.pdf"],
    organizationName: "Kettle Basin Conservation Corps", fileHistory: false, glFile: "gl_transaction_detail_by_account.csv" },
};
const RECEIPT_TYPES: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

/**
 * SYNTHETIC GL-first sample (v2 demo or hold-out): GL detail is the primary record, bank statement
 * and receipts are evidence. Never reads expected_v2.json / expected_v3.json (answer keys, eval scripts only).
 */
async function seedGlSet(client: ConvexHttpClient, passcode: string | undefined, set: GlSet) {
  const dir = path.join(process.cwd(), set.dir);
  const [glText, bankText, staffText, precedentsText] = await Promise.all([
    readFile(path.join(dir, set.glFile ?? "gl_detail_qb.csv"), "utf-8"),
    readFile(path.join(dir, "bank_statement.csv"), "utf-8"),
    readFile(path.join(dir, "staff_allocation.csv"), "utf-8"),
    readFile(path.join(dir, "precedents.json"), "utf-8"),
  ]);
  const gl = parseGlDetail(glText);
  if (gl.error) throw new Error(`GL detail: ${gl.error}`);
  const bankLines = parseBank(bankText).map((t, i) => ({
    lineId: `B${String(i + 1).padStart(4, "0")}`, date: t.date, description: t.description, amountCents: t.amountCents, memo: t.memo,
  }));
  const precedents = (JSON.parse(precedentsText) as Omit<Precedent, "id">[]).map((p) => ({ date: p.date, by: p.by, ruling: p.ruling, scope: p.scope }));

  // Keep already-extracted grants of this set (restoring any parked by another set's seed); other sample sets'
  // contracts are parked with their terms, not deleted; everything else (e.g. the legacy demo grants) is dropped.
  const startedAt = Date.now();
  // A fresh sample starts from drafts: earlier signatures (e.g. from a walkthrough) are dropped.
  await client.mutation(api.packages.clearForDemoSeed, { passcode });
  const existing = await Promise.all(set.grants.map((f) => client.query(api.grants.getByFileName, { fileName: f })));
  const keepIds = existing.filter((g) => g?._id).map((g) => g!._id as Id<"grants">);
  const otherSets = Object.values(GL_SETS).filter((s) => s !== set).flatMap((s) => s.grants);
  await client.mutation(api.ingest.startGlWorkspace, {
    passcode, lines: gl.lines, bankLines, staffAllocations: parseStaff(staffText), grantDocIds: keepIds,
    dataSource: "demo", precedents, clearReceipts: true,
    keepGrantFileNames: [...set.grants], parkGrantFileNames: otherSets,
  });
  // Each GL-first set is a different (fictional) organization from the legacy demo.
  await client.mutation(api.settings.update, { passcode, organizationName: set.organizationName });

  const grantResults = [];
  for (const fileName of set.grants) grantResults.push(await ensureGrantPdf(client, dir, fileName, passcode));

  // Receipts: upload, then let Steward read them (a few at a time to stay inside the route timeout).
  const files = (await readdir(path.join(dir, "receipts"))).filter((f) => RECEIPT_TYPES[f.split(".").pop()!.toLowerCase()]).sort();
  const receiptResults: { fileName: string; ok: boolean; error?: string }[] = [];
  for (let i = 0; i < files.length; i += 6) {
    receiptResults.push(...(await Promise.all(files.slice(i, i + 6).map(async (fileName) => {
      try {
        const type = RECEIPT_TYPES[fileName.split(".").pop()!.toLowerCase()]!;
        const bytes = await readFile(path.join(dir, "receipts", fileName));
        const uploadUrl = await client.mutation(api.receipts.generateUploadUrl, { passcode });
        const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": type }, body: bytes });
        if (!res.ok) throw new Error("upload failed");
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        const receiptId = await client.mutation(api.receipts.register, { storageId, fileName, contentType: type, passcode });
        const out = await client.action(api.receiptsAgent.extractReceipt, { receiptId, passcode });
        return { fileName, ok: out.ok, error: out.error };
      } catch (e) {
        return { fileName, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }))));
  }
  await client.mutation(api.ingest.maybeAutoRunPipeline, { passcode });
  const summary = { glLines: gl.lines.length, glSkipped: gl.skipped.length, bankLines: bankLines.length, grantResults, receiptResults };
  if (!set.fileHistory) return { ...summary, history: null };
  // Demo story: July-September are already filed, so the live package is October. Wait for Steward's
  // run (it decides which lines are exceptions) inside the route budget, then file the history.
  const history = await fileDemoHistory(client, passcode, startedAt);
  return { ...summary, history };
}

const HISTORY_THROUGH = "2026-09-30";
const ROUTE_BUDGET_MS = 270_000;

async function fileDemoHistory(client: ConvexHttpClient, passcode: string | undefined, startedAt: number) {
  let quietSince: number | null = null;
  while (Date.now() - startedAt < ROUTE_BUDGET_MS) {
    const run = await client.query(api.dashboard.latestRun, {});
    const settled = !!run && run.startedAt >= startedAt - 5_000 && run.status !== "running";
    if (settled) {
      quietSince ??= Date.now();
      // A follow-up run can start right after the first; wait a few quiet seconds before filing.
      if (Date.now() - quietSince > 4_000) {
        const filed = await client.mutation(api.packages.seedDemoHistory, { through: HISTORY_THROUGH, passcode });
        return { filed, runStatus: run.status };
      }
    } else {
      quietSince = null;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return { filed: [] as string[], runStatus: "still running", note: "History not filed: Steward's run outlasted the route budget." };
}

const DEMO_GRANTS = [
  "grant_A_federal_passthrough.pdf",
  "grant_B_harbor_light_foundation.pdf",
] as const;

function assertPasscode(passcode: string | undefined) {
  const expected = process.env.DEMO_PASSCODE;
  if (!expected) return;
  if (!passcode || !sameSecret(passcode, expected)) {
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

  const setName = new URL(req.url).searchParams.get("set") ?? "";
  const glSet = Object.hasOwn(GL_SETS, setName) ? GL_SETS[setName] : undefined;
  if (glSet) {
    try {
      const client = new ConvexHttpClient(url);
      const result = await seedGlSet(client, passcode, glSet);
      const failed = result.grantResults.some((g) => g.error) || result.receiptResults.some((r) => !r.ok);
      return Response.json({ ok: !failed, ...result, counts: await client.query(api.ingest.counts, {}),
        error: failed ? "Some grant or receipt extractions failed (see grantResults / receiptResults)." : undefined });
    } catch (e) {
      return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
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

    await client.mutation(api.ingest.maybeAutoRunPipeline, { passcode });

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
