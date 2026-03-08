import path from "node:path"
import dotenv from "dotenv"

// 테스트는 로컬 실행과 같은 .env 경로를 우선 로드한다.
dotenv.config({
  path: path.resolve(__dirname, "..", ".env")
})

// 테스트 공통 기본값: enrich trigger mode 미설정으로 서버 부팅이 실패하지 않게 한다.
if (!process.env.ENRICH_TRIGGER_MODE) {
  process.env.ENRICH_TRIGGER_MODE = "hybrid-complex"
}
