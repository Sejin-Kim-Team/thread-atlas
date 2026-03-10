import type { FunctionDeclaration } from "@google/genai"

// ---------------------------------------------------------------------------
// Internal tools – results returned to model for continued reasoning
// ---------------------------------------------------------------------------

export const INTERNAL_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "search_thread",
    description: "Search the current thread's claims and key comments for information relevant to the query",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" }
      },
      required: ["query"]
    }
  },
  {
    name: "search_memory",
    description: "Search past analyzed threads from the user's long-term memory",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" }
      },
      required: ["query"]
    }
  },
  {
    name: "analyze_claims",
    description: "Analyze evidence strength for specific claims by their IDs",
    parametersJsonSchema: {
      type: "object",
      properties: {
        claim_ids: {
          type: "array",
          items: { type: "string" },
          description: "Array of claim IDs to analyze"
        }
      },
      required: ["claim_ids"]
    }
  },
  {
    name: "compare_claims",
    description: "Compare two claims for similarities, differences, and how the argument evolved",
    parametersJsonSchema: {
      type: "object",
      properties: {
        claim_a: { type: "string", description: "First claim statement" },
        claim_b: { type: "string", description: "Second claim statement" }
      },
      required: ["claim_a", "claim_b"]
    }
  }
]

// ---------------------------------------------------------------------------
// Projection tools – SSE streamed to client, not returned to model
// ---------------------------------------------------------------------------

export const PROJECTION_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "respond",
    description: "Send a text response to the user. Always call this at least once per turn.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The response text" },
        mode: {
          type: "string",
          enum: ["answer", "clarify", "suggest"],
          description: "Response mode: answer (default), clarify (ask for clarification), suggest (recommend an action)"
        }
      },
      required: ["text", "mode"]
    }
  },
  {
    name: "focus",
    description: "Highlight a specific comment on the page",
    parametersJsonSchema: {
      type: "object",
      properties: {
        comment_id: { type: "string", description: "The comment ID to highlight" }
      },
      required: ["comment_id"]
    }
  },
  {
    name: "focus_multiple",
    description: "Highlight multiple comments on the page simultaneously",
    parametersJsonSchema: {
      type: "object",
      properties: {
        targets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              commentId: { type: "string" },
              label: { type: "string" }
            },
            required: ["commentId"]
          },
          description: "Array of comment targets to highlight"
        }
      },
      required: ["targets"]
    }
  },
  {
    name: "navigate",
    description: "Navigate the user to a URL",
    parametersJsonSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to navigate to" }
      },
      required: ["url"]
    }
  },
  {
    name: "present",
    description: "Present structured content in a sidebar, overlay, or inline panel",
    parametersJsonSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          enum: ["sidebar", "overlay", "inline"],
          description: "Where to present the content"
        },
        content_type: { type: "string", description: "Type of content to present" },
        content_text: { type: "string", description: "The content text" }
      },
      required: ["target", "content_text"]
    }
  },
  {
    name: "notify",
    description: "Show a notification message to the user",
    parametersJsonSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The notification message" },
        level: {
          type: "string",
          enum: ["status", "info", "success", "error"],
          description: "Notification severity level"
        }
      },
      required: ["message", "level"]
    }
  },
  {
    name: "copy",
    description: "Copy text to the user's clipboard",
    parametersJsonSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text to copy" }
      },
      required: ["text"]
    }
  }
]

// ---------------------------------------------------------------------------
// Tool name sets for quick classification
// ---------------------------------------------------------------------------

export const INTERNAL_TOOL_NAMES = new Set(
  INTERNAL_TOOL_DECLARATIONS.map((d) => d.name!)
)

export const PROJECTION_TOOL_NAMES = new Set(
  PROJECTION_TOOL_DECLARATIONS.map((d) => d.name!)
)

export const ALL_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  ...INTERNAL_TOOL_DECLARATIONS,
  ...PROJECTION_TOOL_DECLARATIONS
]
