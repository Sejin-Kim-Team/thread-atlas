import { build, context } from "esbuild"
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"

const root = process.cwd()
const distDir = join(root, "dist")
const watchMode = process.argv.includes("--watch")
const compiledApiBaseUrl = process.env.THREADATLAS_API_BASE_URL ?? "http://localhost:8080"
const compiledGoogleOAuthClientId =
  process.env.THREADATLAS_GOOGLE_OAUTH_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID ?? ""

const entries = [
  { entryPoints: ["src/sidepanel/index.ts"], outfile: "dist/sidepanel.js" },
  { entryPoints: ["src/popup/index.ts"], outfile: "dist/popup.js" },
  { entryPoints: ["src/background/service-worker.ts"], outfile: "dist/service-worker.js" },
  { entryPoints: ["src/content/content-semantic.ts"], outfile: "dist/content-semantic.js" },
  { entryPoints: ["src/content/content-hn.ts"], outfile: "dist/content-hn.js" },
  { entryPoints: ["src/content/content-article.ts"], outfile: "dist/content-article.js" },
  { entryPoints: ["src/content/page-speech-bridge.ts"], outfile: "dist/page-speech-bridge.js" }
]

function copyStatic() {
  mkdirSync(distDir, { recursive: true })
  cpSync(join(root, "manifest.json"), join(root, "dist/manifest.json"))
  cpSync(join(root, "sidepanel.html"), join(root, "dist/sidepanel.html"))
  cpSync(join(root, "popup.html"), join(root, "dist/popup.html"))
  cpSync(join(root, "src/sidepanel/audio-input-worklet.js"), join(root, "dist/audio-input-worklet.js"))

  const stylesSrc = join(root, "src/styles")
  const stylesDest = join(root, "dist/styles")
  if (existsSync(stylesSrc)) {
    mkdirSync(stylesDest, { recursive: true })
    cpSync(stylesSrc, stylesDest, { recursive: true })
  }

  const iconsSrc = join(root, "icons")
  const iconsDest = join(root, "dist/icons")
  if (existsSync(iconsSrc)) {
    mkdirSync(dirname(iconsDest), { recursive: true })
    cpSync(iconsSrc, iconsDest, { recursive: true })
  }
}

function commonConfig(target) {
  return {
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome120",
    sourcemap: true,
    logLevel: "info",
    define: {
      __THREADATLAS_API_BASE_URL__: JSON.stringify(compiledApiBaseUrl),
      __THREADATLAS_GOOGLE_OAUTH_CLIENT_ID__: JSON.stringify(compiledGoogleOAuthClientId)
    },
    ...target
  }
}

async function run() {
  rmSync(distDir, { recursive: true, force: true })
  copyStatic()

  if (!watchMode) {
    await Promise.all(entries.map((entry) => build(commonConfig(entry))))
    return
  }

  const contexts = await Promise.all(entries.map((entry) => context(commonConfig(entry))))
  await Promise.all(contexts.map((ctx) => ctx.watch()))
  // eslint-disable-next-line no-console
  console.log("Extension watch mode enabled")
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error)
  process.exit(1)
})
