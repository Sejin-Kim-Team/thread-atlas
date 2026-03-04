import type {
  EvaluateDonePayload,
  EvaluateErrorPayload,
  EvaluateRequest,
  Projection
} from "@threadatlas/shared"

export async function callEvaluate(args: {
  apiBaseUrl: string
  request: EvaluateRequest
  signal: AbortSignal
  onProjection: (projection: Projection) => void
  onDone: (payload: EvaluateDonePayload) => void
  onError: (payload: EvaluateErrorPayload) => void
}): Promise<void> {
  const { apiBaseUrl, request, signal, onProjection, onDone, onError } = args

  const response = await fetch(`${apiBaseUrl}/api/evaluate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(request),
    signal
  })

  if (!response.body) {
    onError({ code: "INTERNAL_ERROR", message: "SSE body is missing" })
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let currentEvent = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split("\n")
    buffer = parts.pop() ?? ""

    for (const line of parts) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim()
      } else if (line.startsWith("data: ")) {
        const payload = JSON.parse(line.slice(6)) as Projection | EvaluateDonePayload | EvaluateErrorPayload

        if (currentEvent === "projection") {
          onProjection(payload as Projection)
        } else if (currentEvent === "done") {
          onDone(payload as EvaluateDonePayload)
        } else if (currentEvent === "error") {
          onError(payload as EvaluateErrorPayload)
        }
      }
    }
  }
}
