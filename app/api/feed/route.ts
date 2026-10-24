import { readFile } from "fs/promises";
import path from "path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { detectAndParseBank } from "@/lib/parseFlexible";
import { parseGl } from "@/lib/parse";

function assertPasscode(passcode: string | undefined) {
  const expected = process.env.DEMO_PASSCODE;
  if (!expected) return;
  if (passcode !== expected) throw new Error("Invalid or missing demo passcode.");
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return Response.json({ ok: false, error: "NEXT_PUBLIC_CONVEX_URL is not set" }, { status: 500 });

  let passcode: string | undefined;
  let csvText: string | undefined;
  let useDemoSeptOct = false;
  try {
    const body = (await req.json()) as { passcode?: string; csv?: string; demoSeptOct?: boolean };
    passcode = body.passcode;
    csvText = body.csv;
    useDemoSeptOct = !!body.demoSeptOct;
  } catch {
    passcode = undefined;
  }

  try {
    assertPasscode(passcode);
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 403 });
  }

  try {
    if (useDemoSeptOct || !csvText) {
      const full = await readFile(
        path.join(process.cwd(), "steward-data/bank_transactions_q3_2026.csv"),
        "utf-8",
      );
      const lines = full.trim().split("\n");
      const header = lines[0]!;
      const septOct = lines.filter((line, i) => {
        if (i === 0) return false;
        const date = line.split(",")[0] ?? "";
        const [m] = date.split("/");
        return parseInt(m, 10) >= 9;
      });
      csvText = [header, ...septOct].join("\n");
    }

    const parsed = detectAndParseBank(csvText!);
    if (parsed.error) return Response.json({ ok: false, error: parsed.error }, { status: 400 });

    const glAll = parseGl(
      await readFile(path.join(process.cwd(), "steward-data/gl_export_bookkeeper.csv"), "utf-8"),
    );
    const glRows = parsed.txns
      .map((t) =>
        glAll.find(
          (g) =>
            g.date === t.date && g.amountCents === t.amountCents && g.description === t.description,
        ),
      )
      .filter(Boolean)
      .map((g) => g!);

    const client = new ConvexHttpClient(url);
    const result = await client.mutation(api.ingest.appendBankTransactions, {
      passcode,
      transactions: parsed.txns,
      glRows,
    });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
