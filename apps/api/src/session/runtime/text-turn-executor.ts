import type { RuntimeV2ToolResultPayload } from "@threadatlas/shared/runtime"
import type {
  FrontendToolRequest,
  SemanticTurnExecutionResult
} from "../semantic-runtime-manager"
import { SemanticRuntimeManager } from "../semantic-runtime-manager"

export class TextTurnExecutor {
  constructor(private readonly runtime: SemanticRuntimeManager) {}

  async run(args: {
    principalUserId: string
    sessionId: string
    text: string
    onTurnStarted?: (turnId: string) => Promise<void> | void
    requestFrontendTool: (
      request: FrontendToolRequest
    ) => Promise<RuntimeV2ToolResultPayload | null>
  }): Promise<SemanticTurnExecutionResult> {
    return this.runtime.runTextTurn({
      principalUserId: args.principalUserId,
      sessionId: args.sessionId,
      text: args.text,
      onTurnStarted: args.onTurnStarted,
      requestFrontendTool: args.requestFrontendTool
    })
  }
}
