export interface GeminiClient {
  generateText(prompt: string): Promise<string>
}

export function createGeminiClient(): GeminiClient {
  return {
    async generateText(prompt: string): Promise<string> {
      return `stubbed gemini output for prompt length=${prompt.length}`
    }
  }
}
