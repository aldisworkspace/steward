/**
 * Judge-scenario bank CSV: parsing / ingest shape only (no rule-hit assertions).
 *   npx tsx scripts/verify-judge-scenario.ts
 */
import { readFileSync } from "node:fs";
import { detectAndParseBank } from "../lib/parseFlexible";

const JUDGE = "test-fixtures/judge-scenario/bank.csv";

const bankText = readFileSync(JUDGE, "utf8");
const { txns, error } = detectAndParseBank(bankText);
if (error) {
  console.error(error);
  process.exit(1);
}
if (txns.length < 1) {
  console.error("Expected at least one parsed transaction row.");
  process.exit(1);
}

const hasAmount = txns.every((t) => Number.isFinite(t.amountCents) && t.date && t.txnId);
if (!hasAmount) {
  console.error("Parsed rows missing required fields.");
  process.exit(1);
}

console.log(`OK: parsed ${txns.length} bank rows from judge CSV format.`);
