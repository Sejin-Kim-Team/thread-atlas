import type { SemanticCropRect, SemanticCropTargetResponse } from "@threadatlas/shared/runtime"

export interface ResolvedSemanticCropArea {
  left: number
  top: number
  width: number
  height: number
}

const MIN_CROP_DIMENSION = 12
const ABSOLUTE_PADDING_PX = 24
const RELATIVE_PADDING_RATIO = 0.08

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isFiniteRect(rect: SemanticCropRect | null | undefined): rect is SemanticCropRect {
  return Boolean(
    rect &&
      Number.isFinite(rect.left) &&
      Number.isFinite(rect.top) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      rect.width > 0 &&
      rect.height > 0
  )
}

function withPadding(rect: SemanticCropRect): ResolvedSemanticCropArea {
  const padding = Math.max(
    ABSOLUTE_PADDING_PX,
    Math.round(Math.max(rect.width, rect.height) * RELATIVE_PADDING_RATIO)
  )
  return {
    left: rect.left - padding,
    top: rect.top - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2
  }
}

export function resolveSemanticCropArea(
  target: SemanticCropTargetResponse
): ResolvedSemanticCropArea | null {
  const viewport = target.viewportRect
  if (!isFiniteRect(viewport)) {
    return null
  }

  const baseRect = isFiniteRect(target.rootRect)
    ? target.rootRect
    : isFiniteRect(target.focusRect)
      ? target.focusRect
      : null
  if (!baseRect) {
    return null
  }

  const padded = withPadding(baseRect)
  const clampedLeft = clamp(padded.left, viewport.left, viewport.right)
  const clampedTop = clamp(padded.top, viewport.top, viewport.bottom)
  const clampedRight = clamp(padded.left + padded.width, viewport.left, viewport.right)
  const clampedBottom = clamp(padded.top + padded.height, viewport.top, viewport.bottom)
  const width = clampedRight - clampedLeft
  const height = clampedBottom - clampedTop

  if (width < MIN_CROP_DIMENSION || height < MIN_CROP_DIMENSION) {
    return null
  }

  return {
    left: clampedLeft,
    top: clampedTop,
    width,
    height
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("failed to decode viewport capture"))
    image.src = dataUrl
  })
}

export async function cropViewportBase64ToPng(
  viewportBase64: string,
  target: SemanticCropTargetResponse
): Promise<string | null> {
  const cropArea = resolveSemanticCropArea(target)
  if (!cropArea || !viewportBase64) {
    return null
  }

  const image = await loadImage(`data:image/jpeg;base64,${viewportBase64}`)
  const viewportWidth = target.viewportRect.width
  const viewportHeight = target.viewportRect.height
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return null
  }

  const scaleX = image.naturalWidth / viewportWidth
  const scaleY = image.naturalHeight / viewportHeight
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    return null
  }

  const sourceX = Math.max(0, Math.round(cropArea.left * scaleX))
  const sourceY = Math.max(0, Math.round(cropArea.top * scaleY))
  const sourceWidth = Math.max(1, Math.round(cropArea.width * scaleX))
  const sourceHeight = Math.max(1, Math.round(cropArea.height * scaleY))

  const canvas = document.createElement("canvas")
  canvas.width = sourceWidth
  canvas.height = sourceHeight
  const context = canvas.getContext("2d")
  if (!context) {
    return null
  }

  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight)
  return canvas.toDataURL("image/png").split(",")[1] ?? null
}
