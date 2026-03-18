import json
import http.client
import os
import re
import socket
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

import yaml
from flask import Flask, abort, g, jsonify, request


APP_ENV = os.environ.get("APP_ENV", "production")
PORT = int(os.environ.get("PORT", "4000"))
DATABASE_PATH = Path(os.environ.get("INDEX_DATABASE", "/data/index-dashboard.db"))
SEED_CATALOG_PATH = Path(os.environ.get("INDEX_SEED_CATALOG_PATH", "/seed/catalog.yml"))
SEED_HOMEPAGE_SERVICES_PATH = Path(
    os.environ.get("INDEX_SEED_HOMEPAGE_SERVICES_PATH", "/seed/homepage-services.yml")
)
SEED_HOMEPAGE_BOOKMARKS_PATH = Path(
    os.environ.get("INDEX_SEED_HOMEPAGE_BOOKMARKS_PATH", "/seed/homepage-bookmarks.yml")
)
PROBE_TIMEOUT_SECONDS = float(os.environ.get("INDEX_PROBE_TIMEOUT_SECONDS", "4"))
PROBE_INTERVAL_SECONDS = int(os.environ.get("INDEX_PROBE_INTERVAL_SECONDS", "60"))
HISTORY_RETENTION_HOURS = int(os.environ.get("INDEX_HISTORY_RETENTION_HOURS", "48"))
MAX_HISTORY_POINTS = int(os.environ.get("INDEX_MAX_HISTORY_POINTS", "48"))
BOOTSTRAP_ADMIN_USERNAME = os.environ.get("INDEX_BOOTSTRAP_ADMIN_USERNAME", "admin")
BOOTSTRAP_ADMIN_EMAIL = os.environ.get("INDEX_BOOTSTRAP_ADMIN_EMAIL", "admin@example.com")
PUBLIC_BASE_URL = os.environ.get("INDEX_PUBLIC_BASE_URL", "http://localhost:18493").rstrip("/")
AUTH_GATEWAY_URL = os.environ.get("INDEX_AUTH_GATEWAY_URL", "").rstrip("/")
DOCKER_SOCKET_PATH = Path(os.environ.get("INDEX_DOCKER_SOCKET_PATH", "/var/run/docker.sock"))
TOPOLOGY_CACHE_TTL_SECONDS = int(os.environ.get("INDEX_TOPOLOGY_CACHE_TTL_SECONDS", "20"))

app = Flask(__name__)
_probe_lock = threading.Lock()
_probe_thread = None
_topology_lock = threading.Lock()
_topology_cache = {"expires_at": 0.0, "payload": None}


def utc_now():
    return datetime.now(timezone.utc)


def to_iso(value):
    return value.astimezone(timezone.utc).isoformat()


def json_response(payload, status=200):
    return jsonify(payload), status


def fail(message, status):
    response = jsonify({"error": message})
    response.status_code = status
    abort(response)


def slugify(value):
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "service"


def normalize_service_id(raw_id, name):
    candidate = (raw_id or "").strip().lower()
    if candidate:
        return slugify(candidate)
    return slugify(name)


def normalize_auth_mode(value):
    return "protected" if value == "protected" else "direct"


def parse_bool(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


def db_connect():
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA busy_timeout=5000")
    return connection


@contextmanager
def db_cursor():
    connection = db_connect()
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def get_db():
    if "db" not in g:
        g.db = db_connect()
    return g.db


@app.teardown_appcontext
def close_db(_error):
    connection = g.pop("db", None)
    if connection is not None:
        connection.close()


@app.errorhandler(sqlite3.IntegrityError)
def handle_sqlite_error(error):
    return json_response({"error": f"Database integrity error: {error}"}, 400)


def current_identity(required=True):
    username = request.headers.get("X-Auth-User", "").strip()
    email = request.headers.get("X-Auth-Email", "").strip()
    display_name = request.headers.get("X-Auth-Name", "").strip() or username
    if not username or not email:
        if required:
            fail("Authentication headers missing", 401)
        return None
    user = get_db().execute(
        """
        SELECT id, username, email, display_name, is_admin
        FROM users
        WHERE username = ? OR email = ?
        """,
        (username, email),
    ).fetchone()
    now = to_iso(utc_now())
    should_be_admin = int(
        username == BOOTSTRAP_ADMIN_USERNAME or email == BOOTSTRAP_ADMIN_EMAIL
    )
    if user is None:
        get_db().execute(
            """
            INSERT INTO users (username, email, display_name, is_admin, created_at, updated_at, last_seen_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (username, email, display_name, should_be_admin, now, now, now),
        )
    else:
        get_db().execute(
            """
            UPDATE users
            SET email = ?, display_name = ?, last_seen_at = ?, updated_at = ?,
                is_admin = CASE
                    WHEN username = ? OR email = ? THEN 1
                    ELSE is_admin
                END
            WHERE id = ?
            """,
            (
                email,
                display_name,
                now,
                now,
                BOOTSTRAP_ADMIN_USERNAME,
                BOOTSTRAP_ADMIN_EMAIL,
                user["id"],
            ),
        )
    get_db().commit()
    user = get_db().execute(
        """
        SELECT id, username, email, display_name, is_admin
        FROM users
        WHERE username = ? OR email = ?
        """,
        (username, email),
    ).fetchone()
    return dict(user)


def require_admin():
    viewer = current_identity(required=True)
    if not viewer["is_admin"]:
        fail("Admin access required", 403)
    return viewer


def load_yaml(path):
    if not path.exists():
        return None
    return yaml.safe_load(path.read_text(encoding="utf-8"))


class UnixSocketHTTPConnection(http.client.HTTPConnection):
    def __init__(self, socket_path, timeout=5):
        super().__init__("localhost", timeout=timeout)
        self.socket_path = socket_path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.socket_path)


def docker_api_json(path):
    if not DOCKER_SOCKET_PATH.exists():
        raise RuntimeError(f"Docker socket not found at {DOCKER_SOCKET_PATH}")
    connection = UnixSocketHTTPConnection(str(DOCKER_SOCKET_PATH), timeout=5)
    try:
        connection.request("GET", path)
        response = connection.getresponse()
        payload = response.read()
        if response.status >= 400:
            raise RuntimeError(f"Docker API request failed for {path}: HTTP {response.status}")
        return json.loads(payload or b"null")
    except OSError as error:
        raise RuntimeError(f"Docker API unavailable: {error}") from error
    finally:
        connection.close()


def parse_url_hostname(raw_url):
    if not raw_url:
        return ""
    try:
        return (urlparse(raw_url).hostname or "").strip().lower()
    except ValueError:
        return ""


def unique_values(values):
    seen = set()
    ordered = []
    for value in values:
        candidate = str(value or "").strip().lower()
        if not candidate or candidate in seen:
            continue
        ordered.append(candidate)
        seen.add(candidate)
    return ordered


def runtime_candidate_names(service):
    names = []
    for field in ("internalUrl", "probeUrl"):
        host = parse_url_hostname(service.get(field))
        if host:
            names.append(host)
    names.extend(
        [
            service.get("id"),
            service.get("slug"),
            slugify(service.get("name", "")),
        ]
    )
    return unique_values(names)


def build_container_indexes(containers):
    indexes = {
        "by_name": {},
        "by_compose_service": {},
        "by_project_service": {},
        "by_project": {},
    }
    for container in containers:
        labels = container.get("Labels") or {}
        compose_service = (labels.get("com.docker.compose.service") or "").strip().lower()
        compose_project = (labels.get("com.docker.compose.project") or "").strip().lower()
        for name in container.get("Names") or []:
            cleaned = name.strip("/").lower()
            if cleaned:
                indexes["by_name"].setdefault(cleaned, []).append(container)
        if compose_service:
            indexes["by_compose_service"].setdefault(compose_service, []).append(container)
        if compose_project and compose_service:
            indexes["by_project_service"].setdefault(
                f"{compose_project}:{compose_service}", []
            ).append(container)
        if compose_project:
            indexes["by_project"].setdefault(compose_project, []).append(container)
    return indexes


def container_rank(container):
    state = (container.get("State") or "").strip().lower()
    status_text = (container.get("Status") or "").strip().lower()
    return (
        0 if state == "running" else 1,
        0 if "healthy" in status_text else 1,
        0 if "unhealthy" not in status_text else 1,
        container.get("Created", 0) * -1,
    )


def choose_best_container(candidates):
    if not candidates:
        return None
    return sorted(candidates, key=container_rank)[0]


def match_service_to_container(service, indexes):
    candidates = runtime_candidate_names(service)
    service_id = (service.get("id") or "").strip().lower()
    for candidate in candidates:
        exact_match = choose_best_container(indexes["by_name"].get(candidate, []))
        if exact_match is not None:
            return exact_match
        compose_match = choose_best_container(indexes["by_compose_service"].get(candidate, []))
        if compose_match is not None:
            return compose_match
        project_service_match = choose_best_container(
            indexes["by_project_service"].get(f"{service_id}:{candidate}", [])
        )
        if project_service_match is not None:
            return project_service_match
        project_match = choose_best_container(indexes["by_project"].get(candidate, []))
        if project_match is not None:
            return project_match
    return None


def extract_health_state(status_text):
    lowered = (status_text or "").lower()
    if "unhealthy" in lowered:
        return "unhealthy"
    if "healthy" in lowered:
        return "healthy"
    if "starting" in lowered:
        return "starting"
    return "none"


def derive_runtime_tone(container_state, health_state):
    if container_state in {"missing", "exited", "dead"}:
        return "critical"
    if container_state in {"created", "restarting", "paused"}:
        return "warning"
    if health_state == "unhealthy":
        return "warning"
    if container_state == "running":
        return "positive"
    return "neutral"


def parse_container_ports(container_detail):
    ports = []
    port_map = (
        container_detail.get("NetworkSettings", {}).get("Ports")
        if isinstance(container_detail.get("NetworkSettings"), dict)
        else {}
    ) or {}
    for container_port, bindings in port_map.items():
        port_number, protocol = (container_port.split("/", 1) + ["tcp"])[:2]
        private_port = int(port_number)
        if bindings:
            for binding in bindings:
                host_port = binding.get("HostPort")
                host_ip = binding.get("HostIp") or "0.0.0.0"
                port_label = f"{host_ip}:{host_port}->{private_port}/{protocol}"
                ports.append(
                    {
                        "containerPort": private_port,
                        "publishedPort": int(host_port) if str(host_port).isdigit() else host_port,
                        "hostIp": host_ip,
                        "protocol": protocol,
                        "published": True,
                        "label": port_label,
                    }
                )
        else:
            ports.append(
                {
                    "containerPort": private_port,
                    "publishedPort": None,
                    "hostIp": "",
                    "protocol": protocol,
                    "published": False,
                    "label": f"{private_port}/{protocol}",
                }
            )
    return sorted(
        ports,
        key=lambda item: (
            0 if item["published"] else 1,
            item["publishedPort"] if isinstance(item["publishedPort"], int) else 0,
            item["containerPort"],
            item["protocol"],
        ),
    )


def build_network_payload(network_name, service_count):
    if network_name == "host":
        return {
            "id": "network:host",
            "kind": "network",
            "label": "host",
            "name": "host",
            "driver": "host",
            "scope": "local",
            "internal": False,
            "isPrivate": False,
            "role": "host",
            "serviceCount": service_count,
        }
    try:
        detail = docker_api_json(f"/networks/{quote(network_name, safe='')}")
    except RuntimeError:
        detail = {}
    driver = detail.get("Driver", "bridge")
    internal = bool(detail.get("Internal", False))
    is_private = internal or (network_name not in {"edge", "bridge"} and driver != "host")
    role = "host" if driver == "host" else "private" if is_private else "shared"
    return {
        "id": f"network:{network_name}",
        "kind": "network",
        "label": network_name,
        "name": network_name,
        "driver": driver,
        "scope": detail.get("Scope", "local"),
        "internal": internal,
        "isPrivate": is_private,
        "role": role,
        "serviceCount": service_count,
    }


def empty_topology_payload(message=None, services=None):
    services = services or []
    return {
        "available": False,
        "generatedAt": to_iso(utc_now()),
        "warning": message or "Docker topology is unavailable.",
        "summary": {
            "catalogServices": len(services),
            "mappedServices": 0,
            "runningServices": 0,
            "healthyRuntimeServices": 0,
            "exposedServices": 0,
            "networkCount": 0,
            "privateNetworks": 0,
        },
        "nodes": [],
        "edges": [],
    }


def build_topology_payload():
    services = list_services(include_archived=False)
    containers = docker_api_json("/containers/json?all=1")
    indexes = build_container_indexes(containers)
    inspected = {}
    network_usage = {}
    nodes = []
    edges = []
    summary = {
        "catalogServices": len(services),
        "mappedServices": 0,
        "runningServices": 0,
        "healthyRuntimeServices": 0,
        "exposedServices": 0,
        "networkCount": 0,
        "privateNetworks": 0,
    }

    for service in services:
        container = match_service_to_container(service, indexes)
        labels = {}
        container_state = "missing"
        health_state = "none"
        runtime_status = "No matching container"
        container_name = ""
        ports = []
        networks = []
        matched = container is not None

        if matched:
            summary["mappedServices"] += 1
            container_id = container["Id"]
            if container_id not in inspected:
                inspected[container_id] = docker_api_json(
                    f"/containers/{quote(container_id, safe='')}/json"
                )
            detail = inspected[container_id]
            labels = detail.get("Config", {}).get("Labels") or {}
            container_state = (container.get("State") or "unknown").lower()
            runtime_status = container.get("Status") or container_state
            health_state = extract_health_state(runtime_status)
            container_name = (detail.get("Name") or "").strip("/")
            ports = parse_container_ports(detail)
            networks = sorted(
                (detail.get("NetworkSettings", {}).get("Networks") or {}).keys()
            )
            network_mode = (
                detail.get("HostConfig", {}).get("NetworkMode") or ""
            ).strip().lower()
            if network_mode == "host" and "host" not in networks:
                networks.append("host")
            if container_state == "running":
                summary["runningServices"] += 1
            if derive_runtime_tone(container_state, health_state) == "positive":
                summary["healthyRuntimeServices"] += 1
            if any(port["published"] for port in ports):
                summary["exposedServices"] += 1
            for network_name in networks:
                network_usage[network_name] = network_usage.get(network_name, 0) + 1

        tone = derive_runtime_tone(container_state, health_state)
        node_id = f"service:{service['id']}"
        nodes.append(
            {
                "id": node_id,
                "kind": "service",
                "label": service["name"],
                "serviceId": service["id"],
                "categoryName": service["category"]["name"],
                "authMode": service["authMode"],
                "probeState": service["status"]["state"],
                "runtimeState": container_state,
                "runtimeStatusText": runtime_status,
                "runtimeTone": tone,
                "healthState": health_state,
                "matched": matched,
                "containerName": container_name,
                "composeProject": labels.get("com.docker.compose.project", ""),
                "composeService": labels.get("com.docker.compose.service", ""),
                "ports": ports,
                "isExposed": any(port["published"] for port in ports),
                "networks": networks,
                "externalUrl": service["externalUrl"],
                "internalUrl": service["internalUrl"],
            }
        )
        for network_name in networks:
            edges.append(
                {
                    "id": f"{node_id}:network:{network_name}",
                    "source": node_id,
                    "target": f"network:{network_name}",
                    "kind": "network",
                }
            )

    network_nodes = [
        build_network_payload(network_name, service_count)
        for network_name, service_count in sorted(network_usage.items())
    ]
    summary["networkCount"] = len(network_nodes)
    summary["privateNetworks"] = len([node for node in network_nodes if node["isPrivate"]])

    return {
        "available": True,
        "generatedAt": to_iso(utc_now()),
        "warning": None,
        "summary": summary,
        "nodes": nodes + network_nodes,
        "edges": edges,
    }


def get_topology_payload():
    now = time.time()
    with _topology_lock:
        cached_payload = _topology_cache.get("payload")
        if cached_payload is not None and _topology_cache.get("expires_at", 0) > now:
            return cached_payload
    services = list_services(include_archived=False)
    try:
        payload = build_topology_payload()
    except Exception as error:
        with _topology_lock:
            stale_payload = _topology_cache.get("payload")
        if stale_payload is not None:
            stale_copy = dict(stale_payload)
            stale_copy["warning"] = f"Showing cached topology. Live Docker read failed: {error}"
            stale_copy["available"] = True
            return stale_copy
        return empty_topology_payload(f"Live Docker topology is unavailable: {error}", services)
    with _topology_lock:
        _topology_cache["payload"] = payload
        _topology_cache["expires_at"] = now + TOPOLOGY_CACHE_TTL_SECONDS
    return payload


def parse_homepage_services():
    raw = load_yaml(SEED_HOMEPAGE_SERVICES_PATH) or []
    by_url = {}
    by_name = {}
    for group in raw:
        if not isinstance(group, dict):
            continue
        for _group_name, entries in group.items():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                for name, details in entry.items():
                    if not isinstance(details, dict):
                        continue
                    href = details.get("href")
                    record = {
                        "name": name,
                        "description": details.get("description", ""),
                        "icon": details.get("icon", ""),
                        "href": href,
                    }
                    by_name[name.lower()] = record
                    if href:
                        by_url[href] = record
    return by_name, by_url


def parse_homepage_bookmarks():
    raw = load_yaml(SEED_HOMEPAGE_BOOKMARKS_PATH) or []
    featured_urls = set()
    featured_names = set()
    for group in raw:
        if not isinstance(group, dict):
            continue
        for _group_name, entries in group.items():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                for name, details in entry.items():
                    featured_names.add(name.lower())
                    if isinstance(details, dict) and details.get("href"):
                        featured_urls.add(details["href"])
    return featured_names, featured_urls


def initialize_schema():
    with db_cursor() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                is_admin INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS categories (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS services (
                id TEXT PRIMARY KEY,
                slug TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                category_id TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                auth_mode TEXT NOT NULL,
                external_url TEXT NOT NULL,
                internal_url TEXT NOT NULL DEFAULT '',
                probe_url TEXT NOT NULL DEFAULT '',
                icon TEXT NOT NULL DEFAULT '',
                runbook_url TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                featured INTEGER NOT NULL DEFAULT 0,
                archived INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                source TEXT NOT NULL DEFAULT 'manual',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE RESTRICT
            );

            CREATE TABLE IF NOT EXISTS service_tags (
                service_id TEXT NOT NULL,
                tag TEXT NOT NULL,
                PRIMARY KEY(service_id, tag),
                FOREIGN KEY(service_id) REFERENCES services(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS service_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_id TEXT NOT NULL,
                label TEXT NOT NULL,
                url TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'external',
                is_primary INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(service_id) REFERENCES services(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS service_status (
                service_id TEXT PRIMARY KEY,
                state TEXT NOT NULL,
                status_code INTEGER,
                response_time_ms INTEGER,
                checked_at TEXT NOT NULL,
                note TEXT,
                FOREIGN KEY(service_id) REFERENCES services(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS service_checks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_id TEXT NOT NULL,
                state TEXT NOT NULL,
                status_code INTEGER,
                response_time_ms INTEGER,
                checked_at TEXT NOT NULL,
                note TEXT,
                FOREIGN KEY(service_id) REFERENCES services(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS user_pins (
                user_id INTEGER NOT NULL,
                service_id TEXT NOT NULL,
                PRIMARY KEY(user_id, service_id),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(service_id) REFERENCES services(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS dashboard_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )


def seed_database_if_empty():
    connection = db_connect()
    try:
        service_count = connection.execute(
            "SELECT COUNT(*) AS count FROM services"
        ).fetchone()["count"]
        if service_count:
            return
        catalog = load_yaml(SEED_CATALOG_PATH) or {}
        homepage_by_name, homepage_by_url = parse_homepage_services()
        featured_names, featured_urls = parse_homepage_bookmarks()
        now = to_iso(utc_now())
        categories = catalog.get("categories") or []
        services = catalog.get("services") or []
        for index, category in enumerate(categories):
            category_id = category["id"]
            connection.execute(
                """
                INSERT INTO categories (id, name, description, sort_order, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    category_id,
                    category.get("name", category_id),
                    category.get("description", ""),
                    index,
                    now,
                    now,
                ),
            )
        for index, service in enumerate(services):
            service_id = normalize_service_id(service.get("id"), service.get("name", "Service"))
            external_url = service.get("externalUrl", "").strip()
            homepage_record = homepage_by_url.get(external_url) or homepage_by_name.get(
                service.get("name", "").lower()
            )
            description = homepage_record["description"] if homepage_record and homepage_record["description"] else service.get("description", "")
            icon = homepage_record["icon"] if homepage_record else ""
            featured = (
                external_url in featured_urls
                or service.get("name", "").lower() in featured_names
                or service_id in {"auth-gateway", "gitlab", "portainer", "minio-console", "openwebui", "index-test"}
            )
            archived = service_id == "homepage"
            connection.execute(
                """
                INSERT INTO services (
                    id, slug, name, category_id, description, auth_mode, external_url,
                    internal_url, probe_url, icon, runbook_url, notes, featured, archived,
                    sort_order, source, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, 'seed', ?, ?)
                """,
                (
                    service_id,
                    service_id,
                    service.get("name", service_id),
                    service.get("categoryId"),
                    description,
                    normalize_auth_mode(service.get("authMode")),
                    external_url,
                    service.get("internalUrl", ""),
                    service.get("probeUrl", ""),
                    icon,
                    int(featured),
                    int(archived),
                    index,
                    now,
                    now,
                ),
            )
            tags = service.get("tags") or []
            for tag in tags:
                connection.execute(
                    "INSERT INTO service_tags (service_id, tag) VALUES (?, ?)",
                    (service_id, str(tag)),
                )
            links = [
                ("Open service", external_url, "external", 1, 0),
            ]
            internal_url = service.get("internalUrl", "")
            if internal_url:
                links.append(("Internal endpoint", internal_url, "internal", 0, 1))
            for label, url, kind, is_primary, sort_order in links:
                connection.execute(
                    """
                    INSERT INTO service_links (service_id, label, url, kind, is_primary, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (service_id, label, url, kind, is_primary, sort_order),
                )
        connection.execute(
            "INSERT OR REPLACE INTO dashboard_settings (key, value) VALUES (?, ?)",
            ("dashboard_title", json.dumps("Home Lab Operations Dashboard")),
        )
        connection.execute(
            "INSERT OR REPLACE INTO dashboard_settings (key, value) VALUES (?, ?)",
            (
                "dashboard_subtitle",
                json.dumps(
                    "Primary Carbon operations surface for service discovery, health, and lab context."
                ),
            ),
        )
        connection.commit()
    finally:
        connection.close()


def fetchall(query, params=()):
    return get_db().execute(query, params).fetchall()


def fetchone(query, params=()):
    return get_db().execute(query, params).fetchone()


def get_tags_for_services(service_ids):
    if not service_ids:
        return {}
    placeholders = ",".join("?" for _ in service_ids)
    rows = fetchall(
        f"SELECT service_id, tag FROM service_tags WHERE service_id IN ({placeholders}) ORDER BY tag",
        service_ids,
    )
    tags = {service_id: [] for service_id in service_ids}
    for row in rows:
        tags.setdefault(row["service_id"], []).append(row["tag"])
    return tags


def get_links_for_services(service_ids):
    if not service_ids:
        return {}
    placeholders = ",".join("?" for _ in service_ids)
    rows = fetchall(
        f"""
        SELECT id, service_id, label, url, kind, is_primary, sort_order
        FROM service_links
        WHERE service_id IN ({placeholders})
        ORDER BY sort_order, id
        """,
        service_ids,
    )
    links = {service_id: [] for service_id in service_ids}
    for row in rows:
        links.setdefault(row["service_id"], []).append(
            {
                "id": row["id"],
                "label": row["label"],
                "url": row["url"],
                "kind": row["kind"],
                "isPrimary": bool(row["is_primary"]),
                "sortOrder": row["sort_order"],
            }
        )
    return links


def get_history_for_service(service_id):
    rows = fetchall(
        """
        SELECT state, status_code, response_time_ms, checked_at, note
        FROM service_checks
        WHERE service_id = ?
        ORDER BY checked_at DESC
        LIMIT ?
        """,
        (service_id, MAX_HISTORY_POINTS),
    )
    return [
        {
            "state": row["state"],
            "statusCode": row["status_code"],
            "responseTimeMs": row["response_time_ms"],
            "checkedAt": row["checked_at"],
            "note": row["note"],
        }
        for row in rows
    ]


def serialize_service_rows(rows, include_links=False, include_history=False):
    if not rows:
        return []
    service_ids = [row["id"] for row in rows]
    tags_by_service = get_tags_for_services(service_ids)
    links_by_service = get_links_for_services(service_ids) if include_links else {}
    services = []
    for row in rows:
        payload = {
            "id": row["id"],
            "slug": row["slug"],
            "name": row["name"],
            "categoryId": row["category_id"],
            "category": {
                "id": row["category_id"],
                "name": row["category_name"],
                "description": row["category_description"],
            },
            "description": row["description"],
            "authMode": row["auth_mode"],
            "externalUrl": row["external_url"],
            "internalUrl": row["internal_url"],
            "probeUrl": row["probe_url"],
            "icon": row["icon"],
            "runbookUrl": row["runbook_url"],
            "notes": row["notes"],
            "featured": bool(row["featured"]),
            "archived": bool(row["archived"]),
            "sortOrder": row["sort_order"],
            "source": row["source"],
            "tags": tags_by_service.get(row["id"], []),
            "status": {
                "state": row["state"] or "unknown",
                "statusCode": row["status_code"],
                "responseTimeMs": row["response_time_ms"],
                "checkedAt": row["checked_at"],
                "note": row["note"],
            },
        }
        if include_links:
            payload["links"] = links_by_service.get(row["id"], [])
        if include_history:
            payload["history"] = get_history_for_service(row["id"])
        services.append(payload)
    return services


def service_base_query():
    return """
        SELECT
            services.*,
            categories.name AS category_name,
            categories.description AS category_description,
            service_status.state,
            service_status.status_code,
            service_status.response_time_ms,
            service_status.checked_at,
            service_status.note
        FROM services
        JOIN categories ON categories.id = services.category_id
        LEFT JOIN service_status ON service_status.service_id = services.id
    """


def list_services(include_archived=False):
    query = service_base_query()
    params = []
    if not include_archived:
        query += " WHERE services.archived = 0"
    query += " ORDER BY services.featured DESC, categories.sort_order, services.sort_order, services.name"
    return serialize_service_rows(fetchall(query, params), include_links=True)


def get_service_or_404(service_id):
    row = fetchone(
        service_base_query() + " WHERE services.id = ?",
        (service_id,),
    )
    if row is None:
        fail("Service not found", 404)
    return serialize_service_rows([row], include_links=True, include_history=True)[0]


def get_categories():
    rows = fetchall(
        """
        SELECT categories.id, categories.name, categories.description, categories.sort_order,
               COUNT(services.id) AS service_count
        FROM categories
        LEFT JOIN services ON services.category_id = categories.id AND services.archived = 0
        GROUP BY categories.id
        ORDER BY categories.sort_order, categories.name
        """
    )
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "description": row["description"],
            "sortOrder": row["sort_order"],
            "serviceCount": row["service_count"],
        }
        for row in rows
    ]


def get_dashboard_settings():
    rows = fetchall("SELECT key, value FROM dashboard_settings")
    payload = {}
    for row in rows:
        payload[row["key"]] = json.loads(row["value"])
    return payload


def get_user_pins(user_id):
    rows = fetchall(
        """
        SELECT services.id
        FROM user_pins
        JOIN services ON services.id = user_pins.service_id
        WHERE user_pins.user_id = ? AND services.archived = 0
        ORDER BY services.featured DESC, services.name
        """,
        (user_id,),
    )
    return [row["id"] for row in rows]


def update_user_pins(user_id, service_ids):
    get_db().execute("DELETE FROM user_pins WHERE user_id = ?", (user_id,))
    for service_id in service_ids:
        existing = fetchone("SELECT id FROM services WHERE id = ? AND archived = 0", (service_id,))
        if existing is not None:
            get_db().execute(
                "INSERT OR IGNORE INTO user_pins (user_id, service_id) VALUES (?, ?)",
                (user_id, service_id),
            )
    get_db().commit()


def build_summary(services):
    summary = {
        "totalServices": len(services),
        "protectedServices": 0,
        "directServices": 0,
        "healthyServices": 0,
        "degradedServices": 0,
        "downServices": 0,
        "averageResponseMs": 0,
    }
    response_times = []
    for service in services:
        if service["authMode"] == "protected":
            summary["protectedServices"] += 1
        else:
            summary["directServices"] += 1
        state = service["status"]["state"]
        if state == "healthy":
            summary["healthyServices"] += 1
        elif state == "degraded":
            summary["degradedServices"] += 1
        elif state == "down":
            summary["downServices"] += 1
        if isinstance(service["status"]["responseTimeMs"], int):
            response_times.append(service["status"]["responseTimeMs"])
    summary["averageResponseMs"] = round(sum(response_times) / len(response_times)) if response_times else 0
    return summary


def get_recent_incidents():
    rows = fetchall(
        """
        SELECT
            services.id,
            services.name,
            services.external_url,
            service_status.state,
            service_status.status_code,
            service_status.response_time_ms,
            service_status.checked_at,
            service_status.note
        FROM service_status
        JOIN services ON services.id = service_status.service_id
        WHERE services.archived = 0 AND service_status.state IN ('down', 'degraded')
        ORDER BY
            CASE service_status.state WHEN 'down' THEN 0 ELSE 1 END,
            service_status.checked_at DESC
        LIMIT 8
        """
    )
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "externalUrl": row["external_url"],
            "state": row["state"],
            "statusCode": row["status_code"],
            "responseTimeMs": row["response_time_ms"],
            "checkedAt": row["checked_at"],
            "note": row["note"],
        }
        for row in rows
    ]


def sanitize_links(raw_links):
    cleaned = []
    for index, link in enumerate(raw_links or []):
        if not isinstance(link, dict):
            continue
        label = str(link.get("label", "")).strip()
        url = str(link.get("url", "")).strip()
        if not label or not url:
            continue
        cleaned.append(
            {
                "label": label,
                "url": url,
                "kind": str(link.get("kind", "external")).strip() or "external",
                "isPrimary": bool(link.get("isPrimary", False)),
                "sortOrder": int(link.get("sortOrder", index)),
            }
        )
    return cleaned


def sanitize_tags(raw_tags):
    tags = []
    seen = set()
    for tag in raw_tags or []:
        normalized = str(tag).strip()
        if normalized and normalized.lower() not in seen:
            tags.append(normalized)
            seen.add(normalized.lower())
    return tags


def validate_service_payload(payload, require_id=False):
    name = str(payload.get("name", "")).strip()
    category_id = str(payload.get("categoryId", "")).strip()
    external_url = str(payload.get("externalUrl", "")).strip()
    if not name or not category_id or not external_url:
        fail("name, categoryId, and externalUrl are required", 400)
    existing_category = fetchone("SELECT id FROM categories WHERE id = ?", (category_id,))
    if existing_category is None:
        fail("Unknown category", 400)
    service_id = normalize_service_id(payload.get("id") if require_id else payload.get("id", name), name)
    return {
        "id": service_id,
        "slug": slugify(payload.get("slug") or service_id),
        "name": name,
        "categoryId": category_id,
        "description": str(payload.get("description", "")).strip(),
        "authMode": normalize_auth_mode(payload.get("authMode")),
        "externalUrl": external_url,
        "internalUrl": str(payload.get("internalUrl", "")).strip(),
        "probeUrl": str(payload.get("probeUrl", "")).strip(),
        "icon": str(payload.get("icon", "")).strip(),
        "runbookUrl": str(payload.get("runbookUrl", "")).strip(),
        "notes": str(payload.get("notes", "")).strip(),
        "featured": int(parse_bool(payload.get("featured"))),
        "archived": int(parse_bool(payload.get("archived"))),
        "sortOrder": int(payload.get("sortOrder", 0)),
        "tags": sanitize_tags(payload.get("tags") or []),
        "links": sanitize_links(payload.get("links") or []),
    }


def write_service_links(service_id, links, primary_url):
    get_db().execute("DELETE FROM service_links WHERE service_id = ?", (service_id,))
    default_has_primary = any(link["isPrimary"] for link in links)
    for index, link in enumerate(links):
        get_db().execute(
            """
            INSERT INTO service_links (service_id, label, url, kind, is_primary, sort_order)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                service_id,
                link["label"],
                link["url"],
                link["kind"],
                int(link["isPrimary"]),
                link["sortOrder"],
            ),
        )
    if not default_has_primary:
        get_db().execute(
            """
            INSERT INTO service_links (service_id, label, url, kind, is_primary, sort_order)
            VALUES (?, ?, ?, 'external', 1, 0)
            """,
            (service_id, "Open service", primary_url),
        )


def write_service_tags(service_id, tags):
    get_db().execute("DELETE FROM service_tags WHERE service_id = ?", (service_id,))
    for tag in tags:
        get_db().execute(
            "INSERT INTO service_tags (service_id, tag) VALUES (?, ?)",
            (service_id, tag),
        )


def classify_status(status_code, response_time_ms):
    if status_code is None:
        return "down"
    if status_code >= 500:
        return "down"
    if status_code >= 400 or response_time_ms > 1500:
        return "degraded"
    return "healthy"


def probe_service(service):
    target = service["probe_url"] or service["internal_url"] or service["external_url"]
    checked_at = to_iso(utc_now())
    if not target:
        return ("unknown", None, None, checked_at, "No probe target configured")
    started = time.perf_counter()
    request_obj = Request(
        target,
        headers={"User-Agent": "index-dashboard/2.0"},
        method="GET",
    )
    try:
        with urlopen(request_obj, timeout=PROBE_TIMEOUT_SECONDS) as response:
            status_code = response.getcode()
            response_time_ms = int((time.perf_counter() - started) * 1000)
            return (
                classify_status(status_code, response_time_ms),
                status_code,
                response_time_ms,
                checked_at,
                None,
            )
    except HTTPError as error:
        response_time_ms = int((time.perf_counter() - started) * 1000)
        return (
            classify_status(error.code, response_time_ms),
            error.code,
            response_time_ms,
            checked_at,
            str(error.reason),
        )
    except (URLError, TimeoutError, OSError) as error:
        response_time_ms = int((time.perf_counter() - started) * 1000)
        return ("down", None, response_time_ms, checked_at, str(error))


def run_probe_cycle():
    if not _probe_lock.acquire(blocking=False):
        return
    try:
        connection = db_connect()
        services = connection.execute(
            """
            SELECT id, external_url, internal_url, probe_url
            FROM services
            WHERE archived = 0
            ORDER BY featured DESC, sort_order, name
            """
        ).fetchall()
        for service in services:
            state, status_code, response_time_ms, checked_at, note = probe_service(service)
            connection.execute(
                """
                INSERT INTO service_status (service_id, state, status_code, response_time_ms, checked_at, note)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(service_id) DO UPDATE SET
                    state = excluded.state,
                    status_code = excluded.status_code,
                    response_time_ms = excluded.response_time_ms,
                    checked_at = excluded.checked_at,
                    note = excluded.note
                """,
                (
                    service["id"],
                    state,
                    status_code,
                    response_time_ms,
                    checked_at,
                    note,
                ),
            )
            connection.execute(
                """
                INSERT INTO service_checks (service_id, state, status_code, response_time_ms, checked_at, note)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    service["id"],
                    state,
                    status_code,
                    response_time_ms,
                    checked_at,
                    note,
                ),
            )
        prune_before = to_iso(utc_now() - timedelta(hours=HISTORY_RETENTION_HOURS))
        connection.execute("DELETE FROM service_checks WHERE checked_at < ?", (prune_before,))
        for service in services:
            rows = connection.execute(
                """
                SELECT id
                FROM service_checks
                WHERE service_id = ?
                ORDER BY checked_at DESC
                LIMIT -1 OFFSET ?
                """,
                (service["id"], MAX_HISTORY_POINTS),
            ).fetchall()
            if rows:
                connection.executemany(
                    "DELETE FROM service_checks WHERE id = ?",
                    [(row["id"],) for row in rows],
                )
        connection.commit()
        connection.close()
    finally:
        _probe_lock.release()


def probe_loop():
    while True:
        try:
            run_probe_cycle()
        except Exception as error:
            print(f"index dashboard probe cycle failed: {error}", flush=True)
        time.sleep(PROBE_INTERVAL_SECONDS)


def start_probe_thread():
    global _probe_thread
    if _probe_thread is not None:
        return
    _probe_thread = threading.Thread(target=probe_loop, daemon=True, name="index-prober")
    _probe_thread.start()


@app.get("/healthz")
def healthz():
    return jsonify({"status": "ok", "environment": APP_ENV})


@app.get("/api/session")
def session():
    viewer = current_identity(required=True)
    pins = get_user_pins(viewer["id"])
    return jsonify(
        {
            "viewer": {
                "id": viewer["id"],
                "username": viewer["username"],
                "email": viewer["email"],
                "displayName": viewer["display_name"],
                "isAdmin": bool(viewer["is_admin"]),
            },
            "pins": pins,
            "environment": APP_ENV,
            "logoutUrl": f"{AUTH_GATEWAY_URL}/logout?rd={PUBLIC_BASE_URL}" if AUTH_GATEWAY_URL else None,
        }
    )


@app.get("/api/dashboard")
def dashboard():
    viewer = current_identity(required=True)
    services = list_services(include_archived=False)
    pins = get_user_pins(viewer["id"])
    pinned_services = [service for service in services if service["id"] in pins]
    featured_services = [service for service in services if service["featured"]][:8]
    critical_ids = {"auth-gateway", "gitlab", "portainer", "traefik", "minio-console", "filebrowser"}
    critical_services = [service for service in services if service["id"] in critical_ids]
    settings = get_dashboard_settings()
    return jsonify(
        {
            "viewer": {
                "id": viewer["id"],
                "username": viewer["username"],
                "email": viewer["email"],
                "displayName": viewer["display_name"],
                "isAdmin": bool(viewer["is_admin"]),
            },
            "dashboard": {
                "title": settings.get("dashboard_title", "Home Lab Operations Dashboard"),
                "subtitle": settings.get(
                    "dashboard_subtitle",
                    "Primary Carbon operations surface for the lab.",
                ),
            },
            "summary": build_summary(services),
            "featuredServices": featured_services,
            "criticalServices": critical_services,
            "pinnedServices": pinned_services,
            "recentIncidents": get_recent_incidents(),
            "categories": get_categories(),
        }
    )


@app.get("/api/dashboard/topology")
def dashboard_topology():
    current_identity(required=True)
    return jsonify(get_topology_payload())


@app.get("/api/categories")
def categories():
    current_identity(required=True)
    return jsonify(get_categories())


@app.get("/api/services")
def services():
    current_identity(required=True)
    query = service_base_query() + " WHERE services.archived = ?"
    params = [1 if parse_bool(request.args.get("archived")) else 0]
    search = request.args.get("q", "").strip().lower()
    category_id = request.args.get("categoryId", "").strip()
    auth_mode = request.args.get("authMode", "").strip()
    status = request.args.get("status", "").strip()
    featured_only = parse_bool(request.args.get("featured"))
    if category_id:
        query += " AND services.category_id = ?"
        params.append(category_id)
    if auth_mode in {"protected", "direct"}:
        query += " AND services.auth_mode = ?"
        params.append(auth_mode)
    if status in {"healthy", "degraded", "down", "unknown"}:
        if status == "unknown":
            query += " AND (service_status.state IS NULL OR service_status.state = 'unknown')"
        else:
            query += " AND service_status.state = ?"
            params.append(status)
    if featured_only:
        query += " AND services.featured = 1"
    if search:
        query += """
            AND (
                LOWER(services.name) LIKE ?
                OR LOWER(services.description) LIKE ?
                OR EXISTS (
                    SELECT 1 FROM service_tags WHERE service_tags.service_id = services.id AND LOWER(service_tags.tag) LIKE ?
                )
            )
        """
        wildcard = f"%{search}%"
        params.extend([wildcard, wildcard, wildcard])
    query += " ORDER BY services.featured DESC, categories.sort_order, services.sort_order, services.name"
    return jsonify(serialize_service_rows(fetchall(query, params), include_links=True))


@app.get("/api/services/<service_id>")
def service_detail(service_id):
    current_identity(required=True)
    return jsonify(get_service_or_404(service_id))


@app.get("/api/status/summary")
def status_summary():
    current_identity(required=True)
    return jsonify(build_summary(list_services(include_archived=False)))


@app.get("/api/me/pins")
def me_pins():
    viewer = current_identity(required=True)
    return jsonify({"pins": get_user_pins(viewer["id"])})


@app.put("/api/me/pins")
def update_pins():
    viewer = current_identity(required=True)
    payload = request.get_json(silent=True) or {}
    service_ids = payload.get("pins") or []
    if not isinstance(service_ids, list):
        return json_response({"error": "pins must be an array"}, 400)
    update_user_pins(viewer["id"], [str(item) for item in service_ids])
    return jsonify({"pins": get_user_pins(viewer["id"])})


@app.get("/api/admin/users")
def admin_users():
    require_admin()
    rows = fetchall(
        """
        SELECT id, username, email, display_name, is_admin, last_seen_at
        FROM users
        ORDER BY is_admin DESC, username
        """
    )
    return jsonify(
        [
            {
                "id": row["id"],
                "username": row["username"],
                "email": row["email"],
                "displayName": row["display_name"],
                "isAdmin": bool(row["is_admin"]),
                "lastSeenAt": row["last_seen_at"],
            }
            for row in rows
        ]
    )


@app.put("/api/admin/users/<int:user_id>")
def admin_update_user(user_id):
    require_admin()
    payload = request.get_json(silent=True) or {}
    get_db().execute(
        "UPDATE users SET is_admin = ?, updated_at = ? WHERE id = ?",
        (1 if parse_bool(payload.get("isAdmin")) else 0, to_iso(utc_now()), user_id),
    )
    get_db().commit()
    row = fetchone(
        "SELECT id, username, email, display_name, is_admin, last_seen_at FROM users WHERE id = ?",
        (user_id,),
    )
    if row is None:
        return json_response({"error": "User not found"}, 404)
    return jsonify(
        {
            "id": row["id"],
            "username": row["username"],
            "email": row["email"],
            "displayName": row["display_name"],
            "isAdmin": bool(row["is_admin"]),
            "lastSeenAt": row["last_seen_at"],
        }
    )


@app.get("/api/admin/categories")
def admin_categories():
    require_admin()
    return jsonify(get_categories())


@app.post("/api/admin/categories")
def admin_create_category():
    require_admin()
    payload = request.get_json(silent=True) or {}
    category_id = slugify(payload.get("id") or payload.get("name") or "")
    name = str(payload.get("name", "")).strip()
    if not category_id or not name:
        return json_response({"error": "id and name are required"}, 400)
    now = to_iso(utc_now())
    get_db().execute(
        """
        INSERT INTO categories (id, name, description, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            category_id,
            name,
            str(payload.get("description", "")).strip(),
            int(payload.get("sortOrder", 0)),
            now,
            now,
        ),
    )
    get_db().commit()
    return jsonify(get_categories())


@app.put("/api/admin/categories/<category_id>")
def admin_update_category(category_id):
    require_admin()
    payload = request.get_json(silent=True) or {}
    get_db().execute(
        """
        UPDATE categories
        SET name = ?, description = ?, sort_order = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            str(payload.get("name", category_id)).strip(),
            str(payload.get("description", "")).strip(),
            int(payload.get("sortOrder", 0)),
            to_iso(utc_now()),
            category_id,
        ),
    )
    get_db().commit()
    return jsonify(get_categories())


@app.get("/api/admin/services")
def admin_services():
    require_admin()
    return jsonify(list_services(include_archived=True))


@app.post("/api/admin/services")
def admin_create_service():
    require_admin()
    payload = validate_service_payload(request.get_json(silent=True) or {})
    existing = fetchone("SELECT id FROM services WHERE id = ?", (payload["id"],))
    if existing is not None:
        return json_response({"error": "Service id already exists"}, 409)
    now = to_iso(utc_now())
    get_db().execute(
        """
        INSERT INTO services (
            id, slug, name, category_id, description, auth_mode, external_url, internal_url,
            probe_url, icon, runbook_url, notes, featured, archived, sort_order, source, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)
        """,
        (
            payload["id"],
            payload["slug"],
            payload["name"],
            payload["categoryId"],
            payload["description"],
            payload["authMode"],
            payload["externalUrl"],
            payload["internalUrl"],
            payload["probeUrl"],
            payload["icon"],
            payload["runbookUrl"],
            payload["notes"],
            payload["featured"],
            payload["archived"],
            payload["sortOrder"],
            now,
            now,
        ),
    )
    write_service_tags(payload["id"], payload["tags"])
    write_service_links(payload["id"], payload["links"], payload["externalUrl"])
    get_db().commit()
    return jsonify(get_service_or_404(payload["id"]))


@app.put("/api/admin/services/<service_id>")
def admin_update_service(service_id):
    require_admin()
    existing = fetchone("SELECT id FROM services WHERE id = ?", (service_id,))
    if existing is None:
        return json_response({"error": "Service not found"}, 404)
    payload = validate_service_payload(request.get_json(silent=True) or {"id": service_id}, require_id=True)
    now = to_iso(utc_now())
    get_db().execute(
        """
        UPDATE services
        SET slug = ?, name = ?, category_id = ?, description = ?, auth_mode = ?, external_url = ?,
            internal_url = ?, probe_url = ?, icon = ?, runbook_url = ?, notes = ?, featured = ?,
            archived = ?, sort_order = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            payload["slug"],
            payload["name"],
            payload["categoryId"],
            payload["description"],
            payload["authMode"],
            payload["externalUrl"],
            payload["internalUrl"],
            payload["probeUrl"],
            payload["icon"],
            payload["runbookUrl"],
            payload["notes"],
            payload["featured"],
            payload["archived"],
            payload["sortOrder"],
            now,
            service_id,
        ),
    )
    write_service_tags(service_id, payload["tags"])
    write_service_links(service_id, payload["links"], payload["externalUrl"])
    get_db().commit()
    return jsonify(get_service_or_404(service_id))


@app.post("/api/admin/services/<service_id>/archive")
def admin_archive_service(service_id):
    require_admin()
    payload = request.get_json(silent=True) or {}
    get_db().execute(
        "UPDATE services SET archived = ?, updated_at = ? WHERE id = ?",
        (1 if parse_bool(payload.get("archived", True)) else 0, to_iso(utc_now()), service_id),
    )
    get_db().commit()
    return jsonify(get_service_or_404(service_id))


@app.post("/api/admin/probes/run")
def admin_run_probes():
    require_admin()
    run_probe_cycle()
    return jsonify({"status": "ok"})


@app.get("/api/admin/export")
def admin_export():
    require_admin()
    services = list_services(include_archived=True)
    categories = get_categories()
    return jsonify(
        {
            "dashboard": get_dashboard_settings(),
            "categories": categories,
            "services": services,
        }
    )


initialize_schema()
seed_database_if_empty()
run_probe_cycle()
start_probe_thread()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
