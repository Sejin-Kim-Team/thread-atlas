import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "https://news.ycombinator.com/item?id=1"
      }
    },
    include: ["test/**/*.test.ts"]
  }
})
