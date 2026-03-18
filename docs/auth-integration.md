# Auth Gateway Integration

The dashboard is designed to sit behind a forward-auth gateway that handles
authentication and injects identity headers. This is the recommended production
setup — the dashboard itself has no login page.

## How it works

1. The auth gateway authenticates the user (SSO, OIDC, LDAP, local accounts, etc.)
2. On success, the gateway proxies the request to the dashboard and injects three headers:
   - `X-Auth-User` — unique username / identifier
   - `X-Auth-Email` — user email address
   - `X-Auth-Name` — display name
3. The dashboard API reads these headers and creates or updates a local user record.
4. The first user whose username matches `INDEX_BOOTSTRAP_ADMIN_USERNAME` is granted admin.

## Supported gateways

Any gateway that can inject custom headers works. Below are configuration snippets
for common options.

---

### Authelia

In your Authelia `configuration.yml`, configure an access control rule and ensure
the proxy passes auth headers:

```yaml
# nginx / Traefik will forward X-Auth-User, X-Auth-Email, X-Auth-Name
# after Authelia sets them via the forwardauth response headers.
```

In your Traefik dynamic config:

```yaml
http:
  middlewares:
    authelia:
      forwardAuth:
        address: "http://authelia:9091/api/authz/forward-auth"
        trustForwardHeader: true
        authResponseHeaders:
          - "Remote-User"
          - "Remote-Email"
          - "Remote-Name"
```

Then map Authelia's response headers to the headers the dashboard expects using
Traefik header middleware:

```yaml
http:
  middlewares:
    inject-auth-headers:
      headers:
        customRequestHeaders:
          X-Auth-User: ""   # overridden by Traefik from Remote-User
          X-Auth-Email: ""
          X-Auth-Name: ""
```

> Authelia uses `Remote-User` / `Remote-Email` / `Remote-Name` header names.
> Use a header rewrite middleware to rename them to `X-Auth-*` before they
> reach the dashboard.

---

### oauth2-proxy

```ini
# oauth2-proxy.cfg
pass_user_headers = true
pass_access_token = false

# These headers are injected automatically when pass_user_headers = true:
# X-Auth-Request-User  → map to X-Auth-User
# X-Auth-Request-Email → map to X-Auth-Email
```

Add a header rewrite at your reverse proxy to rename `X-Auth-Request-*` to `X-Auth-*`.

---

### Nginx `auth_request`

```nginx
location / {
    auth_request /auth;
    auth_request_set $auth_user  $upstream_http_x_auth_user;
    auth_request_set $auth_email $upstream_http_x_auth_email;
    auth_request_set $auth_name  $upstream_http_x_auth_name;

    proxy_set_header X-Auth-User  $auth_user;
    proxy_set_header X-Auth-Email $auth_email;
    proxy_set_header X-Auth-Name  $auth_name;

    proxy_pass http://127.0.0.1:18493;
}
```

---

## Running without an auth gateway

The dashboard works without any auth gateway. Without the identity headers, all
requests are treated as unauthenticated and no user-specific features (pinned
services, admin access) are available.

If you want admin access without a gateway, set the bootstrap admin env vars,
then send the headers manually from a trusted source or disable the auth check
by setting `APP_ENV=development` (not recommended in production).

## Logout

When `INDEX_AUTH_GATEWAY_URL` is set, the session API returns a `logoutUrl` of:

```
{INDEX_AUTH_GATEWAY_URL}/logout?rd={INDEX_PUBLIC_BASE_URL}
```

The "Log out" button in the UI navigates to this URL. The gateway handles the
actual session termination and redirects back to the dashboard.
