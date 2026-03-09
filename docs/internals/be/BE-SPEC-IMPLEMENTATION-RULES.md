# ThreadAtlas Backend Spec

## Implementation Rules

Version: 0.1-hackathon
Status: Draft
Companion:
- [BE-SPEC.md](./BE-SPEC.md)
- [BE-SPEC-HACKATHON.md](./BE-SPEC-HACKATHON.md)

---

## 1. Purpose

본 문서는 BE 구현 시 반드시 지켜야 하는 코드 구조 규칙을 고정한다.

이 문서가 고정하는 핵심:

- raw SQL 사용 경계
- Express framework-thin 레이어 경계
- 한글 주석 작성 원칙
- 구조화 로깅 원칙

---

## 2. Raw SQL Rule

### 2.1 Allowed

- raw SQL은 허용한다.
- 단, SQL은 반드시 repository 계층 내부에만 존재해야 한다.

### 2.2 Forbidden

아래 계층에서 SQL 직접 작성은 금지한다.

- route
- service / usecase
- orchestrator / runtime

### 2.3 Complex Query Rule

- 복잡 쿼리는 repository 내부 `queries.ts` 또는 SQL 상수로 분리한다.
- repository 함수는 SQL 의도를 함수명으로 드러내야 한다.
- SQL 문자열 중복 복사는 금지하고, 재사용 가능한 상수로 통합한다.

---

## 3. Express Framework-Thin Rule

해커톤 기간에는 Express를 유지한다.

단, 아래 레이어 경계를 강제한다.

- route:
  - 요청 파싱
  - 인증/인가
  - 입력 검증
  - 상태코드/응답 직렬화
- service / usecase / orchestrator:
  - 흐름 제어
  - 상태 전이
  - 정책 분기
- repository:
  - DB read/write
  - transaction
  - 쿼리 구성

route는 비즈니스 규칙과 DB 접근을 가지면 안 된다.

---

## 4. Korean Comment Rule

### 4.1 Mandatory

신규/수정 코드에서 아래 항목은 한글 주석을 사용해야 한다.

- 비자명한 상태 전이
- 보안 경계(인증/소유권/권한)
- 복잡 쿼리 의도
- fallback 또는 degrade 분기

### 4.2 Style

- 주석은 짧고 명확하게 작성한다.
- 영어 주석은 금지한다.
- 코드 동작을 그대로 반복하는 무의미한 줄단위 주석은 금지한다.

---

## 5. Acceptance Criteria

- route/service/orchestrator/runtime 경로에 SQL 문자열이 없어야 한다.
- repository 경로 밖에서 `query(` 호출이 없어야 한다.
- route는 DB pool 또는 client를 직접 참조하지 않아야 한다.
- 비자명한 구현 경계에 한국어 주석이 있어야 한다.

---

## 6. Structured Logging Rule

### 6.1 Mandatory

- backend는 공통 structured logger를 사용해야 한다.
- 로그는 JSON line 형식으로 출력해야 한다.
- 아래 경계에는 최소한의 구조화 로그가 있어야 한다.
  - boot / shutdown
  - auth token issue / verify
  - analyze / ingest-memory
  - websocket handshake / connection / invalid envelope
  - turn start / enrich / recall / completion
  - generation / embedding / retrieval

### 6.2 Sensitive Data Rule

- 아래 값은 로그에 남기면 안 된다.
  - bearer token
  - google `id_token`
  - bootstrap key
  - 원문 prompt 전문
- 필요 시 길이, 개수, 식별자, 상태코드 같은 메타 정보만 남긴다.

### 6.3 Correlation Rule

- 가능하면 아래 식별자를 로그 필드에 포함한다.
  - `userId`
  - `sessionId`
  - `turnId`
  - `requestId`
- 단, 값이 없는 경로에서는 억지로 생성하지 않는다.
