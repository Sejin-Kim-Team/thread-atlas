import { Router, type RequestHandler } from "express"
import { resolvePrincipalFromAuthorizationHeader } from "../auth/principal"
import { insertAnalysisRun } from "../rag/analysis-runs-repository"
import { buildCanonicalContextPack } from "../session/context-pack/build"
import { normalizeForAnalyze } from "../session/context-pack/normalize"
import type {
  AnalyzeMode,
  AnalyzeRequestBody,
  AnalyzeResponseBody,
  SemanticSnapshot
} from "../session/context-pack/types"
import { validateSemanticSnapshot } from "../session/context-pack/validate"

const router: ReturnType<typeof Router> = Router()
const POSTGRES_INT32_MIN = -2147483648
const POSTGRES_INT32_MAX = 2147483647

function normalizeMode(mode: AnalyzeRequestBody["mode"]): AnalyzeMode {
  if (mode === "memory-candidate" || mode === "visual-summary") {
    return mode
  }
  return "seed"
}

function isValidTabId(tabId: unknown): tabId is number {
  return (
    typeof tabId === "number" &&
    Number.isInteger(tabId) &&
    tabId >= POSTGRES_INT32_MIN &&
    tabId <= POSTGRES_INT32_MAX
  )
}

const handleAnalyze: RequestHandler = async (req, res) => {
  // 보안 경계: 분석 요청은 인증된 주체만 처리한다.
  const principal = await resolvePrincipalFromAuthorizationHeader(req.header("authorization"))
  if (!principal.ok) {
    res.status(401).json({
      code: "UNAUTHORIZED",
      message: principal.message
    })
    return
  }

  const body = req.body as AnalyzeRequestBody
  if (!isValidTabId(body.tabId)) {
    res.status(400).json({
      code: "INVALID_EVENT",
      message: "tabId is required"
    })
    return
  }

  const validation = validateSemanticSnapshot(body.snapshot)
  if (!validation.ok || !body.snapshot) {
    res.status(400).json({
      code: "INVALID_SNAPSHOT",
      message: validation.errors[0] ?? "snapshot is required"
    })
    return
  }

  try {
    // 스냅샷을 표준 문맥으로 재구성한 뒤 요청 유형별 응답 계약으로 축약한다.
    const mode = normalizeMode(body.mode)
    const snapshot = body.snapshot as SemanticSnapshot
    const canonicalPack = buildCanonicalContextPack(snapshot)
    const normalized = normalizeForAnalyze(snapshot, canonicalPack, mode)
    // analyze 결과는 해커톤 규약에 따라 analysis_runs에 최소 감사 로그를 남긴다.
    const analysisRun = await insertAnalysisRun({
      ownerUserId: principal.userId,
      tabId: body.tabId,
      mode,
      snapshotPageId: snapshot.page.id,
      snapshotUrl: snapshot.page.url,
      normalizedMode: normalized.normalizedMode,
      summaryCandidates: normalized.summaryCandidates,
      visualSummaries: normalized.visualSummaries
    })

    const base = {
      mode,
      analysisId: analysisRun.id,
      normalizedMode: normalized.normalizedMode
    }

    let response: AnalyzeResponseBody
    if (mode === "visual-summary") {
      response = {
        ...base,
        mode: "visual-summary",
        visualSummaries: normalized.visualSummaries
      }
    } else if (mode === "memory-candidate") {
      response = {
        ...base,
        mode: "memory-candidate",
        summaryCandidates: normalized.summaryCandidates
      }
    } else {
      response = {
        ...base,
        mode: "seed",
        summaryCandidates: normalized.summaryCandidates
      }
    }

    res.status(200).json(response)
  } catch (error) {
    res.status(500).json({
      code: "ANALYZE_FAILED",
      message: "analyze failed"
    })
  }
}

router.post("/", handleAnalyze)

export default router
