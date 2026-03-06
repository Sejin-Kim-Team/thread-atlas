import type {
  FocusResult,
  PageExtractor,
  ResolveFocusInput
} from "@threadatlas/shared/browser-runtime"

export class FocusResolver {
  resolve(
    extractor: PageExtractor,
    document: Document,
    input: ResolveFocusInput
  ): FocusResult | null {
    return extractor.resolveFocus(document, input)
  }
}
