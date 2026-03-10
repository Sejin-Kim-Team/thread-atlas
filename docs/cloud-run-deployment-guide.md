# Cloud Run Deployment Guide

이 문서는 ThreadAtlas API를 Google Cloud Run에 배포하는 절차를 정리한다.

현재 리포지토리 기준 canonical region은 `us-central1`이다.

## 1. 배포 전략

현재 [cloudbuild.yaml](../cloudbuild.yaml)은 **이미지 빌드 + 이미지 배포만 담당하는 콘솔 관리형 배포 파일**이다.

- Cloud Run의 `Cloud SQL 연결`
- `DB_CONNECTION_MODE`, `CLOUD_SQL_INSTANCE_CONNECTION_NAME`, `DB_NAME`, `DB_USER`
- `DB_PASSWORD`, `AUTH_BOOTSTRAP_KEY`, `GOOGLE_OAUTH_CLIENT_ID`
- 서비스 계정

같은 런타임 설정은 Cloud Run 콘솔에서 직접 관리해야 한다.
`cloudbuild.yaml`은 위 설정을 생성하거나 덮어쓰지 않는다.

핵심 원칙:

- `Cloud Run`, `Vertex AI`, `Artifact Registry`, `Cloud SQL`은 가능하면 모두 `us-central1`에 맞춘다
- Cloud Run 런타임의 DB 연결 모드는 `cloudsql-connector`를 사용한다
- 민감한 값은 Secret Manager로 주입한다

## 2. 사전 준비

필수 도구:

- `gcloud` CLI
- Docker

프로젝트 선택:

```bash
gcloud config set project <PROJECT_ID>
```

필수 API 활성화:

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  sqladmin.googleapis.com \
  aiplatform.googleapis.com \
  secretmanager.googleapis.com
```

## 3. Artifact Registry 준비

이미지가 올라갈 Docker 저장소를 `us-central1`에 생성한다.

```bash
gcloud artifacts repositories create threadatlas \
  --repository-format=docker \
  --location=us-central1
```

로컬 Docker 인증:

```bash
gcloud auth configure-docker us-central1-docker.pkg.dev
```

## 4. Cloud SQL 준비

ThreadAtlas API는 Cloud Run 배포 시 Cloud SQL Connector 경로를 사용한다.

필수 런타임 값:

- `DB_CONNECTION_MODE=cloudsql-connector`
- `CLOUD_SQL_INSTANCE_CONNECTION_NAME`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD` 또는 `DB_IAM_AUTHN=true`

권장 예시:

- 인스턴스 이름: `thread-atlas`
- 데이터베이스 이름: `thread-atlas`
- 앱 유저: `threadatlas_app`

예시 인스턴스 생성:

```bash
gcloud sql instances create thread-atlas \
  --database-version=POSTGRES_16 \
  --region=us-central1 \
  --tier=db-custom-1-3840
```

예시 DB 생성:

```bash
gcloud sql databases create thread-atlas \
  --instance=thread-atlas
```

예시 유저 생성:

```bash
gcloud sql users create threadatlas_app \
  --instance=thread-atlas \
  --password='<DB_PASSWORD>'
```

주의:

- RAG 마이그레이션 [003_rag_core.sql](../apps/api/src/db/migrations/003_rag_core.sql)에 `create extension if not exists vector;`가 포함되어 있다.
- Cloud SQL 인스턴스에서 `pgvector` 사용이 가능해야 하며, 첫 배포 전에 관리자 권한으로 extension 생성 가능 여부를 확인하는 편이 안전하다.

## 5. Cloud Run 서비스 계정 준비

Cloud Run 런타임은 Vertex AI 호출과 Cloud SQL 연결 권한이 필요하다.

서비스 계정 생성:

```bash
gcloud iam service-accounts create threadatlas-api
```

필수 권한 부여:

```bash
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:threadatlas-api@<PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:threadatlas-api@<PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:threadatlas-api@<PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## 6. Secret Manager 준비

권장 secret:

- `threadatlas-db-password`
- `threadatlas-auth-bootstrap-key`
- `threadatlas-google-oauth-client-id`

예시:

```bash
printf '%s' '<DB_PASSWORD>' | gcloud secrets create threadatlas-db-password --data-file=-
printf '%s' '<AUTH_BOOTSTRAP_KEY>' | gcloud secrets create threadatlas-auth-bootstrap-key --data-file=-
printf '%s' '<GOOGLE_OAUTH_CLIENT_ID>' | gcloud secrets create threadatlas-google-oauth-client-id --data-file=-
```

이미 secret이 있으면 새 버전을 추가한다.

```bash
printf '%s' '<DB_PASSWORD>' | gcloud secrets versions add threadatlas-db-password --data-file=-
```

## 7. 필수 런타임 설정

### 7.1 필수 env

| 이름 | 값 예시 | 설명 |
| --- | --- | --- |
| `NODE_ENV` | `production` | 프로덕션 런타임 |
| `GOOGLE_CLOUD_PROJECT` | `<PROJECT_ID>` | Vertex/Google API 대상 프로젝트 |
| `GOOGLE_CLOUD_LOCATION` | `us-central1` | Vertex AI canonical region |
| `DB_CONNECTION_MODE` | `cloudsql-connector` | Cloud Run DB 연결 모드 |
| `CLOUD_SQL_INSTANCE_CONNECTION_NAME` | `<PROJECT_ID>:us-central1:thread-atlas` | Cloud SQL 인스턴스 연결 이름 |
| `DB_NAME` | `thread-atlas` | PostgreSQL 데이터베이스 이름 |
| `DB_USER` | `threadatlas_app` | PostgreSQL 앱 유저 |

### 7.2 optional env

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `GOOGLE_GENERATION_MODEL` | `gemini-2.5-flash` | generation 모델 오버라이드 |
| `ENRICH_TRIGGER_MODE` | `hybrid-complex` | enrichment trigger 정책 |
| `WS_ALLOWED_ORIGINS` | 미설정 | WebSocket origin allowlist |
| `LOG_LEVEL` | 앱 기본값 사용 | 로그 레벨 |
| `AUTH_SESSION_TTL_SECONDS` | 앱 기본값 사용 | auth session TTL |

### 7.3 secret 주입 권장 값

| 이름 | 설명 |
| --- | --- |
| `DB_PASSWORD` | Cloud SQL 비밀번호 기반 인증 시 필수 |
| `AUTH_BOOTSTRAP_KEY` | `dev-bootstrap` 토큰 발급을 허용할 때 사용 |
| `GOOGLE_OAUTH_CLIENT_ID` | `google-id-token` 인증 경로를 사용할 때 필요 |

## 8. 이미지 빌드 및 푸시

이 리포지토리는 API 이미지를 루트 [Dockerfile](../Dockerfile)로 빌드하므로, **빌드 컨텍스트는 리포지토리 루트 `.`** 로 유지해야 한다.

```bash
PROJECT_ID=<PROJECT_ID>
IMAGE=us-central1-docker.pkg.dev/$PROJECT_ID/threadatlas/threadatlas-api:$(git rev-parse --short HEAD)

docker build -f Dockerfile -t "$IMAGE" .
docker push "$IMAGE"
```

## 9. Cloud Build 자동 배포

기본 [cloudbuild.yaml](../cloudbuild.yaml)은 아래만 담당한다.

- 서비스: `threadatlas-api`
- region: `us-central1`
- Artifact Registry에 이미지 push
- 새 이미지를 Cloud Run 서비스에 deploy

예시:

```bash
gcloud builds submit \
  --config=cloudbuild.yaml \
  --substitutions=_REGION=us-central1,_REPOSITORY=threadatlas,_IMAGE_NAME=threadatlas-api,_SERVICE_NAME=threadatlas-api
```

주의:

- `cloudbuild.yaml`은 Cloud Run 콘솔의 env, secrets, Cloud SQL 연결, 서비스 계정을 건드리지 않는다.
- 따라서 운영 설정 변경은 Cloud Run 콘솔 또는 별도 `gcloud run services update` 절차에서 관리해야 한다.
- 첫 배포 전에 콘솔에서 이 문서의 필수 런타임 값을 먼저 넣어둬야 한다.

## 9.1 수동 `gcloud run deploy` 예시

비밀번호 기반 Cloud SQL 인증 기준 예시:

```bash
PROJECT_ID=<PROJECT_ID>
IMAGE=us-central1-docker.pkg.dev/$PROJECT_ID/threadatlas/threadatlas-api:$(git rev-parse --short HEAD)

gcloud run deploy threadatlas-api \
  --image="$IMAGE" \
  --region=us-central1 \
  --platform=managed \
  --allow-unauthenticated \
  --service-account="threadatlas-api@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-cloudsql-instances="${PROJECT_ID}:us-central1:thread-atlas" \
  --remove-env-vars="DATABASE_URL,FIRESTORE_DATABASE,GEMINI_API_KEY" \
  --update-env-vars="NODE_ENV=production,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=us-central1,DB_CONNECTION_MODE=cloudsql-connector,CLOUD_SQL_INSTANCE_CONNECTION_NAME=${PROJECT_ID}:us-central1:thread-atlas,DB_NAME=thread-atlas,DB_USER=threadatlas_app,ENRICH_TRIGGER_MODE=hybrid-complex" \
  --update-secrets="DB_PASSWORD=threadatlas-db-password:latest,AUTH_BOOTSTRAP_KEY=threadatlas-auth-bootstrap-key:latest,GOOGLE_OAUTH_CLIENT_ID=threadatlas-google-oauth-client-id:latest"
```

## 10. 배포 확인

서비스 URL 조회:

```bash
gcloud run services describe threadatlas-api \
  --region=us-central1 \
  --format='value(status.url)'
```

헬스 체크:

```bash
SERVICE_URL=$(gcloud run services describe threadatlas-api --region=us-central1 --format='value(status.url)')

curl "$SERVICE_URL/health"
curl "$SERVICE_URL/ready"
```

기대 결과:

- `/health` 가 `200`
- `/ready` 가 `200`
- `/ready` 응답에 `checks.db = up`

## 11. 운영 시 주의사항

### 11.1 `cloudbuild.yaml` 주의

현재 [cloudbuild.yaml](../cloudbuild.yaml)은 아래 성격으로 이해해야 한다.

- `us-central1` region/registry 기준은 반영되어 있다
- Cloud Build는 이미지를 빌드하고 같은 이름의 Cloud Run 서비스에 새 이미지를 배포한다
- 런타임 env, secret, Cloud SQL attachment, 서비스 계정은 Cloud Run 콘솔에 남겨둔다

즉 아래는 사전에 Cloud Run 콘솔 또는 별도 운영 절차로 준비되어 있어야 한다.

1. `Cloud SQL` 인스턴스/DB/유저
2. `threadatlas-api` 서비스 계정과 IAM 권한
3. Secret Manager의 `threadatlas-db-password`, `threadatlas-auth-bootstrap-key`, `threadatlas-google-oauth-client-id`
4. Cloud Run 서비스의 env/secrets/Cloud SQL 연결

### 11.2 WebSocket 운영

Cloud Run은 WebSocket을 지원하지만, 세션 유지 특성상 아래를 고려한다.

- 콜드스타트 영향을 줄이려면 `min-instances` 검토
- long-lived connection이 많아지면 instance/concurrency 정책 점검
- `WS_ALLOWED_ORIGINS`를 사용할 경우 extension/runtime origin 특성을 함께 고려

## 12. 참고 파일

- [cloudbuild.yaml](../cloudbuild.yaml)
- [Dockerfile](../Dockerfile)
- [config.ts](../apps/api/src/db/config.ts)
- [gemini.ts](../apps/api/src/services/gemini.ts)
- [BE-SPEC-INFRA.md](./internals/be/BE-SPEC-INFRA.md)
