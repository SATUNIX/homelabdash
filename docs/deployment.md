# Deployment

## Prerequisites

- Docker and Docker Compose v2
- A `catalog.yml` describing your services (see [catalog-schema.md](catalog-schema.md))

## Quick start

```bash
# 1. Clone the repository
git clone https://github.com/your-username/index-page.git
cd index-page

# 2. Create your service catalog
cp catalog.example.yml catalog.yml
# Edit catalog.yml to list your services

# 3. Create the API environment file
cp api/.env.example api/.env
# Edit api/.env — at minimum set INDEX_PUBLIC_BASE_URL

# 4. Build and start
docker compose up -d --build
```

The dashboard is now reachable at `http://localhost:18493`.

## Configuration

See [configuration.md](configuration.md) for the full list of environment variables.

## Placing the dashboard behind a reverse proxy

The dashboard expects to run behind a reverse proxy that:
1. Terminates TLS
2. Optionally injects authentication headers (`X-Auth-User`, `X-Auth-Email`, `X-Auth-Name`)

### Without an auth gateway

If you are not using an auth gateway, the dashboard works without authentication.
The API treats every request as unauthenticated and will create an "anonymous" session.
Admin features are accessible to anyone who can reach the dashboard, so restrict access
at the network or reverse proxy layer if needed.

### With an auth gateway (Authelia, oauth2-proxy, Authentik, etc.)

Configure your gateway to forward the following headers on every proxied request:

| Header | Description |
|---|---|
| `X-Auth-User` | Username / unique identifier |
| `X-Auth-Email` | User's email address |
| `X-Auth-Name` | Display name |

The API creates a local user record on first login and grants admin privileges to
the bootstrap user defined by `INDEX_BOOTSTRAP_ADMIN_USERNAME`.

See [auth-integration.md](auth-integration.md) for gateway-specific configuration examples.

## Port mapping

By default the Nginx container binds to `127.0.0.1:18493`. Change the `ports` entry
in `compose.yml` to suit your environment:

```yaml
ports:
  - "127.0.0.1:18493:18493"   # loopback only (recommended behind reverse proxy)
  # - "0.0.0.0:18493:18493"   # all interfaces
  # - "18493:18493"            # shorthand for all interfaces
```

## Topology discovery

The topology page reads live data from the Docker daemon via the Unix socket. The
`catalog.yml` mount and the socket mount are both configured in `compose.yml`:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

Remove this volume to disable topology discovery. The topology page will show an
empty graph instead of an error.

## Persistent data

All database data is stored in a named Docker volume (`index_data`). To back up:

```bash
docker run --rm \
  -v index_page_index_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/index-data-backup.tar.gz /data
```

## Updating

```bash
git pull
docker compose up -d --build
```

The database schema is initialised on start-up and is forward-compatible — no
migration steps are required between patch versions.

## Homepage integration (optional)

The API can optionally import service metadata from
[gethomepage/homepage](https://gethomepage.dev) YAML files to pre-populate
descriptions and icons. Mount the files and set the corresponding environment
variables in `api/.env`:

```yaml
# compose.yml
volumes:
  - /path/to/homepage/services.yaml:/seed/homepage-services.yml:ro
  - /path/to/homepage/bookmarks.yaml:/seed/homepage-bookmarks.yml:ro
```

```env
# api/.env
INDEX_SEED_HOMEPAGE_SERVICES_PATH=/seed/homepage-services.yml
INDEX_SEED_HOMEPAGE_BOOKMARKS_PATH=/seed/homepage-bookmarks.yml
```

This import only runs on first start when the database is empty.
