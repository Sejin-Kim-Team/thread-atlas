import { defineWorkspace } from "vitest/config"

export default defineWorkspace([
  "packages/shared/vitest.config.mts",
  "apps/api/vitest.config.mts",
  "apps/extension/vitest.config.mts"
])
