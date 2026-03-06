import { build, context } from "esbuild"
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"

const root = process.cwd()
const distDir = join(root, "dist")
const watchMode = process.argv.includes("--watch")

const entries = [
  { entryPoints: ["src/sidepanel/index.ts"], outfile: "dist/sidepanel.js" },
  { entryPoints: ["src/popup/index.ts"], outfile: "dist/popup.js" },
  { entryPoints: ["src/background/service-worker.ts"], outfile: "dist/service-worker.js" },
  { entryPoints: ["src/content/content-semantic.ts"], outfile: "dist/content-semantic.js" },
  { entryPoints: ["src/content/content-hn.ts"], outfile: "dist/content-hn.js" },
  { entryPoints: ["src/content/content-article.ts"], outfile: "dist/content-article.js" }
]

function copyStatic() {
  mkdirSync(distDir, { recursive: true })
  cpSync(join(root, "manifest.json"), join(root, "dist/manifest.json"))
  cpSync(join(root, "sidepanel.html"), join(root, "dist/sidepanel.html"))
  cpSync(join(root, "popup.html"), join(root, "dist/popup.html"))

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
