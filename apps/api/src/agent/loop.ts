import {
  appendTurn,
  setActiveTopics,
  respond,
  focus,
  focusMultiple,
  navigate,
  present,
  notify,
  copy,
  MAX_LOOPS,
  LOOP_TIMEOUT_MS,
  type ConversationContext,
  type EvaluateDonePayload,
  type StateSnapshot,
  type Projection
} from "@threadatlas/shared"
import type { SseWriter } from "../lib/sse"
import {
  createGeminiClient,
  createPartFromFunctionCall,
  createPartFromFunctionResponse,
  type Content,
  type GeminiClient,
  type GeminiToolCall
} from "../services/gemini"
import {
  ALL_TOOL_DECLARATIONS,
  INTERNAL_TOOL_NAMES,
  PROJECTION_TOOL_NAMES
} from "./tool-definitions"
import {
  searchThread,
  searchMemory,
  analyzeClaims,
  compareClaims
} from "./internal-tools"
import { buildSystemPrompt } from "./prompt"
import { createLogger } from "../runtime/logger"

const logger = createLogger("agent/loop")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizeIntent(snapshot: StateSnapshot): string {
  return snapshot.intent.transcript?.slice(0, 80) ?? snapshot.intent.intentType ?? "no transcript"
}

function buildNextContext(
  snapshot: StateSnapshot,
  actionSummary: string,
  resultSummary: string,
  incomingContext?: ConversationContext
): ConversationContext {
  const threadUrl = incomingContext?.threadUrl || snapshot.page.url
  const base: ConversationContext = incomingContext ?? {
    turns: [],
    activeTopics: [],
    threadUrl
  }

  const next = appendTurn(base, {
    intent: {
      type: snapshot.intent.type,
      summary: summarizeIntent(snapshot)
    },
    action: actionSummary,
    result: resultSummary,
    timestamp: Date.now()
  })

  if (!snapshot.semantics?.topic) {
    return next
  }

  const topics = new Set([...next.activeTopics, snapshot.semantics.topic])
  return setActiveTopics(next, [...topics])
}

function buildInitialContents(snapshot: StateSnapshot): Content[] {
  const userMessage: string[] = []

  if (snapshot.intent.transcript) {
    userMessage.push(`User said: "${snapshot.intent.transcript}"`)
  }

  if (snapshot.user.selection) {
    userMessage.push(`User selected: "${snapshot.user.selection.text}"`)
  }

  if (snapshot.user.focus) {
    userMessage.push(`User is focused on: "${snapshot.user.focus.text}"`)
  }

  if (snapshot.semantics) {
    userMessage.push(`Thread topic: ${snapshot.semantics.topic}`)
    userMessage.push(`Claims count: ${snapshot.semantics.claims.length}`)
    if (snapshot.semantics.claims.length > 0) {
      const claimsSummary = snapshot.semantics.claims
        .slice(0, 5)
        .map((c) => `  - [${c.id}] (${c.stance}) ${c.statement}`)
        .join("\n")
      userMessage.push(`Key claims:\n${claimsSummary}`)
    }
  }

  if (snapshot.sourceArticle) {
    userMessage.push(`Source article: "${snapshot.sourceArticle.title}" (${snapshot.sourceArticle.url})`)
  }

  return [
    {
      role: "user",
      parts: [{ text: userMessage.join("\n") || "Analyze the current page." }]
    }
  ]
}

// ---------------------------------------------------------------------------
// Execute internal tool
// ---------------------------------------------------------------------------

async function executeInternalTool(
  toolCall: GeminiToolCall,
  snapshot: StateSnapshot,
  geminiClient: GeminiClient,
  ownerUserId?: string
): Promise<Record<string, unknown>> {
  const args = toolCall.args

  switch (toolCall.name) {
    case "search_thread":
      return await searchThread(
        (args.query as string) ?? "",
        snapshot
      ) as unknown as Record<string, unknown>

    case "search_memory":
      return await searchMemory(
        (args.query as string) ?? "",
        ownerUserId ?? "anonymous"
      ) as unknown as Record<string, unknown>

    case "analyze_claims":
      return await analyzeClaims(
        (args.claim_ids as string[]) ?? [],
        snapshot,
        (prompt) => geminiClient.generateText(prompt)
      ) as unknown as Record<string, unknown>

    case "compare_claims":
      return await compareClaims(
        (args.claim_a as string) ?? "",
        (args.claim_b as string) ?? "",
        (prompt) => geminiClient.generateText(prompt)
      ) as unknown as Record<string, unknown>

    default:
      return { error: `Unknown internal tool: ${toolCall.name}` }
  }
}

// ---------------------------------------------------------------------------
// Execute projection tool → SSE
// ---------------------------------------------------------------------------

function executeProjectionTool(
  toolCall: GeminiToolCall,
  sseWriter: SseWriter
): void {
  const args = toolCall.args
  let projection: Projection | null = null

  switch (toolCall.name) {
    case "respond":
      projection = respond(
        (args.text as string) ?? "",
        (args.mode as "answer" | "clarify" | "suggest") ?? "answer"
      )
      break

    case "focus":
      projection = focus((args.comment_id as string) ?? "")
      break

    case "focus_multiple": {
      const targets = (args.targets as Array<{ commentId: string; label?: string }>) ?? []
      projection = focusMultiple(targets)
      break
    }

    case "navigate":
      projection = navigate((args.url as string) ?? "")
      break

    case "present":
      projection = present(
        (args.target as "sidebar" | "overlay" | "inline") ?? "sidebar",
        {
          title: (args.content_type as string) ?? "Content",
          items: [{ source: "agent", summary: (args.content_text as string) ?? "" }]
        }
      )
      break

    case "notify":
      projection = notify(
        (args.message as string) ?? "",
        (args.level as "status" | "info" | "success" | "error") ?? "info"
      )
      break

    case "copy":
      projection = copy((args.text as string) ?? "")
      break
  }

  if (projection) {
    sseWriter.projection(projection)
  }
}

// ---------------------------------------------------------------------------
// Main agent loop
// ---------------------------------------------------------------------------

export async function runAgentLoop(args: {
  stateSnapshot: StateSnapshot
  conversationContext?: ConversationContext
  ownerUserId?: string
  sseWriter: SseWriter
  geminiClient?: GeminiClient
}): Promise<EvaluateDonePayload> {
  const {
    stateSnapshot,
    conversationContext,
    ownerUserId,
    sseWriter,
    geminiClient: injectedClient
  } = args

  let geminiClient: GeminiClient
  try {
    geminiClient = injectedClient ?? createGeminiClient()
  } catch (error) {
    // ModelConfigError – Gemini env vars not set, fall back to stub
    logger.warn("agent-loop-gemini-unavailable", { error })
    const stubProjection = respond(
      "ThreadAtlas agent is not configured. Please set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION.",
      "answer"
    )
    sseWriter.projection(stubProjection)
    const donePayload: EvaluateDonePayload = {
      conversationContext: buildNextContext(stateSnapshot, "respond", "config error", conversationContext),
      memoryDelta: null
    }
    sseWriter.done(donePayload)
    return donePayload
  }

  const systemInstruction = buildSystemPrompt(stateSnapshot)
  const contents: Content[] = buildInitialContents(stateSnapshot)
  const toolsUsed: string[] = []
  let respondCalled = false
  const startTime = Date.now()

  for (let iteration = 0; iteration < MAX_LOOPS; iteration++) {
    if (Date.now() - startTime > LOOP_TIMEOUT_MS) {
      logger.warn("agent-loop-timeout", { iteration, elapsed: Date.now() - startTime })
      break
    }

    let response
    try {
      response = await geminiClient.generateWithTools(
        contents,
        ALL_TOOL_DECLARATIONS,
        systemInstruction
      )
    } catch (error) {
      logger.error("agent-loop-generate-failed", { iteration, error })
      break
    }

    // Text-only response → emit as respond projection and finish
    if (!response.toolCalls || response.toolCalls.length === 0) {
      if (response.text) {
        sseWriter.projection(respond(response.text, "answer"))
        respondCalled = true
        toolsUsed.push("respond")
      }
      break
    }

    // Process tool calls
    for (const toolCall of response.toolCalls) {
      if (INTERNAL_TOOL_NAMES.has(toolCall.name)) {
        // Execute internal tool and feed result back to model
        const result = await executeInternalTool(toolCall, stateSnapshot, geminiClient, ownerUserId)
        toolsUsed.push(toolCall.name)

        // Add model's function call to history
        contents.push({
          role: "model",
          parts: [createPartFromFunctionCall(toolCall.name, toolCall.args)]
        })

        // Add function response to history
        contents.push({
          role: "user",
          parts: [createPartFromFunctionResponse(
            toolCall.id ?? toolCall.name,
            toolCall.name,
            result
          )]
        })
      } else if (PROJECTION_TOOL_NAMES.has(toolCall.name)) {
        // Execute projection tool → SSE stream
        executeProjectionTool(toolCall, sseWriter)
        toolsUsed.push(toolCall.name)
        if (toolCall.name === "respond") {
          respondCalled = true
        }

        // Add acknowledged response to model history
        contents.push({
          role: "model",
          parts: [createPartFromFunctionCall(toolCall.name, toolCall.args)]
        })
        contents.push({
          role: "user",
          parts: [createPartFromFunctionResponse(
            toolCall.id ?? toolCall.name,
            toolCall.name,
            { status: "acknowledged" }
          )]
        })
      } else {
        logger.warn("agent-loop-unknown-tool", { toolName: toolCall.name })
      }
    }
  }

  // Ensure at least one respond projection was sent
  if (!respondCalled) {
    sseWriter.projection(respond("Analysis complete.", "answer"))
  }

  logger.info("agent-loop-completed", {
    iterations: toolsUsed.length,
    toolsUsed,
    elapsed: Date.now() - startTime
  })

  const actionSummary = toolsUsed.length > 0 ? toolsUsed.join(", ") : "respond"
  const resultSummary = `Agent used ${toolsUsed.length} tool calls`

  const donePayload: EvaluateDonePayload = {
    conversationContext: buildNextContext(stateSnapshot, actionSummary, resultSummary, conversationContext),
    memoryDelta: null
  }

  sseWriter.done(donePayload)
  return donePayload
}
