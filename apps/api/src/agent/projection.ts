import { respond } from "@threadatlas/shared"

export function createStubResponseProjection(text: string) {
  return respond(text, "answer")
}
