# BE Dev Environment Setup Guide for FE

이 문서는 FE 개발자와 로컬 검증자가 **로컬 DB 설치 없이** ThreadAtlas BE를 띄울 수 있도록 Docker 기반 실행 방법을 설명한다.

## 1. 개요

리포지토리 루트의 [docker-compose.yml](../docker-compose.yml)은 FE 개발자가 **로컬 DB 설치 없이** 바로 BE를 붙여볼 수 있도록 준비된 개발용 구성이다.

- `db`: pgvector가 포함된 PostgreSQL
- `api`: ThreadAtlas Express API

기본 권장 흐름은 아래 하나다.

- **DB와 API를 모두 Docker Compose로 실행**

## 2. 사전 준비

필수:

- Docker Desktop 또는 Docker Engine

선택:

- Google OAuth / Vertex AI 기능까지 함께 검증하려면 아래 환경변수 준비
- canonical GCP region은 `us-central1` 기준이다

```bash
export GOOGLE_CLOUD_PROJECT=threadatlas
export GOOGLE_CLOUD_LOCATION=us-central1
export GOOGLE_OAUTH_CLIENT_ID=<your-google-oauth-client-id>
export AUTH_BOOTSTRAP_KEY=threadatlas-dev-bootstrap-2026-7Xq9Lr2Vm!K8pS4
```

참고:

- `AUTH_BOOTSTRAP_KEY`는 local/test 전용 `dev-bootstrap` 경로에 사용한다.
- `GOOGLE_OAUTH_CLIENT_ID`가 없으면 `google-id-token` 경로는 동작하지 않는다.
- `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`이 없으면 generation / embedding 경로 일부가 제한된다.

## 3. DB와 API를 모두 Docker로 실행

FE 개발자가 Node/DB를 로컬에 설치하지 않고 빠르게 붙어볼 수 있는 경로다.

### 3.1 실행

```bash
docker compose up --build api
```

이 명령은 자동으로 `db`도 같이 띄운다.
기본 구성에서 DB는 외부 포트에 노출하지 않는다. FE 개발자는 `http://localhost:8080`의 API만 사용하면 된다.

### 3.2 확인

```bash
curl http://localhost:8080/health
curl http://localhost:8080/ready
```

기대 응답:

```json
{"ok":true}
```

```json
{"ok":true,"checks":{"db":"up"}}
```

### 3.3 서비스 상태 확인

```bash
docker compose ps
```

정상 상태면:

- `threadatlas-db`는 `healthy`
- `threadatlas-api`는 `running`

## 4. dev-bootstrap 토큰 발급 예시

가장 빠른 인증 검증 경로다.

```bash
curl -X POST http://localhost:8080/api/token \
  -H 'Content-Type: application/json' \
  -H 'X-Bootstrap-Key: threadatlas-dev-bootstrap-2026-7Xq9Lr2Vm!K8pS4' \
  -d '{
    "grantType": "dev-bootstrap",
    "bootstrapSubject": "local-dev-user-1",
    "profile": {
      "displayName": "Local Dev",
      "primaryEmail": "local-dev@example.com"
    }
  }'
```

## 5. 수동 기능 검증 체크

최소 체크 포인트:

- `GET /health`가 200인지
- `GET /ready`가 200이고 `db=up`인지
- `POST /api/token` dev-bootstrap이 200인지
- 발급받은 앱 토큰으로 `/api/analyze`가 동작하는지
- WebSocket `/ws/session` 연결이 되는지

보다 자세한 E2E 시나리오는 로컬 전용 문서인 `local-only-docs/active/e2e`를 참고한다.

## 6. Bruno API Collection 사용

FE 개발자는 Bruno를 이용해 로컬 BE API를 바로 호출할 수 있다.

사전 준비:

- Bruno 설치
- 참고 가이드: <https://docs.usebruno.com/get-started/installation>

사용 순서:

1. Bruno를 실행한다.
2. `Open Collection` 또는 폴더 열기 기능으로 리포지토리의 [docs/internals/api_collections](./internals/api_collections) 폴더를 연다.
3. 환경으로 [docs/internals/api_collections/environments/ThreadAtlasLocal.yml](./internals/api_collections/environments/ThreadAtlasLocal.yml)을 선택한다.
4. 필요하면 `serverUrl`, `authBootstrapKey` 값을 현재 로컬 환경에 맞게 수정한다.
5. `create-token-dev`, `health`, `ready`, `service/*` 요청을 순서대로 실행해 로컬 BE를 검증한다.

참고:

- Bruno 설치/컬렉션 사용법: <https://docs.usebruno.com/testing/script/getting-started>
- `docs/internals/api_collections/opencollection.yml`은 Bruno에서 컬렉션 루트로 사용된다.
- `service/folder.yml`에는 `dev-bootstrap` 토큰 발급용 pre-request 스크립트가 연결돼 있다.

## 7. 종료

```bash
docker compose down
```

DB 볼륨까지 지우려면:

```bash
docker compose down -v
```

## 8. 주의사항

- 이 compose는 **로컬 개발 편의용**이다.
- canonical cloud 배포 region은 `us-central1`이다.
- Cloud Run 배포 시에는 Cloud SQL Connector 기반 경로를 사용한다.
- Cloud Run, Vertex AI, Cloud SQL은 가능하면 모두 `us-central1`에 맞춰 운영한다.
- Compose의 API 서비스는 `DATABASE_URL` direct connection 모드로 동작한다.
- Vertex AI / Google OAuth를 실제로 검증하려면 호스트 환경의 인증과 client id 설정이 필요하다.
- 로컬 Node로 API를 직접 띄우는 경로가 필요하다면 별도 오버라이드 compose 또는 `apps/api/.env` 기반 실행을 사용한다.
