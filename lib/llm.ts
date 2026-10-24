/**
 * Thin wrapper: Claude answers with a zod-validated JSON schema (structured outputs).
 * Invalid output → one retry with the validation error → otherwise throw.
 * Callers must turn a throw into `needs_review`, never into fake success.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const MODELS = {
  bulk: "claude-haiku-5-5", // transaction coding
  judgment: "claude-sonnet-5-5", // contract extraction, exceptions, defending decisions
} as const;

export type UserContent = Anthropic.Messages.ContentBlockParam[];

export interface ModelClient {
  json<T>(args: {
    model: string;
    system: string;
    content: UserContent;
    schema: z.ZodType<T>;
    toolName: string;
    toolDescription: string;
    maxTokens?: number;
  }): Promise<{ data: T; usage: { input: number; output: number } }>;
}

export function anthropicClient(apiKey: string | undefined = process.env.ANTHROPIC_API_KEY): ModelClient {
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set (set it in the Convex dashboard / `npx convex env set`).");
  }
  const client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 2 });
  return {
    async json({ model, system, content, schema, maxTokens = 8000 }) {
      let messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content }];
      let usage = { input: 0, output: 0 };
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await client.messages.parse({
            model,
            max_tokens: maxTokens,
            system,
            messages,
            output_config: { format: zodOutputFormat(schema) },
          });
          usage = {
            input: usage.input + res.usage.input_tokens,
            output: usage.output + res.usage.output_tokens,
          };
          if (!res.parsed_output) {
            throw new Error(`Model returned no parseable JSON (stop_reason=${res.stop_reason})`);
          }
          return { data: res.parsed_output, usage };
        } catch (e) {
          if (attempt === 1) throw e;
          messages = [
            ...messages,
            {
              role: "user",
              content: `Output did not match the schema: ${(e as Error).message.slice(0, 1500)}. Respond again with valid JSON matching the schema.`,
            },
          ];
        }
      }
      throw new Error("unreachable");
    },
  };
}

export function pdfBlock(base64: string): Anthropic.Messages.ContentBlockParam {
  return { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } };
}
