import { describe, expect, it } from "vitest"
import { resolveSemanticCropArea } from "../src/sidepanel-user/image-crop"

describe("semantic image crop", () => {
  it("prefers the root rect and clamps it to the viewport", () => {
    const crop = resolveSemanticCropArea({
      focusRect: {
        top: 120,
        left: 140,
        right: 240,
        bottom: 220,
        width: 100,
        height: 100
      },
      rootRect: {
        top: -20,
        left: -10,
        right: 260,
        bottom: 180,
        width: 270,
        height: 200
      },
      viewportRect: {
        top: 0,
        left: 0,
        right: 320,
        bottom: 240,
        width: 320,
        height: 240
      },
      devicePixelRatio: 2
    })

    expect(crop).toEqual({
      left: 0,
      top: 0,
      width: 284,
      height: 204
    })
  })

  it("falls back to the focus rect when the root rect is missing", () => {
    const crop = resolveSemanticCropArea({
      focusRect: {
        top: 48,
        left: 56,
        right: 136,
        bottom: 112,
        width: 80,
        height: 64
      },
      rootRect: null,
      viewportRect: {
        top: 0,
        left: 0,
        right: 240,
        bottom: 180,
        width: 240,
        height: 180
      },
      devicePixelRatio: 1
    })

    expect(crop).toEqual({
      left: 32,
      top: 24,
      width: 128,
      height: 112
    })
  })

  it("returns null when the crop target is fully off-screen or zero-sized", () => {
    expect(
      resolveSemanticCropArea({
        focusRect: {
          top: 400,
          left: 420,
          right: 420,
          bottom: 420,
          width: 0,
          height: 20
        },
        rootRect: null,
        viewportRect: {
          top: 0,
          left: 0,
          right: 320,
          bottom: 240,
          width: 320,
          height: 240
        },
        devicePixelRatio: 2
      })
    ).toBeNull()

    expect(
      resolveSemanticCropArea({
        focusRect: {
          top: 500,
          left: 520,
          right: 620,
          bottom: 620,
          width: 100,
          height: 100
        },
        rootRect: null,
        viewportRect: {
          top: 0,
          left: 0,
          right: 320,
          bottom: 240,
          width: 320,
          height: 240
        },
        devicePixelRatio: 2
      })
    ).toBeNull()
  })
})
