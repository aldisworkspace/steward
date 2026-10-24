/**
 * xAI Grok API adapter implementing the same ModelClient contract as lib/llm.ts.
 */
import { z } from "zod";
import type { ModelClient, UserContent } from "./llm";

const GROK_BASE = "https://api.x.ai/v1";

/** Map pipeline model ids to xAI model names. */
const GROK_MODEL: Record<string, string> = {
  "claude-haiku-5-5": "grok-4-fast-non-reasoning",
  "claude-sonnet-5-5": "grok-4-0709",
};

function toParameters(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

async function blocksToUserText(content: UserContent): Promise<string> {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text") {
      parts.push(block.text);
      continue;
    }
    if (block.type === "document" && block.source.type === "base64") {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: Buffer.from(block.source.data, "base64") });
      try {
        const text = await parser.getText();
        parts.push(`--- PDF text ---\n${text.text}`);
      } finally {
        await parser.destroy();
      }
    }
  }
  return parts.join("\n\n");
}

export function grokClient(apiKey: string | undefined = process.env.XAI_API_KEY): ModelClient {
  if (!apiKey) {
    throw new Error("XAI_API_KEY is not set (set it via `npx convex env set XAI_API_KEY ...`).");
  }
  return {
    async json({ model, system, content, schema, toolName, toolDescription, maxTokens = 8000 }) {
      const grokModel = GROK_MODEL[model] ?? model;
      const userText = await blocksToUserText(content);
      const tools = [
        {
          type: "function" as const,
          function: {
            name: toolName,
            description: toolDescription,
            parameters: toParameters(schema),
          },
        },
      ];
      let messages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: system },
        { role: "user", content: userText },
      ];
      let usage = { input: 0, output: 0 };

      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(`${GROK_BASE}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: grokModel,
            max_tokens: maxTokens,
            messages,
            tools,
            tool_choice: { type: "function", function: { name: toolName } },
          }),
        });
        const body = (await res.json()) as {
          error?: string | { message?: string };
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
        };
        if (!res.ok) {
          const err =
            typeof body.error === "string"
              ? body.error
              : body.error?.message ?? JSON.stringify(body);
          throw new Error(`Grok API HTTP ${res.status}: ${err}`);
        }
        usage = {
          input: usage.input + (body.usage?.prompt_tokens ?? 0),
          output: usage.output + (body.usage?.completion_tokens ?? 0),
        };
        const call = body.choices?.[0]?.message?.tool_calls?.[0]?.function;
        if (!call?.arguments) {
          throw new Error(`Model returned no ${toolName} call`);
        }
        let raw: unknown;
        try {
          raw = JSON.parse(call.arguments);
        } catch {
          throw new Error(`Invalid JSON in ${toolName} arguments`);
        }
        const parsed = schema.safeParse(raw);
        if (parsed.success) return { data: parsed.data, usage };
        if (attempt === 1) {
          throw new Error(`Invalid ${toolName} output: ${parsed.error.message.slice(0, 500)}`);
        }
        messages = [
          ...messages,
          { role: "assistant", content: call.arguments },
          {
            role: "user",
            content: `Schema validation failed: ${parsed.error.message.slice(0, 1500)}. Call ${toolName} again with corrected JSON.`,
          },
        ];
      }
      throw new Error("unreachable");
    },
  };
}
