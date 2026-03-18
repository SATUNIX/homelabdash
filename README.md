# Index Dashboard

A self-hosted operations dashboard for home lab environments. Tracks services, aggregates live health status, and provides a central launch point for your internal stack.

Built with [IBM Carbon Design System](https://carbondesignsystem.com/) (React), a Python/Flask API, and Docker Compose.

---

## Features

- **Service directory** — searchable catalog with category filtering, tag support, and auth mode labelling
- **Live health probes** — background probe cycle with HTTP status, response time, and history per service
- **Dashboard overview** — key metrics, topology summary, pinned quick-launch, and recent incidents
- **Network topology** — live Docker container/network graph via the Docker socket
- **Service detail** — links, tags, notes, probe history, and related services
- **Admin panel** — full service/category CRUD, user role management, manual probe trigger
- **Per-user pinning** — pinned services follow the authenticated user
- **Dark / light theme** — Carbon theming, persisted to local storage
- **Auth gateway integration** — designed to sit behind a forward-auth proxy; no built-in login page

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Nginx  (port 18493)                                 │
│  ├─ Serves React static bundle                       │
│  └─ Proxies /api/* → Flask backend                   │
├──────────────────────────────────────────────────────┤
│  Flask API  (internal port 4000)                     │
│  ├─ Service catalog  (YAML-seeded → SQLite)          │
│  ├─ Live probes  (background thread, 60 s interval)  │
│  ├─ User management  (auth header identity)          │
│  └─ Docker topology  (socket read, 20 s cache)       │
├──────────────────────────────────────────────────────┤
│  Auth gateway  (optional — Authelia, oauth2-proxy…)  │
│  └─ Injects X-Auth-User / X-Auth-Email / X-Auth-Name│
└──────────────────────────────────────────────────────┘
```

---

## Quick start

### Prerequisites

- Docker and Docker Compose v2

### Steps

```bash
# 1. Clone
git clone https://github.com/your-username/index-page.git
cd index-page

# 2. Create your service catalog
cp catalog.example.yml catalog.yml
# Edit catalog.yml — add your services and categories

# 3. Configure the API
cp api/.env.example api/.env
# Edit api/.env — set INDEX_PUBLIC_BASE_URL at minimum

# 4. (Optional) configure the frontend
cp web/.env.example web/.env
# Set VITE_AUTH_GATEWAY_URL if you have an auth gateway

# 5. Build and start
docker compose up -d --build
```

Open `http://localhost:18493`.

---

## Configuration

| File | Purpose |
|---|---|
| `catalog.yml` | Services and categories to seed on first run |
| `api/.env` | API server environment variables |
| `web/.env` | Frontend build-time environment variables |

Full reference: [docs/configuration.md](docs/configuration.md)

---

## Documentation

| Document | Description |
|---|---|
| [docs/deployment.md](docs/deployment.md) | Full deployment guide, reverse proxy setup, ports, backups |
| [docs/configuration.md](docs/configuration.md) | All environment variables with defaults |
| [docs/catalog-schema.md](docs/catalog-schema.md) | YAML catalog format reference |
| [docs/auth-integration.md](docs/auth-integration.md) | Auth gateway integration (Authelia, oauth2-proxy, nginx) |

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, IBM Carbon Design System v11, React Router v7, Vite 6, Sass |
| Backend | Python 3.12, Flask 3.1, Gunicorn 23, SQLite 3, PyYAML |
| Infrastructure | Nginx, Docker, Docker Compose |

---

## Development

### Backend

```bash
cd api
python -m venv .venv
source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
APP_ENV=development python app.py
```

The API runs on `http://localhost:4000`. Set env vars or export them before starting.

### Frontend

```bash
cd web
npm install
# Create web/.env from web/.env.example if needed
npm run build    # production build → dist/
```

For live development with a running API, add a Vite dev server proxy in `vite.config.js`:

```js
server: {
  proxy: {
    '/api': 'http://localhost:4000'
  }
}
```

---

## License

[MIT](LICENSE)
