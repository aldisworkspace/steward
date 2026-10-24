import { anthropicClient } from "./llm";
import { grokClient } from "./grok";
import type { ModelClient } from "./llm";

export function getModelProvider(): "anthropic" | "xai" {
  const p = process.env.LLM_PROVIDER ?? "anthropic";
  if (p === "anthropic" || p === "xai") return p;
  throw new Error(`Unknown LLM_PROVIDER: ${p} (use "anthropic" or "xai")`);
}

export function getModelClient(): ModelClient {
  return getModelProvider() === "xai" ? grokClient() : anthropicClient();
}
