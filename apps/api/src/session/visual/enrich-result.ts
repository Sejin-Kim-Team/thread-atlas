import type { NormalizedEnrichDetail, NormalizedEnrichEvidence } from "./types"

const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024
const SUPPORTED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg"] as const
type NormalizedInlineImage = NonNullable<NormalizedEnrichEvidence["image"]>

function isStrictBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) {
    return false
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    return false
  }

  const paddingMatch = value.match(/=+$/)
  if (paddingMatch && paddingMatch[0].length > 2) {
    return false
  }

  return Buffer.from(value, "base64").toString("base64") === value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function sanitizePromptText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength)
}

export function normalizeEnrichDetailForPrompt(
  enrichDetail?: Record<string, unknown>
): NormalizedEnrichDetail | null {
  if (!enrichDetail) {
    return null
  }

  const normalized: NormalizedEnrichDetail = {}

  const detailText = asString(enrichDetail.text)
  if (detailText) {
    normalized.textPreview = sanitizePromptText(detailText, 300)
  }

  const htmlSnippet = asString(enrichDetail.htmlSnippet)
  if (htmlSnippet) {
    const strippedScript = htmlSnippet.replace(/<script[\s\S]*?<\/script>/gi, " ")
    normalized.htmlPreview = sanitizePromptText(strippedScript, 240)
  }

  if (isObject(enrichDetail.attributes)) {
    const safeAttributes: Record<string, string> = {}
    const keys = Object.keys(enrichDetail.attributes)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 12)
    for (const key of keys) {
      const lowered = key.toLowerCase()
      if (lowered.startsWith("on")) {
        continue
      }
      const isSafeKey =
        lowered === "id" ||
        lowered === "class" ||
        lowered === "role" ||
        lowered === "title" ||
        lowered.startsWith("aria-") ||
        lowered.startsWith("data-")
      if (!isSafeKey) {
        continue
      }
      const rawValue = asString(enrichDetail.attributes[key])
      if (!rawValue) {
        continue
      }
      safeAttributes[key] = sanitizePromptText(rawValue, 80)
    }
    if (Object.keys(safeAttributes).length > 0) {
      normalized.attributes = safeAttributes
    }
  }

  if (isObject(enrichDetail.bounds)) {
    const x = asFiniteNumber(enrichDetail.bounds.x)
    const y = asFiniteNumber(enrichDetail.bounds.y)
    const width = asFiniteNumber(enrichDetail.bounds.width)
    const height = asFiniteNumber(enrichDetail.bounds.height)
    if (x !== null && y !== null && width !== null && height !== null) {
      normalized.bounds = { x, y, width, height }
    }
  }

  if (Object.keys(normalized).length === 0) {
    return null
  }

  return normalized
}

function normalizeInlineImage(
  imageBase64: unknown,
  mimeType: unknown
):
  | { ok: true; image?: NormalizedInlineImage }
  | { ok: false; message: string } {
  const normalizedBase64 = asString(imageBase64)?.replace(/\s+/g, "")
  if (!normalizedBase64) {
    return {
      ok: true
    }
  }

  const normalizedMimeType = asString(mimeType)
  if (
    !normalizedMimeType ||
    !SUPPORTED_IMAGE_MIME_TYPES.includes(
      normalizedMimeType as (typeof SUPPORTED_IMAGE_MIME_TYPES)[number]
    )
  ) {
    return {
      ok: false,
      message: "mimeType must be image/png or image/jpeg when imageBase64 is provided"
    }
  }

  if (!isStrictBase64(normalizedBase64)) {
    return {
      ok: false,
      message: "imageBase64 is not valid base64"
    }
  }

  const bytes = Buffer.from(normalizedBase64, "base64")
  if (bytes.length === 0) {
    return {
      ok: false,
      message: "imageBase64 is empty"
    }
  }
  if (bytes.length > MAX_INLINE_IMAGE_BYTES) {
    return {
      ok: false,
      message: "imageBase64 exceeds maximum allowed size"
    }
  }

  return {
    ok: true,
    image: {
      mimeType: normalizedMimeType as NormalizedInlineImage["mimeType"],
      imageBytes: normalizedBase64
    }
  }
}

export function normalizeEnrichEvidence(input: {
  requestKind: NormalizedEnrichEvidence["requestKind"]
  targetRef: Record<string, unknown>
  capturedAt: string
  detail?: Record<string, unknown>
  imageBase64?: unknown
  mimeType?: unknown
}): { ok: true; evidence: NormalizedEnrichEvidence } | { ok: false; message: string } {
  const detail = normalizeEnrichDetailForPrompt(input.detail)
  const normalizedImage = normalizeInlineImage(input.imageBase64, input.mimeType)
  if (!normalizedImage.ok) {
    return normalizedImage
  }
  if (!detail && !normalizedImage.image) {
    return {
      ok: false,
      message: "context.enrich.result requires detail or imageBase64 when status is ok"
    }
  }

  const evidence: NormalizedEnrichEvidence = {
    requestKind: input.requestKind,
    targetRef: input.targetRef,
    capturedAt: input.capturedAt
  }
  if (detail) {
    evidence.detail = detail
  }
  if (normalizedImage.image) {
    evidence.image = normalizedImage.image
  }

  return {
    ok: true,
    evidence
  }
}
