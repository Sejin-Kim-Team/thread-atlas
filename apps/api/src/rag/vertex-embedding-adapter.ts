import { GoogleAuth } from "google-auth-library"
import { createLogger } from "../runtime/logger"

export const CANONICAL_VERTEX_EMBEDDING_MODEL = "gemini-embedding-001"
export const CANONICAL_VERTEX_EMBEDDING_DIMS = 768

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform"
const EMBEDDING_ENDPOINT_PATH =
  "publishers/google/models/gemini-embedding-001:predict"
const logger = createLogger("rag/vertex-embedding")

export type EmbeddingTaskType =
  | "RETRIEVAL_DOCUMENT"
  | "RETRIEVAL_QUERY"
  | "SEMANTIC_SIMILARITY"

export type EmbeddingProviderErrorCode =
  | "EMBEDDING_PROVIDER_CONFIG_MISSING"
  | "EMBEDDING_PROVIDER_REQUEST_FAILED"
  | "EMBEDDING_PROVIDER_INVALID_RESPONSE"

export class EmbeddingProviderError extends Error {
  readonly code: EmbeddingProviderErrorCode
  readonly status: number | undefined

  constructor(code: EmbeddingProviderErrorCode, message: string, status?: number) {
    super(message)
    this.name = "EmbeddingProviderError"
    this.code = code
    this.status = status
  }
}

export interface VertexEmbeddingResult {
  embeddingModel: string
  embeddingDims: number
  embedding: number[]
}

interface VertexEmbeddingConfig {
  project: string
  location: string
}

interface VertexPredictResponse {
  predictions?: Array<{
    embeddings?: {
      values?: number[]
    }
    values?: number[]
  }>
}

interface VertexPredictRequestBody {
  instances: Array<{
    task_type: EmbeddingTaskType
    content: string
  }>
  parameters: {
    outputDimensionality: number
  }
}

let authClient: GoogleAuth | null = null

function getGoogleAuth(): GoogleAuth {
  if (!authClient) {
    authClient = new GoogleAuth({
      scopes: [CLOUD_PLATFORM_SCOPE]
    })
  }
  return authClient
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    return ""
  }
  return value.trim()
}

function resolveEmbeddingConfig(): VertexEmbeddingConfig {
  const project = normalizeText(process.env.GOOGLE_CLOUD_PROJECT)
  const location = normalizeText(process.env.GOOGLE_CLOUD_LOCATION)
  if (!project || !location) {
    throw new EmbeddingProviderError(
      "EMBEDDING_PROVIDER_CONFIG_MISSING",
      "GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION are required"
    )
  }
  return {
    project,
    location
  }
}

function buildEndpoint(config: VertexEmbeddingConfig): string {
  return `https://${config.location}-aiplatform.googleapis.com/v1/projects/${config.project}/locations/${config.location}/${EMBEDDING_ENDPOINT_PATH}`
}

function stringifyProviderPayload(payload: unknown): string {
  if (payload == null) {
    return ""
  }
  if (typeof payload === "string") {
    return payload
  }
  try {
    return JSON.stringify(payload)
  } catch {
    return String(payload)
  }
}

function assertEmbeddingVector(values: unknown): number[] {
  if (!Array.isArray(values)) {
    throw new EmbeddingProviderError(
      "EMBEDDING_PROVIDER_INVALID_RESPONSE",
      "Vertex response does not include embeddings.values"
    )
  }
  if (values.length !== CANONICAL_VERTEX_EMBEDDING_DIMS) {
    throw new EmbeddingProviderError(
      "EMBEDDING_PROVIDER_INVALID_RESPONSE",
      `Vertex embedding length mismatch: expected ${CANONICAL_VERTEX_EMBEDDING_DIMS}, got ${values.length}`
    )
  }
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new EmbeddingProviderError(
        "EMBEDDING_PROVIDER_INVALID_RESPONSE",
        "Vertex embedding contains non-finite number"
      )
    }
  }
  return values
}

function extractVectorFromPrediction(response: VertexPredictResponse): number[] {
  const prediction = response.predictions?.[0]
  const values = prediction?.embeddings?.values ?? prediction?.values
  return assertEmbeddingVector(values)
}

export function isEmbeddingProviderError(
  error: unknown
): error is EmbeddingProviderError {
  return error instanceof EmbeddingProviderError
}

export async function embedTextWithVertex(
  text: string,
  taskType: EmbeddingTaskType = "RETRIEVAL_DOCUMENT"
): Promise<VertexEmbeddingResult> {
  const content = normalizeText(text)
  if (!content) {
    throw new EmbeddingProviderError(
      "EMBEDDING_PROVIDER_INVALID_RESPONSE",
      "embedding input text is required"
    )
  }

  const config = resolveEmbeddingConfig()
  const endpoint = buildEndpoint(config)

  const auth = getGoogleAuth()
  const client = await auth.getClient()
  const body: VertexPredictRequestBody = {
    instances: [
      {
        task_type: taskType,
        content
      }
    ],
    parameters: {
      outputDimensionality: CANONICAL_VERTEX_EMBEDDING_DIMS
    }
  }

  let payload: VertexPredictResponse
  try {
    logger.debug("vertex-embedding-request-started", {
      model: CANONICAL_VERTEX_EMBEDDING_MODEL,
      taskType,
      inputLength: content.length,
      embeddingDims: CANONICAL_VERTEX_EMBEDDING_DIMS,
      location: config.location
    })
    // 인증 헤더 직렬화 이슈를 피하기 위해 auth client의 request 경로를 사용한다.
    const response = await client.request<VertexPredictResponse>({
      url: endpoint,
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      data: body
    })
    payload = response.data
  } catch (error) {
    const status =
      typeof error === "object" && error && "response" in error
        ? ((error as { response?: { status?: number; data?: unknown } }).response?.status ??
          undefined)
        : undefined
    const providerPayload =
      typeof error === "object" && error && "response" in error
        ? (error as { response?: { data?: unknown } }).response?.data
        : undefined
    const detail = stringifyProviderPayload(providerPayload)
    const message = detail
      ? `Vertex embedding request failed with status ${status ?? "unknown"}: ${detail}`
      : `Vertex embedding request failed with status ${status ?? "unknown"}`
    logger.error("vertex-embedding-request-failed", {
      model: CANONICAL_VERTEX_EMBEDDING_MODEL,
      taskType,
      inputLength: content.length,
      embeddingDims: CANONICAL_VERTEX_EMBEDDING_DIMS,
      location: config.location,
      status,
      error: message
    })
    throw new EmbeddingProviderError(
      "EMBEDDING_PROVIDER_REQUEST_FAILED",
      message,
      status
    )
  }

  const embedding = extractVectorFromPrediction(payload)
  logger.info("vertex-embedding-request-completed", {
    model: CANONICAL_VERTEX_EMBEDDING_MODEL,
    taskType,
    inputLength: content.length,
    embeddingDims: embedding.length,
    location: config.location
  })
  return {
    embeddingModel: CANONICAL_VERTEX_EMBEDDING_MODEL,
    embeddingDims: CANONICAL_VERTEX_EMBEDDING_DIMS,
    embedding
  }
}
