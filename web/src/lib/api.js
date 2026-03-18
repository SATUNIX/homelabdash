function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

async function request(path, options = {}) {
  const config = {
    credentials: "same-origin",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  };
  if (options.body && typeof options.body !== "string") {
    config.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, config);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && payload.error
        ? payload.error
        : `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export const api = {
  getSession() {
    return request("/api/session");
  },
  getDashboard() {
    return request("/api/dashboard");
  },
  getDashboardTopology() {
    return request("/api/dashboard/topology");
  },
  getCategories() {
    return request("/api/categories");
  },
  getServices(params = {}) {
    return request(`/api/services${buildQuery(params)}`);
  },
  getService(serviceId) {
    return request(`/api/services/${serviceId}`);
  },
  updatePins(pins) {
    return request("/api/me/pins", {
      method: "PUT",
      body: { pins }
    });
  },
  getAdminServices() {
    return request("/api/admin/services");
  },
  saveService(serviceId, payload) {
    return request(serviceId ? `/api/admin/services/${serviceId}` : "/api/admin/services", {
      method: serviceId ? "PUT" : "POST",
      body: payload
    });
  },
  archiveService(serviceId, archived) {
    return request(`/api/admin/services/${serviceId}/archive`, {
      method: "POST",
      body: { archived }
    });
  },
  getAdminCategories() {
    return request("/api/admin/categories");
  },
  saveCategory(categoryId, payload) {
    return request(categoryId ? `/api/admin/categories/${categoryId}` : "/api/admin/categories", {
      method: categoryId ? "PUT" : "POST",
      body: payload
    });
  },
  getAdminUsers() {
    return request("/api/admin/users");
  },
  updateUser(userId, payload) {
    return request(`/api/admin/users/${userId}`, {
      method: "PUT",
      body: payload
    });
  },
  runProbeCycle() {
    return request("/api/admin/probes/run", { method: "POST" });
  },
  exportAdminData() {
    return request("/api/admin/export");
  }
};
