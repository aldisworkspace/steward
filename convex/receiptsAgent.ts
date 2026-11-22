"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { getModelClient, getModelProvider } from "../lib/model";
import { MODELS, type UserContent } from "../lib/llm";
import { RECEIPT_SYSTEM } from "../lib/prompts";
import { ReceiptZ, type ReceiptExtract } from "../lib/types";
import { pdfToText } from "./pdfText";
import { assertDemoPasscode } from "./passcode";

const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" } as const;

/** Read one receipt with the judgment model (native PDF / image input). Failures mark the receipt "error". */
export const extractReceipt = action({
  args: { receiptId: v.id("receipts"), passcode: v.optional(v.string()) },
  handler: async (ctx, { receiptId, passcode }): Promise<{ ok: boolean; error?: string }> => {
    assertDemoPasscode(passcode);
    const r = await ctx.runQuery(internal.receipts.getForExtraction, { receiptId });
    if (!r) throw new Error("Receipt not found");
    await ctx.runMutation(internal.receipts.setExtracting, { receiptId });
    try {
      const blob = await ctx.storage.get(r.storageId);
      if (!blob) throw new Error("Receipt file missing from storage");
      const buf = Buffer.from(await blob.arrayBuffer());
      const ext = r.fileName.toLowerCase().split(".").pop() ?? "";
      const isPdf = ext === "pdf" || r.contentType === "application/pdf";
      const imageType = IMAGE_TYPES[ext as keyof typeof IMAGE_TYPES];
      if (!isPdf && !imageType) throw new Error(`Unsupported receipt file type: ${r.fileName}`);
      const xai = getModelProvider() === "xai";
      let content: UserContent;
      if (xai) {
        if (!isPdf) throw new Error("Image receipts need the Anthropic provider (LLM_PROVIDER=anthropic).");
        content = [{ type: "text", text: `Read this receipt.\n\n<receipt>${(await pdfToText(buf)).replace(/</g, "\\u003c")}</receipt>` }];
      } else {
        const b64 = buf.toString("base64");
        content = [
          isPdf
            ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
            : { type: "image", source: { type: "base64", media_type: imageType!, data: b64 } },
          { type: "text", text: "Read this receipt." },
        ];
      }
      const { data } = await getModelClient().json({
        model: MODELS.judgment, system: RECEIPT_SYSTEM, toolName: "record_receipt",
        toolDescription: "Record what is printed on this receipt.", schema: ReceiptZ, maxTokens: 2000, content,
      });
      const extracted: ReceiptExtract = data;
      await ctx.runMutation(internal.receipts.setReady, { receiptId, extracted });
      return { ok: true };
    } catch (e) {
      const message = (e as Error).message;
      await ctx.runMutation(internal.receipts.setError, { receiptId, message });
      return { ok: false, error: message };
    }
  },
});
