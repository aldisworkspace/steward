/**
 * Thin wrapper: force Claude to answer through one tool whose input schema comes from zod,
 * then validate. Invalid output → one retry with the validation error → otherwise throw.
 * Callers must turn a throw into `needs_review`, never into fake success.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export const MODELS = {
  bulk: "claude-haiku-5-5",     // transaction coding
  judgment: "claude-sonnet-5-5", // contract extraction, exceptions, defending decisions
} as const;

export type UserContent = Anthropic.Messages.ContentBlockParam[];

export interface ModelClient {
  json<T>(args: { model: string; system: string; content: UserContent; schema: z.ZodType<T>;
    toolName: string; toolDescription: string; maxTokens?: number }): Promise<{ data: T; usage: { input: number; output: number } }>;
}

function toInputSchema(schema: z.ZodType): Anthropic.Messages.Tool.InputSchema {
  const js = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete js.$schema;
  return js as Anthropic.Messages.Tool.InputSchema;
}

export function anthropicClient(apiKey: string | undefined = process.env.ANTHROPIC_API_KEY): ModelClient {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set (set it in the Convex dashboard / `npx convex env set`).");
  const client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 2 });
  return {
    async json({ model, system, content, schema, toolName, toolDescription, maxTokens = 8000 }) {
      const tool = { name: toolName, description: toolDescription, input_schema: toInputSchema(schema) };
      let messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content }];
      let usage = { input: 0, output: 0 };
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await client.messages.create({
          model, max_tokens: maxTokens, system, messages,
          tools: [tool], tool_choice: { type: "tool", name: toolName },
        });
        usage = { input: usage.input + res.usage.input_tokens, output: usage.output + res.usage.output_tokens };
        const block = res.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
        if (!block) throw new Error(`Model returned no ${toolName} call (stop_reason=${res.stop_reason})`);
        const parsed = schema.safeParse(block.input);
        if (parsed.success) return { data: parsed.data, usage };
        if (attempt === 1) throw new Error(`Invalid ${toolName} output: ${parsed.error.message.slice(0, 500)}`);
        messages = [...messages,
          { role: "assistant", content: res.content },
          { role: "user", content: [{ type: "tool_result", tool_use_id: block.id, is_error: true,
            content: `Schema validation failed: ${parsed.error.message.slice(0, 1500)}. Call ${toolName} again with corrected input.` }] }];
      }
      throw new Error("unreachable");
    },
  };
}

export function pdfBlock(base64: string): Anthropic.Messages.ContentBlockParam {
  return { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } };
}
