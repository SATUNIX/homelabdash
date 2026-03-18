# Configuration Reference

## API environment variables

Copy `api/.env.example` to `api/.env` and adjust the values.

| Variable | Default | Description |
|---|---|---|
| `APP_ENV` | `production` | Set to `development` to enable Flask debug mode. |
| `PORT` | `4000` | Internal port Gunicorn binds to. Not exposed outside Docker. |
| `INDEX_DATABASE` | `/data/index-dashboard.db` | Absolute path to the SQLite database file inside the container. |
| `INDEX_SEED_CATALOG_PATH` | `/seed/catalog.yml` | Path to the YAML catalog file mounted into the container. |
| `INDEX_SEED_HOMEPAGE_SERVICES_PATH` | `/seed/homepage-services.yml` | Optional. Path to a homepage-compatible services YAML for import. |
| `INDEX_SEED_HOMEPAGE_BOOKMARKS_PATH` | `/seed/homepage-bookmarks.yml` | Optional. Path to a homepage-compatible bookmarks YAML for import. |
| `INDEX_PROBE_TIMEOUT_SECONDS` | `4` | Seconds before a health probe is considered timed out. |
| `INDEX_PROBE_INTERVAL_SECONDS` | `60` | Seconds between background probe cycles. |
| `INDEX_HISTORY_RETENTION_HOURS` | `48` | How long probe history records are kept. |
| `INDEX_MAX_HISTORY_POINTS` | `48` | Maximum number of history records retained per service. |
| `INDEX_BOOTSTRAP_ADMIN_USERNAME` | `admin` | Username of the admin user created on first run. |
| `INDEX_BOOTSTRAP_ADMIN_EMAIL` | `admin@example.com` | Email of the bootstrap admin user. |
| `INDEX_PUBLIC_BASE_URL` | `http://localhost:18493` | Public-facing URL of the dashboard, used in redirect links. |
| `INDEX_AUTH_GATEWAY_URL` | _(empty)_ | Base URL of the auth gateway (e.g. `https://auth.example.com`). Used to build the logout redirect. Leave empty to disable logout. |
| `INDEX_DOCKER_SOCKET_PATH` | `/var/run/docker.sock` | Path to the Docker socket used for topology discovery. |
| `INDEX_TOPOLOGY_CACHE_TTL_SECONDS` | `20` | Seconds the topology snapshot is cached before re-querying Docker. |

## Frontend environment variables

Copy `web/.env.example` to `web/.env` and set values **before building the image**.
Vite bakes these into the static bundle at build time — they are not runtime configuration.

| Variable | Default | Description |
|---|---|---|
| `VITE_AUTH_GATEWAY_URL` | _(empty)_ | Base URL of the auth gateway. When set, a "Gateway" shortcut link is shown in the header and side navigation. |

> **Note:** Frontend environment variables must be set before running `docker compose up --build`.
> Changing them requires a rebuild of the `web` image.

## Authentication headers

The API reads identity from the following request headers injected by your auth gateway:

| Header | Description |
|---|---|
| `X-Auth-User` | Unique username or identifier |
| `X-Auth-Email` | User email address |
| `X-Auth-Name` | Display name shown in the UI |

If none of these headers are present, the API returns a 401 for protected endpoints.
See [auth-integration.md](auth-integration.md) for gateway configuration examples.
