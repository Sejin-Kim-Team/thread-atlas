import path from "node:path"
import dotenv from "dotenv"

// apps/api 실행은 루트/패키지 경로 어디서 시작해도 동일한 .env를 읽어야 한다.
dotenv.config({
  path: path.resolve(__dirname, "..", ".env")
})

const { createServer } = require("./server") as typeof import("./server")

const port = Number(process.env.PORT ?? 8080)
const app = createServer()

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`threadatlas-api listening on :${port}`)
})
