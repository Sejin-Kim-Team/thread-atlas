import type { StateSnapshot } from "@threadatlas/shared"

export function buildSystemPrompt(snapshot: StateSnapshot): string {
  return [
    "You are the Agent Brain for ThreadAtlas.",
    "Respond in the same language as the user.",
    `Current URL: ${snapshot.page.url}`,
    `Intent: ${snapshot.intent.intentType ?? "general"}`
  ].join("\n")
}
