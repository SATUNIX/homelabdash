# Changelog

## v1.0.0 — 2026-03-18

Initial public release.

### Features

- **Service directory** — searchable and filterable catalog of self-hosted services with category grouping
- **Live health probes** — background probe cycle checks every service URL and tracks HTTP status, response time, and state history
- **Dashboard overview** — at-a-glance metrics (total, healthy, degraded, down services), topology summary, quick-launch pinned services, and recent incidents
- **Network topology** — live Docker container and network graph built from the Docker socket
- **Service detail** — per-service operational profile with links, tags, notes, probe history, and related services
- **Admin panel** — full CRUD for services, categories, and user role management; manual probe trigger
- **User pinning** — per-user pinned services persisted to the database and tied to the auth gateway identity
- **Dark/light theme** — system-level theming via IBM Carbon, persisted to local storage
- **Auth gateway integration** — designed to sit behind a forward-auth proxy (Authelia, oauth2-proxy, etc.) with identity passed via `X-Auth-*` headers
- **YAML catalog seed** — services and categories bootstrapped from a `catalog.yml` on first run
- **Homepage import** — optional import of descriptions and icons from gethomepage YAML files

### Stack

- React 18 + IBM Carbon Design System v11 + Vite 6
- Python / Flask + SQLite + Gunicorn
- Nginx (static bundle + API reverse proxy)
- Docker Compose
