# Catalog Schema

The service catalog is a YAML file seeded into the database on first run.
A working example is provided in `catalog.example.yml`.

After first run all catalog data is stored in the SQLite database and can be
managed through the Admin panel. Re-seeding only happens when the database is
empty (i.e. on a fresh install or after deleting the data volume).

## Top-level structure

```yaml
categories:
  - ...   # list of Category objects

services:
  - ...   # list of Service objects
```

## Category

```yaml
categories:
  - id: infrastructure          # required — unique slug (lowercase, hyphens)
    name: Infrastructure        # required — display name
    description: Core services. # optional — shown in the UI
```

| Field | Required | Description |
|---|---|---|
| `id` | yes | Unique slug. Lowercase letters, numbers, and hyphens only. |
| `name` | yes | Human-readable display name. |
| `description` | no | Short description shown in the UI. |

Categories are displayed in the order they appear in the YAML.

## Service

```yaml
services:
  - id: portainer               # optional — inferred from name if absent
    name: Portainer             # required
    categoryId: infrastructure  # required — must match a category id
    authMode: protected         # optional — "protected" (default) or "direct"
    externalUrl: https://portainer.example.com   # required
    internalUrl: http://portainer:9000           # optional
    probeUrl: http://portainer:9000/api/system/status  # optional
    tags: [docker, containers]  # optional — list of strings
    description: Container management UI.  # optional
```

| Field | Required | Description |
|---|---|---|
| `id` | no | Unique slug. Inferred from `name` if absent (lowercased, spaces → hyphens). |
| `name` | yes | Display name shown in the directory and detail page. |
| `categoryId` | yes | Must match the `id` of a category defined above. |
| `authMode` | no | `protected` (default) — sits behind the auth gateway. `direct` — publicly accessible. |
| `externalUrl` | yes | The public URL used for the "Open service" button. |
| `internalUrl` | no | Internal network endpoint. Shown in the operational profile. |
| `probeUrl` | no | URL the backend probes for health checks. Defaults to `externalUrl` if absent. |
| `tags` | no | List of string tags. Used for filtering in the directory. |
| `description` | no | Short description. Can also be imported from homepage YAML. |

Services are displayed in the order they appear in the YAML.

## Notes

- The catalog is read-only after the database is populated. Use the Admin panel to add or edit services.
- To force a re-seed, delete the data volume and restart: `docker compose down -v && docker compose up -d`.
- IDs are normalised on import: spaces become hyphens, special characters are stripped.
