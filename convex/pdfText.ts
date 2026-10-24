"use node";

import { extractText, getDocumentProxy } from "unpdf";

/** Extract plain text from a PDF buffer in Convex Node actions. */
export async function pdfToText(data: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}
