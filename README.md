# ThreadAtlas

ThreadAtlas monorepo for a semantic browser copilot.

## Workspace layout

- `apps/api`: current-page session runtime API
- `apps/extension`: Chrome Extension sidepanel copilot
- `packages/shared`: Shared contracts/types/utils

## Prerequisites

- Node.js 20+
- pnpm 10+

## Install

```bash
pnpm install
```

## Build

```bash
pnpm -w build
```

## Test

```bash
pnpm -w test
```

## Build extension

```bash
pnpm extension:build
```

Load unpacked extension from `apps/extension/dist`.

## Use In Chrome

1. Build the extension:

```bash
pnpm extension:build
```

2. Open `chrome://extensions`
3. Enable `Developer mode`
4. Click `Load unpacked`
5. Select [apps/extension/dist](/Users/eggp/dev/workspace/eggp/thread-atlas/apps/extension/dist)
6. Open a Hacker News item page like `https://news.ycombinator.com/item?id=...`
7. Click the ThreadAtlas toolbar button to open the sidepanel
8. In the sidepanel DevTools console, configure one of the following:

Internal preview via hidden `dev-bootstrap` override:

```js
await chrome.storage.local.set({
  THREADATLAS_API_BASE_URL: "http://localhost:8080",
  THREADATLAS_AUTH_GRANT_TYPE: "dev-bootstrap",
  THREADATLAS_BOOTSTRAP_SUBJECT: "local-dev-user-1",
  THREADATLAS_AUTH_BOOTSTRAP_KEY: "threadatlas-dev-bootstrap-2026-7Xq9Lr2Vm!K8pS4",
  THREADATLAS_AUTH_DISPLAY_NAME: "Local Dev",
  THREADATLAS_AUTH_PRIMARY_EMAIL: "local-dev@example.com"
})
location.reload()
```

Real Google sign-in without rebuilding:

```js
await chrome.storage.local.set({
  THREADATLAS_API_BASE_URL: "http://localhost:8080",
  THREADATLAS_GOOGLE_OAUTH_CLIENT_ID: "<your-google-oauth-client-id>"
})
location.reload()
```

9. If you configured Google sign-in, use `Continue with Google` in the sidepanel.
10. Use `Capture Snapshot`, the context menu item, or the shortcut `Alt+Shift+C`
11. Ask a text question in the `Conversation` section or use `Mic`
12. Toggle semantic selection with `Alt+Shift+S` when you want to bind the snapshot to a specific node

## Runtime Notes

- Semantic snapshot capture works without the local API server.
- Text-first current-page conversation expects the local API server.
- The canonical runtime path is `POST /api/token` plus `GET /ws/session`.
- Chrome native STT runs in the page context; Chrome native TTS runs in the sidepanel.
- Voice/live is optional and not required for the internal MVP.

---

## Backend: Run On Local

This section walks you through running the ThreadAtlas backend on your local machine using Docker. No local PostgreSQL installation is required.

### Prerequisites

- **Docker Desktop** (or Docker Engine with Compose plugin)
- **Node.js 20+** and **pnpm** — needed to install dependencies before the Docker build
- **Google Cloud CLI** (`gcloud`) — needed for Vertex AI authentication

### 1. Clone the Repository

```bash
git clone https://github.com/<your-fork>/thread-atlas.git
cd thread-atlas
```

### 2. Install Dependencies

```bash
pnpm install
```

This ensures the lockfile is synced and all packages (including `@google/genai`) are available for the Docker build.

### 3. Set Up Environment Variables

Before starting the services, configure the required environment variables:

```bash
export GOOGLE_CLOUD_PROJECT=<your-gcp-project-id>
export GOOGLE_CLOUD_LOCATION=<your-gcp-region>
export GOOGLE_APPLICATION_CREDENTIALS_HOST="$HOME/.config/gcloud/application_default_credentials.json"
export POSTGRES_USER=<your-db-user> # default: testuser
export POSTGRES_PASSWORD=<your-db-password> # default: testpassword
```

If you haven't generated ADC credentials yet, run:

```bash
gcloud auth application-default login
```

This will create the credentials file at the path specified by `GOOGLE_APPLICATION_CREDENTIALS_HOST`.

### 4. Start the Services

Run the following command from the repository root:

```bash
docker compose -f docker-compose.yml -f docker-compose.gcp-local.yml up --build api
```

This single command will:

1. Pull the `pgvector/pgvector:pg17` image and start a PostgreSQL database container (`threadatlas-db`)
2. Build the API from the `Dockerfile` and start the API container (`threadatlas-api`)
3. Mount your local ADC credentials into the API container for Vertex AI access
4. Wait for the database to be healthy before starting the API

The API will be available at **http://localhost:8080**.

### 5. Run Database Migrations

The API server automatically runs all SQL migration files on startup. In most cases, the tables will be created without any manual steps.

However, if the automatic migration does not run (e.g., the migration directory is not resolved correctly inside the container), you can manually apply the schema by following these steps:

#### 5.1 Connect to the Database Container

```bash
docker exec -it threadatlas-db psql -U testuser -d thread-atlas
```

#### 5.2 Run Migration Files in Order

Once inside the `psql` shell, run each migration file in sequence. You can copy-paste the contents of each file, or use the following approach from your host terminal:

```bash
# Run all migration files in order
for f in apps/api/src/db/migrations/001_auth_core.sql \
         apps/api/src/db/migrations/002_memory_owner_fk.sql \
         apps/api/src/db/migrations/003_auth_identity_provider_bootstrap.sql \
         apps/api/src/db/migrations/003_rag_core.sql; do
  echo "Running $f ..."
  docker exec -i threadatlas-db psql -U testuser -d thread-atlas < "$f"
done
```

#### 5.3 Verify Tables Were Created

```bash
docker exec -it threadatlas-db psql -U testuser -d thread-atlas -c '\dt'
```

You should see tables including: `users`, `user_identities`, `auth_sessions`, `memory_records`, `memory_record_embeddings`, and `analysis_runs`.

### 6. Verify the API

Once the services are running, verify the API is healthy:

```bash
# Health check
curl http://localhost:8080/health
# Expected: {"ok":true}

# Readiness check (confirms DB connectivity)
curl http://localhost:8080/ready
# Expected: {"ok":true,"checks":{"db":"up"}}
```

You can also confirm both containers are running:

```bash
docker compose ps
```

- `threadatlas-db` should show **healthy**
- `threadatlas-api` should show **running**

### 7. Get an Authentication Token

ThreadAtlas provides a `dev-bootstrap` authentication path for local testing. Use it to get a session token:

```bash
curl -X POST http://localhost:8080/api/token \
  -H 'Content-Type: application/json' \
  -H 'X-Bootstrap-Key: <your-bootstrap-key>' \
  -d '{
    "grantType": "dev-bootstrap",
    "bootstrapSubject": "local-dev-user-1",
    "profile": {
      "displayName": "Local Dev",
      "primaryEmail": "local-dev@example.com"
    }
  }'
```

A successful response will return a session token that you can use for authenticated API calls and WebSocket connections.

### 8. Shut Down

To stop all services:

```bash
docker compose down
```

To stop and also remove the database volume (clean slate):

```bash
docker compose down -v
```

---

## Backend: Run On Cloud

### 1. Create Cloud SQL Instance

1. Go to Cloud SQL in the Google Cloud Console and create a new PostgreSQL instance as follows:
   - Instance ID: Choose a unique ID for your instance, for example `thread-atlas`
   - Password: Set a strong password for the `postgres` user (you will need this later)
   - Region: Choose the region closest to you, for example `us-central1`
2. Install the pgvector extension on your Cloud SQL instance:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. Create the schema by running all SQL files in `apps/api/src/db/migrations` in order:
   ```bash
   # From your local machine, connect to Cloud SQL and run each migration
   for f in apps/api/src/db/migrations/001_auth_core.sql \
            apps/api/src/db/migrations/002_memory_owner_fk.sql \
            apps/api/src/db/migrations/003_auth_identity_provider_bootstrap.sql \
            apps/api/src/db/migrations/003_rag_core.sql; do
     echo "Running $f ..."
     psql -h <cloud-sql-ip> -U postgres -d thread-atlas < "$f"
   done
   ```

### 2. Create Cloud Run Service

Go to Cloud Run in the Google Cloud Console and create a new service as follows:

1. Go to Cloud Run Overview Menu
2. Choose "Connect Repository"
3. Choose "Continuously deploy from a repository"
4. Choose Cloud Build
5. Select your forked ThreadAtlas repository.
6. Choose "Dockerfile" as the build configuration and specify the path to the Dockerfile in our repository, which is `/Dockerfile`.
7. Write the service name your own way, for example `threadatlas-api`.
8. Choose the region closest to you, for example `us-central1`.
9. For authentication, choose "Allow public access".
10. Scaling: Set the minimum number of instances to 1 to avoid cold start latency.
11. Container: Set the port to 8080, which is the default port our API listens on.
    - Set the environment variables as follows:
      - `GOOGLE_CLOUD_PROJECT`: your Google Cloud project ID
      - `GOOGLE_CLOUD_LOCATION`: the region you chose (e.g., `us-central1`)
      - `DB_CONNECTION_MODE`: `cloudsql-connector`
      - `CLOUD_SQL_INSTANCE_CONNECTION_NAME`: your Cloud SQL instance connection name
      - `DB_NAME`: your Cloud SQL database name (e.g., `thread-atlas`)
      - `DB_USER`: your Cloud SQL database user
      - `DB_IAM_AUTHN`: `true` (if you are using IAM authentication for Cloud SQL)
      - `NODE_ENV`: `production`
      - `GOOGLE_OAUTH_CLIENT_ID`: your Google OAuth client ID (if you want to enable Google sign-in)
      - `AUTH_BOOTSTRAP_KEY`: a secure random string for the dev-bootstrap authentication path (optional, for internal testing without OAuth)

### 3. Verify Deployment

1. After the deployment is complete, go to the Cloud Run service you just created.
2. Click on the service to view its details.
3. Get the URL of your service.
4. Use curl or Postman to send a GET request to the `/health` endpoint of your service to verify that it is running correctly:
   ```bash
   curl https://your-service-url/health
   ```
5. You should receive a response indicating that the service is healthy:
   ```json
   {"ok":true}
   ```

---

## Source of truth

- `docs/internals/PRD.md`
- `docs/internals/BE-SPEC.md`
- `docs/internals/FE-SPEC.md`
- `docs/internals/SCENARIO.md`
