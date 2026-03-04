import type { TokenResponse } from "@threadatlas/shared"

export class TokenManager {
  private tokenExpiresAt = 0
  private timer: number | null = null

  constructor(
    private readonly requestToken: () => Promise<TokenResponse>,
    private readonly onRenewed: (token: string) => Promise<void>,
    private readonly onFatalError: (error: Error) => void
  ) {}

  async initialize(): Promise<string> {
    const response = await this.requestToken()
    this.tokenExpiresAt = response.expiresAt
    this.scheduleRenewal()
    return response.token
  }

  dispose(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
  }

  private scheduleRenewal(): void {
    const msUntilRenewal = this.tokenExpiresAt * 1000 - Date.now() - 2 * 60 * 1000
    const waitMs = Math.max(1000, msUntilRenewal)

    this.timer = window.setTimeout(async () => {
      let retries = 3
      while (retries > 0) {
        try {
          const next = await this.requestToken()
          this.tokenExpiresAt = next.expiresAt
          await this.onRenewed(next.token)
          this.scheduleRenewal()
          return
        } catch (error) {
          retries -= 1
          if (retries > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, 1000))
          } else {
            this.onFatalError(error instanceof Error ? error : new Error("token renewal failed"))
          }
        }
      }
    }, waitMs)
  }
}
