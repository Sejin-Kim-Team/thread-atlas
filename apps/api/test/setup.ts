// 테스트 공통 기본값: enrich trigger mode 미설정으로 서버 부팅이 실패하지 않게 한다.
if (!process.env.ENRICH_TRIGGER_MODE) {
  process.env.ENRICH_TRIGGER_MODE = "hybrid-complex"
}
