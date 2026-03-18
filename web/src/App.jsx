import React, { useEffect, useMemo, useState } from "react";
import {
  Accordion,
  AccordionItem,
  Breadcrumb,
  BreadcrumbItem,
  Button,
  Checkbox,
  Column,
  Content,
  Form,
  GlobalTheme,
  Grid,
  Header,
  HeaderMenuButton,
  HeaderMenuItem,
  HeaderNavigation,
  HeaderName,
  InlineLoading,
  InlineNotification,
  Loading,
  Search,
  Select,
  SelectItem,
  SideNav,
  SideNavItems,
  SideNavLink,
  SkipToContent,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  TextArea,
  TextInput,
  Theme,
  Tile,
  Toggle
} from "@carbon/react";
import { useLocation, useParams, Routes, Route } from "react-router-dom";
import { api } from "./lib/api";
import MetricTile from "./components/MetricTile";
import ServiceCard from "./components/ServiceCard";
import TopologyGraph from "./components/TopologyGraph";
import TopologySummaryCard from "./components/TopologySummaryCard";

const THEME_KEY = "index-dashboard:theme";

function readLocalStorage(key, fallback) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (_error) {
    return fallback;
  }
}

function pathMatches(currentPath, prefix) {
  return currentPath === prefix || currentPath.startsWith(`${prefix}/`);
}

function useResource(fetcher, deps, intervalMs = null) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setError("");
        const payload = await fetcher();
        if (!cancelled) {
          setData(payload);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    setLoading(true);
    load();
    if (!intervalMs) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, deps);

  return { loading, error, data };
}

function IncidentTile({ incident }) {
  return (
    <Tile className="incident-tile">
      <div className="incident-tile__header">
        <h4>{incident.name}</h4>
        <Tag type={incident.state === "down" ? "red" : "warm-gray"}>{incident.state}</Tag>
      </div>
      <p>{incident.note || "Service is reporting a degraded operational state."}</p>
      <div className="incident-tile__meta">
        <span>{incident.statusCode ? `HTTP ${incident.statusCode}` : "No status code"}</span>
        <span>{incident.responseTimeMs ? `${incident.responseTimeMs} ms` : "No timing"}</span>
      </div>
      <Button as="a" href={`/services/${incident.id}`} kind="ghost" size="sm">
        Review service
      </Button>
    </Tile>
  );
}

function EmptyTile({ title, message }) {
  return (
    <Tile className="empty-tile">
      <h4>{title}</h4>
      <p>{message}</p>
    </Tile>
  );
}

function OverviewServiceTabs({ criticalServices, featuredServices, pinnedSet, onTogglePin }) {
  return (
    <section className="dashboard-section">
      <div className="section-heading">
        <div>
          <h2>Service focus</h2>
          <p>Switch between the platform-critical stack and the most frequently used services without burning another full row.</p>
        </div>
      </div>
      <Tabs className="overview-service-tabs">
        <TabList aria-label="Overview service focus">
          <Tab>Critical platform</Tab>
          <Tab>Featured services</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <p className="overview-service-tabs__intro">Gateway, storage, and control-plane services that keep the lab usable.</p>
            <div className="service-grid service-grid--dense">
              {criticalServices.length ? criticalServices.map((service) => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  pinned={pinnedSet.has(service.id)}
                  onTogglePinned={onTogglePin}
                  compact
                />
              )) : <EmptyTile title="No critical services" message="Critical platform services have not been curated yet." />}
            </div>
          </TabPanel>
          <TabPanel>
            <p className="overview-service-tabs__intro">High-traffic apps seeded from the previous dashboard and curated platform routes.</p>
            <div className="service-grid service-grid--dense">
              {featuredServices.length ? featuredServices.map((service) => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  pinned={pinnedSet.has(service.id)}
                  onTogglePinned={onTogglePin}
                  compact
                />
              )) : <EmptyTile title="No featured services" message="Featured services have not been curated yet." />}
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </section>
  );
}

function OverviewPage({ pins, onTogglePin, refreshNonce }) {
  const { loading, error, data } = useResource(() => api.getDashboard(), [refreshNonce], 30000);
  const topology = useResource(() => api.getDashboardTopology(), [refreshNonce], 30000);

  if (loading && !data) {
    return <Loading withOverlay={false} description="Loading dashboard" />;
  }

  const summary = data?.summary || {};
  const featuredServices = data?.featuredServices || [];
  const criticalServices = data?.criticalServices || [];
  const incidents = data?.recentIncidents || [];
  const pinnedServices = data?.pinnedServices || [];
  const categories = data?.categories || [];
  const pinnedSet = new Set(pins);

  return (
    <Grid condensed fullWidth className="index-dashboard__grid">
      <Column lg={10} md={8} sm={4}>
        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <h1>{data?.dashboard?.title || "Home Lab Operations Dashboard"}</h1>
              <p>
                {data?.dashboard?.subtitle ||
                  "Primary Carbon operations surface for service discovery, health, and lab context."}
              </p>
            </div>
            {loading ? <InlineLoading description="Refreshing" /> : <Tag type="blue">{summary.totalServices || 0} tracked</Tag>}
          </div>
          {error ? <InlineNotification kind="error" title="Dashboard error" subtitle={error} hideCloseButton /> : null}
        </section>
      </Column>

      <Column lg={6} md={8} sm={4}>
        <section className="dashboard-section">
          <Tile className="status-tile status-tile--summary">
            <h3>At a glance</h3>
            <p>Fast operational context for the current snapshot.</p>
            <div className="status-tile__tags">
              <Tag type="blue">{summary.totalServices || 0} tracked</Tag>
              <Tag type="green">{summary.healthyServices || 0} healthy</Tag>
              <Tag type="warm-gray">{summary.degradedServices || 0} degraded</Tag>
              <Tag type="red">{summary.downServices || 0} down</Tag>
            </div>
          </Tile>
        </section>
      </Column>

      <Column lg={4} md={4} sm={4}>
        <MetricTile label="Tracked services" value={summary.totalServices || 0} helper="Curated runtime inventory" />
      </Column>
      <Column lg={4} md={4} sm={4}>
        <MetricTile label="Healthy" value={summary.healthyServices || 0} helper={`${summary.degradedServices || 0} degraded / ${summary.downServices || 0} down`} />
      </Column>
      <Column lg={4} md={4} sm={4}>
        <MetricTile label="Protected routes" value={summary.protectedServices || 0} helper={`${summary.directServices || 0} direct routes`} />
      </Column>
      <Column lg={4} md={4} sm={4}>
        <MetricTile label="Average probe" value={`${summary.averageResponseMs || 0} ms`} helper="Current short-window latency" />
      </Column>

      <Column lg={11} md={8} sm={4}>
        <section className="dashboard-section">
          <TopologySummaryCard topology={topology.data} loading={topology.loading} error={topology.error} />
        </section>
      </Column>

      <Column lg={5} md={8} sm={4}>
        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <h2>Quick launch</h2>
              <p>Server-side pinned services follow the authenticated user.</p>
            </div>
          </div>
          <div className="quick-launch-list">
            {pinnedServices.length ? pinnedServices.map((service) => <ServiceCard key={service.id} service={service} pinned onTogglePinned={onTogglePin} compact />) : <EmptyTile title="No pinned services" message="Pin services from the directory or detail pages to keep them here." />}
          </div>
        </section>
      </Column>

      <Column lg={5} md={8} sm={4}>
        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <h2>Recent incidents</h2>
              <p>Current degraded or down services surfaced by the short operational history window.</p>
            </div>
          </div>
          <div className="incident-grid incident-grid--dense">
            {incidents.length ? incidents.map((incident) => <IncidentTile key={incident.id} incident={incident} />) : <EmptyTile title="No open incidents" message="All actively tracked services are currently healthy." />}
          </div>
        </section>
      </Column>

      <Column lg={11} md={8} sm={4}>
        <OverviewServiceTabs
          criticalServices={criticalServices}
          featuredServices={featuredServices}
          pinnedSet={pinnedSet}
          onTogglePin={onTogglePin}
        />
      </Column>

      <Column lg={16} md={8} sm={4}>
        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <h2>Category coverage</h2>
              <p>Current inventory distribution across the operating domains in the lab.</p>
            </div>
          </div>
          <Grid condensed fullWidth>
            {categories.map((category) => (
              <Column key={category.id} lg={4} md={4} sm={4}>
                <Tile className="status-tile">
                  <h3>{category.name}</h3>
                  <p>{category.description}</p>
                  <Tag type="blue">{category.serviceCount} services</Tag>
                </Tile>
              </Column>
            ))}
          </Grid>
        </section>
      </Column>
    </Grid>
  );
}

function TopologyPage({ refreshNonce }) {
  const topology = useResource(() => api.getDashboardTopology(), [refreshNonce], 30000);

  return (
    <Grid condensed fullWidth className="index-dashboard__grid">
      <Column lg={16} md={8} sm={4}>
        <Breadcrumb noTrailingSlash>
          <BreadcrumbItem href="/">Overview</BreadcrumbItem>
          <BreadcrumbItem isCurrentPage>Topology</BreadcrumbItem>
        </Breadcrumb>
      </Column>

      <Column lg={16} md={8} sm={4}>
        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <h1>Full network graph</h1>
              <p>Expanded canvas view for service-to-network links, runtime state, and simulated traffic flow.</p>
            </div>
          </div>
        </section>
      </Column>

      <Column lg={16} md={8} sm={4}>
        <TopologyGraph topology={topology.data} loading={topology.loading} error={topology.error} />
      </Column>
    </Grid>
  );
}

function DirectoryPage({ pins, onTogglePin, refreshNonce }) {
  const { loading, error, data } = useResource(() => Promise.all([api.getServices(), api.getCategories()]), [refreshNonce], 30000);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [authFilter, setAuthFilter] = useState("all");
  const [featuredOnly, setFeaturedOnly] = useState(false);

  if (loading && !data) {
    return <Loading withOverlay={false} description="Loading directory" />;
  }

  const services = data?.[0] || [];
  const categories = data?.[1] || [];
  const pinnedSet = new Set(pins);
  const filteredServices = services.filter((service) => {
    const haystack = [
      service.name,
      service.description,
      service.category?.name,
      ...(service.tags || [])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (query && !haystack.includes(query.trim().toLowerCase())) {
      return false;
    }
    if (categoryId !== "all" && service.categoryId !== categoryId) {
      return false;
    }
    if (statusFilter !== "all" && (service.status?.state || "unknown") !== statusFilter) {
      return false;
    }
    if (authFilter !== "all" && service.authMode !== authFilter) {
      return false;
    }
    if (featuredOnly && !service.featured) {
      return false;
    }
    return true;
  });

  const grouped = categories
    .map((category) => ({
      category,
      services: filteredServices.filter((service) => service.categoryId === category.id)
    }))
    .filter((group) => group.services.length > 0);

  return (
    <Grid condensed fullWidth className="index-dashboard__grid">
      <Column lg={16} md={8} sm={4}>
        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <h1>Service directory</h1>
              <p>Search, filter, and drill into the operational catalog owned by the dashboard.</p>
            </div>
          </div>
          {error ? <InlineNotification kind="error" title="Directory error" subtitle={error} hideCloseButton /> : null}
        </section>
      </Column>

      <Column lg={16} md={8} sm={4}>
        <Tile className="filters-panel">
          <div className="filters-panel__row">
            <Search
              id="directory-search"
              labelText="Search services"
              placeHolderText="Search services, tags, and categories"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Select id="directory-category" labelText="Category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <SelectItem value="all" text="All categories" />
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id} text={category.name} />
              ))}
            </Select>
            <Select id="directory-status" labelText="Health" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <SelectItem value="all" text="All states" />
              <SelectItem value="healthy" text="Healthy" />
              <SelectItem value="degraded" text="Degraded" />
              <SelectItem value="down" text="Down" />
              <SelectItem value="unknown" text="Unknown" />
            </Select>
            <Select id="directory-auth" labelText="Access model" value={authFilter} onChange={(event) => setAuthFilter(event.target.value)}>
              <SelectItem value="all" text="All access models" />
              <SelectItem value="protected" text="Protected" />
              <SelectItem value="direct" text="Direct" />
            </Select>
          </div>
          <Checkbox
            id="directory-featured"
            labelText="Featured services only"
            checked={featuredOnly}
            onChange={(_, { checked }) => setFeaturedOnly(checked)}
          />
        </Tile>
      </Column>

      <Column lg={16} md={8} sm={4}>
        <Accordion align="start" className="directory-accordion">
          {grouped.length ? (
            grouped.map((group) => (
              <AccordionItem key={group.category.id} title={`${group.category.name} (${group.services.length})`}>
                <p className="category-description">{group.category.description}</p>
                <div className="service-grid">
                  {group.services.map((service) => (
                    <ServiceCard
                      key={service.id}
                      service={service}
                      pinned={pinnedSet.has(service.id)}
                      onTogglePinned={onTogglePin}
                    />
                  ))}
                </div>
              </AccordionItem>
            ))
          ) : (
            <Tile className="status-tile">
              <h3>No services match the current filters</h3>
              <p>Adjust the current search or filter set to expand the directory view.</p>
            </Tile>
          )}
        </Accordion>
      </Column>
    </Grid>
  );
}

function ServiceDetailPage({ pins, onTogglePin, refreshNonce }) {
  const { serviceId } = useParams();
  const { loading, error, data } = useResource(() => api.getService(serviceId), [serviceId, refreshNonce], 30000);
  const related = useResource(
    () => (data?.categoryId ? api.getServices({ categoryId: data.categoryId }) : Promise.resolve([])),
    [data?.categoryId, refreshNonce],
    30000
  );

  if (loading && !data) {
    return <Loading withOverlay={false} description="Loading service detail" />;
  }

  if (!data) {
      return (
      <Grid condensed fullWidth className="index-dashboard__grid">
        <Column lg={16} md={8} sm={4}>
          <InlineNotification kind="error" title="Service detail error" subtitle={error || "Service not found"} hideCloseButton />
        </Column>
      </Grid>
    );
  }

  const pinned = pins.includes(data.id);
  const primaryLink = (data.links || []).find((link) => link.isPrimary) || (data.links || [])[0];
  const relatedServices = (related.data || []).filter((service) => service.id !== data.id).slice(0, 4);

  return (
    <Grid condensed fullWidth className="index-dashboard__grid">
      <Column lg={16} md={8} sm={4}>
        <Breadcrumb noTrailingSlash>
          <BreadcrumbItem href="/">Overview</BreadcrumbItem>
          <BreadcrumbItem href="/services">Directory</BreadcrumbItem>
          <BreadcrumbItem isCurrentPage>{data.name}</BreadcrumbItem>
        </Breadcrumb>
      </Column>

      <Column lg={16} md={8} sm={4}>
        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <h1>{data.name}</h1>
              <p>{data.description}</p>
            </div>
            <div className="service-detail__header-tags">
              <Tag type="blue">{data.authMode}</Tag>
              <Tag type={data.status?.state === "healthy" ? "green" : data.status?.state === "down" ? "red" : "warm-gray"}>
                {data.status?.state || "unknown"}
              </Tag>
            </div>
          </div>
          {error ? <InlineNotification kind="warning" title="Refresh issue" subtitle={error} hideCloseButton /> : null}
          <div className="service-detail__actions">
            {primaryLink ? (
              <Button as="a" href={primaryLink.url} target="_blank" rel="noreferrer" kind="primary">
                Open service
              </Button>
            ) : null}
            <Button kind="secondary" onClick={() => onTogglePin(data.id)}>
              {pinned ? "Remove pin" : "Pin service"}
            </Button>
            {data.runbookUrl ? (
              <Button as="a" href={data.runbookUrl} target="_blank" rel="noreferrer" kind="ghost">
                Open runbook
              </Button>
            ) : null}
          </div>
        </section>
      </Column>

      <Column lg={5} md={4} sm={4}>
        <MetricTile label="Last probe" value={data.status?.responseTimeMs ? `${data.status.responseTimeMs} ms` : "N/A"} helper={data.status?.checkedAt || "No recent check"} />
      </Column>
      <Column lg={5} md={4} sm={4}>
        <MetricTile label="HTTP status" value={data.status?.statusCode || "N/A"} helper={data.status?.note || "No probe note"} />
      </Column>
      <Column lg={6} md={8} sm={4}>
        <MetricTile label="Category" value={data.category?.name || data.categoryId} helper={data.source === "seed" ? "Seeded service record" : "Admin-managed catalog record"} />
      </Column>

      <Column lg={10} md={8} sm={4}>
        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <h2>Operational profile</h2>
              <p>Metadata, notes, and route context for this service.</p>
            </div>
          </div>
          <Tile className="service-detail__panel">
            <div className="service-detail__kv">
              <span>External URL</span>
              <a href={data.externalUrl} target="_blank" rel="noreferrer">
                {data.externalUrl}
              </a>
            </div>
            {data.internalUrl ? (
              <div className="service-detail__kv">
                <span>Internal endpoint</span>
                <code>{data.internalUrl}</code>
              </div>
            ) : null}
            {data.probeUrl ? (
              <div className="service-detail__kv">
                <span>Probe target</span>
                <code>{data.probeUrl}</code>
              </div>
            ) : null}
            <div className="service-detail__kv">
              <span>Tags</span>
              <div className="service-detail__tags">
                {(data.tags || []).map((tag) => (
                  <Tag key={tag} type="gray">
                    {tag}
                  </Tag>
                ))}
              </div>
            </div>
            <div className="service-detail__notes">
              <h3>Notes</h3>
              <p>{data.notes || "No notes have been recorded for this service yet."}</p>
            </div>
            <div className="service-detail__notes">
              <h3>Links</h3>
              <ul className="service-detail__link-list">
                {(data.links || []).map((link) => (
                  <li key={`${link.label}-${link.url}`}>
                    <a href={link.url} target="_blank" rel="noreferrer">
                      {link.label}
                    </a>
                    <Tag type={link.kind === "internal" ? "purple" : "blue"}>{link.kind}</Tag>
                  </li>
                ))}
              </ul>
            </div>
          </Tile>
        </section>
      </Column>

      <Column lg={6} md={8} sm={4}>
        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <h2>Recent history</h2>
              <p>Short operational history retained by the dashboard.</p>
            </div>
          </div>
          <Tile className="history-panel">
            {(data.history || []).length ? (
              <ul className="history-list">
                {data.history.map((entry, index) => (
                  <li key={`${entry.checkedAt}-${index}`} className="history-list__item">
                    <div>
                      <strong>{entry.state}</strong>
                      <p>{entry.checkedAt}</p>
                    </div>
                    <div>
                      <span>{entry.statusCode ? `HTTP ${entry.statusCode}` : "No code"}</span>
                      <span>{entry.responseTimeMs ? `${entry.responseTimeMs} ms` : "No timing"}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No retained history exists yet for this service.</p>
            )}
          </Tile>
        </section>
      </Column>

      <Column lg={16} md={8} sm={4}>
        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <h2>Related services</h2>
              <p>Other services in the same operating domain.</p>
            </div>
          </div>
          <div className="service-grid">
            {relatedServices.length ? relatedServices.map((service) => <ServiceCard key={service.id} service={service} pinned={pins.includes(service.id)} onTogglePinned={onTogglePin} compact />) : <EmptyTile title="No related services" message="No additional services are available in this category." />}
          </div>
        </section>
      </Column>
    </Grid>
  );
}

function buildServiceFormState(service) {
  if (!service) {
    return {
      id: "",
      name: "",
      categoryId: "",
      description: "",
      authMode: "protected",
      externalUrl: "",
      internalUrl: "",
      probeUrl: "",
      icon: "",
      runbookUrl: "",
      notes: "",
      featured: false,
      archived: false,
      sortOrder: 0,
      tagsText: "",
      linksText: ""
    };
  }
  return {
    id: service.id,
    name: service.name,
    categoryId: service.categoryId,
    description: service.description || "",
    authMode: service.authMode,
    externalUrl: service.externalUrl || "",
    internalUrl: service.internalUrl || "",
    probeUrl: service.probeUrl || "",
    icon: service.icon || "",
    runbookUrl: service.runbookUrl || "",
    notes: service.notes || "",
    featured: Boolean(service.featured),
    archived: Boolean(service.archived),
    sortOrder: service.sortOrder || 0,
    tagsText: (service.tags || []).join(", "),
    linksText: (service.links || [])
      .map((link) => `${link.label}|${link.url}|${link.kind}|${link.isPrimary ? "primary" : ""}`)
      .join("\n")
  };
}

function parseTagsInput(tagsText) {
  return tagsText
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseLinksInput(linksText) {
  return linksText
    .split("\n")
    .map((line, index) => {
      const [label, url, kind = "external", primary = ""] = line.split("|").map((value) => value.trim());
      if (!label || !url) {
        return null;
      }
      return {
        label,
        url,
        kind: kind || "external",
        isPrimary: primary.toLowerCase() === "primary",
        sortOrder: index
      };
    })
    .filter(Boolean);
}

function AdminPage({ refreshNonce, onAdminChange }) {
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [serviceForm, setServiceForm] = useState(buildServiceFormState());
  const [categoryForm, setCategoryForm] = useState({ id: "", name: "", description: "", sortOrder: 0 });
  const [notice, setNotice] = useState(null);
  const { loading, error, data } = useResource(
    () => Promise.all([api.getAdminServices(), api.getAdminCategories(), api.getAdminUsers(), api.getSession()]),
    [refreshNonce],
    null
  );

  useEffect(() => {
    if (!data?.[0]) {
      return;
    }
    if (!selectedServiceId) {
      return;
    }
    const selected = data[0].find((service) => service.id === selectedServiceId);
    if (selected) {
      setServiceForm(buildServiceFormState(selected));
    }
  }, [data, selectedServiceId]);

  if (loading && !data) {
    return <Loading withOverlay={false} description="Loading admin surface" />;
  }

  const services = data?.[0] || [];
  const categories = data?.[1] || [];
  const users = data?.[2] || [];
  const session = data?.[3] || {};
  const viewer = session.viewer;

  if (!viewer?.isAdmin) {
    return (
      <Grid condensed fullWidth className="index-dashboard__grid">
        <Column lg={16} md={8} sm={4}>
          <InlineNotification
            kind="warning"
            title="Admin access required"
            subtitle="This dashboard is configured for read-only operations unless the signed-in user has the local dashboard admin role."
            hideCloseButton
          />
        </Column>
      </Grid>
    );
  }

  async function saveService(event) {
    event.preventDefault();
    setNotice(null);
    try {
      const payload = {
        ...serviceForm,
        tags: parseTagsInput(serviceForm.tagsText),
        links: parseLinksInput(serviceForm.linksText)
      };
      const saved = await api.saveService(selectedServiceId || null, payload);
      setSelectedServiceId(saved.id);
      setServiceForm(buildServiceFormState(saved));
      setNotice({ kind: "success", title: "Service saved", subtitle: `${saved.name} has been updated.` });
      onAdminChange();
    } catch (saveError) {
      setNotice({ kind: "error", title: "Save failed", subtitle: saveError.message });
    }
  }

  async function toggleArchive(serviceId, archived) {
    try {
      await api.archiveService(serviceId, archived);
      setNotice({
        kind: "success",
        title: archived ? "Service archived" : "Service restored",
        subtitle: `${serviceId} has been ${archived ? "hidden from the main directory" : "returned to the main directory"}.`
      });
      onAdminChange();
    } catch (archiveError) {
      setNotice({ kind: "error", title: "Archive change failed", subtitle: archiveError.message });
    }
  }

  async function saveCategory(event) {
    event.preventDefault();
    setNotice(null);
    try {
      await api.saveCategory(categoryForm.id || null, categoryForm);
      setCategoryForm({ id: "", name: "", description: "", sortOrder: 0 });
      setNotice({ kind: "success", title: "Category saved", subtitle: "Category configuration has been updated." });
      onAdminChange();
    } catch (categoryError) {
      setNotice({ kind: "error", title: "Category save failed", subtitle: categoryError.message });
    }
  }

  async function setUserAdmin(userId, isAdmin) {
    try {
      await api.updateUser(userId, { isAdmin });
      setNotice({ kind: "success", title: "User role updated", subtitle: "Local dashboard role assignment has been saved." });
      onAdminChange();
    } catch (userError) {
      setNotice({ kind: "error", title: "Role update failed", subtitle: userError.message });
    }
  }

  async function runProbeCycle() {
    try {
      await api.runProbeCycle();
      setNotice({ kind: "success", title: "Probe cycle started", subtitle: "A manual health probe cycle has been triggered." });
      onAdminChange();
    } catch (probeError) {
      setNotice({ kind: "error", title: "Probe cycle failed", subtitle: probeError.message });
    }
  }

  return (
    <Grid condensed fullWidth className="index-dashboard__grid">
      <Column lg={16} md={8} sm={4}>
        <section className="dashboard-section">
          <div className="section-heading">
            <div>
              <h1>Dashboard administration</h1>
              <p>Own the service catalog, dashboard roles, and curated operational metadata.</p>
            </div>
            <Button kind="secondary" onClick={runProbeCycle}>
              Run probes now
            </Button>
          </div>
          {error ? <InlineNotification kind="error" title="Admin load error" subtitle={error} hideCloseButton /> : null}
          {notice ? <InlineNotification kind={notice.kind} title={notice.title} subtitle={notice.subtitle} hideCloseButton /> : null}
        </section>
      </Column>

      <Column lg={16} md={8} sm={4}>
        <Tabs>
          <TabList aria-label="Admin sections">
            <Tab>Services</Tab>
            <Tab>Categories</Tab>
            <Tab>Users</Tab>
          </TabList>
          <TabPanels>
            <TabPanel>
              <Grid condensed fullWidth>
                <Column lg={5} md={8} sm={4}>
                  <Tile className="admin-panel">
                    <div className="section-heading">
                      <div>
                        <h2>Service records</h2>
                        <p>Catalog entries owned by the dashboard runtime.</p>
                      </div>
                      <Button kind="ghost" size="sm" onClick={() => {
                        setSelectedServiceId("");
                        setServiceForm(buildServiceFormState());
                      }}>
                        New service
                      </Button>
                    </div>
                    <div className="admin-list">
                      {services.map((service) => (
                        <button
                          key={service.id}
                          type="button"
                          className={`admin-list__item${selectedServiceId === service.id ? " admin-list__item--active" : ""}`}
                          onClick={() => {
                            setSelectedServiceId(service.id);
                            setServiceForm(buildServiceFormState(service));
                          }}>
                          <span>{service.name}</span>
                          <Tag type={service.archived ? "gray" : service.status?.state === "healthy" ? "green" : service.status?.state === "down" ? "red" : "warm-gray"}>
                            {service.archived ? "archived" : service.status?.state || "unknown"}
                          </Tag>
                        </button>
                      ))}
                    </div>
                  </Tile>
                </Column>

                <Column lg={11} md={8} sm={4}>
                  <Tile className="admin-panel">
                    <div className="section-heading">
                      <div>
                        <h2>{selectedServiceId ? `Edit ${selectedServiceId}` : "Create service"}</h2>
                        <p>Manage route metadata, tags, links, and retirement state.</p>
                      </div>
                      {selectedServiceId ? (
                        <Button kind="ghost" size="sm" onClick={() => toggleArchive(selectedServiceId, !serviceForm.archived)}>
                          {serviceForm.archived ? "Restore" : "Archive"}
                        </Button>
                      ) : null}
                    </div>
                    <Form onSubmit={saveService}>
                      <div className="admin-form-grid">
                        <TextInput id="service-id" labelText="Service ID" value={serviceForm.id} disabled={Boolean(selectedServiceId)} onChange={(event) => setServiceForm((current) => ({ ...current, id: event.target.value }))} />
                        <TextInput id="service-name" labelText="Display name" value={serviceForm.name} onChange={(event) => setServiceForm((current) => ({ ...current, name: event.target.value }))} />
                        <Select id="service-category" labelText="Category" value={serviceForm.categoryId} onChange={(event) => setServiceForm((current) => ({ ...current, categoryId: event.target.value }))}>
                          <SelectItem value="" text="Select category" />
                          {categories.map((category) => (
                            <SelectItem key={category.id} value={category.id} text={category.name} />
                          ))}
                        </Select>
                        <Select id="service-auth" labelText="Access model" value={serviceForm.authMode} onChange={(event) => setServiceForm((current) => ({ ...current, authMode: event.target.value }))}>
                          <SelectItem value="protected" text="Protected" />
                          <SelectItem value="direct" text="Direct" />
                        </Select>
                        <TextInput id="service-external" labelText="External URL" value={serviceForm.externalUrl} onChange={(event) => setServiceForm((current) => ({ ...current, externalUrl: event.target.value }))} />
                        <TextInput id="service-internal" labelText="Internal URL" value={serviceForm.internalUrl} onChange={(event) => setServiceForm((current) => ({ ...current, internalUrl: event.target.value }))} />
                        <TextInput id="service-probe" labelText="Probe URL" value={serviceForm.probeUrl} onChange={(event) => setServiceForm((current) => ({ ...current, probeUrl: event.target.value }))} />
                        <TextInput id="service-runbook" labelText="Runbook URL" value={serviceForm.runbookUrl} onChange={(event) => setServiceForm((current) => ({ ...current, runbookUrl: event.target.value }))} />
                        <TextInput id="service-icon" labelText="Icon token" value={serviceForm.icon} onChange={(event) => setServiceForm((current) => ({ ...current, icon: event.target.value }))} />
                        <TextInput id="service-order" labelText="Sort order" value={String(serviceForm.sortOrder)} onChange={(event) => setServiceForm((current) => ({ ...current, sortOrder: Number(event.target.value || 0) }))} />
                      </div>
                      <TextArea id="service-description" labelText="Description" rows={3} value={serviceForm.description} onChange={(event) => setServiceForm((current) => ({ ...current, description: event.target.value }))} />
                      <TextArea id="service-notes" labelText="Operational notes" rows={4} value={serviceForm.notes} onChange={(event) => setServiceForm((current) => ({ ...current, notes: event.target.value }))} />
                      <TextArea id="service-tags" labelText="Tags" helperText="Comma-separated tags" rows={2} value={serviceForm.tagsText} onChange={(event) => setServiceForm((current) => ({ ...current, tagsText: event.target.value }))} />
                      <TextArea id="service-links" labelText="Links" helperText="One per line: label|url|kind|primary" rows={4} value={serviceForm.linksText} onChange={(event) => setServiceForm((current) => ({ ...current, linksText: event.target.value }))} />
                      <div className="admin-form-flags">
                        <Checkbox id="service-featured" labelText="Featured service" checked={serviceForm.featured} onChange={(_, { checked }) => setServiceForm((current) => ({ ...current, featured: checked }))} />
                        <Checkbox id="service-archived" labelText="Archived" checked={serviceForm.archived} onChange={(_, { checked }) => setServiceForm((current) => ({ ...current, archived: checked }))} />
                      </div>
                      <div className="service-detail__actions">
                        <Button type="submit">Save service</Button>
                      </div>
                    </Form>
                  </Tile>
                </Column>
              </Grid>
            </TabPanel>

            <TabPanel>
              <Grid condensed fullWidth>
                <Column lg={6} md={8} sm={4}>
                  <Tile className="admin-panel">
                    <h2>Categories</h2>
                    <div className="admin-list">
                      {categories.map((category) => (
                        <button
                          key={category.id}
                          type="button"
                          className="admin-list__item"
                          onClick={() => setCategoryForm({
                            id: category.id,
                            name: category.name,
                            description: category.description,
                            sortOrder: category.sortOrder
                          })}>
                          <span>{category.name}</span>
                          <Tag type="blue">{category.serviceCount}</Tag>
                        </button>
                      ))}
                    </div>
                  </Tile>
                </Column>
                <Column lg={10} md={8} sm={4}>
                  <Tile className="admin-panel">
                    <h2>{categoryForm.id ? `Edit ${categoryForm.id}` : "Create category"}</h2>
                    <Form onSubmit={saveCategory}>
                      <div className="admin-form-grid">
                        <TextInput id="category-id" labelText="Category ID" value={categoryForm.id} disabled={Boolean(categoryForm.id)} onChange={(event) => setCategoryForm((current) => ({ ...current, id: event.target.value }))} />
                        <TextInput id="category-name" labelText="Display name" value={categoryForm.name} onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))} />
                        <TextInput id="category-order" labelText="Sort order" value={String(categoryForm.sortOrder)} onChange={(event) => setCategoryForm((current) => ({ ...current, sortOrder: Number(event.target.value || 0) }))} />
                      </div>
                      <TextArea id="category-description" labelText="Description" rows={4} value={categoryForm.description} onChange={(event) => setCategoryForm((current) => ({ ...current, description: event.target.value }))} />
                      <div className="service-detail__actions">
                        <Button type="submit">Save category</Button>
                        <Button kind="ghost" type="button" onClick={() => setCategoryForm({ id: "", name: "", description: "", sortOrder: 0 })}>
                          Reset
                        </Button>
                      </div>
                    </Form>
                  </Tile>
                </Column>
              </Grid>
            </TabPanel>

            <TabPanel>
              <Grid condensed fullWidth>
                <Column lg={16} md={8} sm={4}>
                  <Tile className="admin-panel">
                    <h2>Dashboard users</h2>
                    <p>Admin access is local to the dashboard but tied to the gateway identity headers.</p>
                    <div className="user-grid">
                      {users.map((user) => (
                        <div key={user.id} className="user-grid__item">
                          <div>
                            <h4>{user.displayName}</h4>
                            <p>{user.email}</p>
                            <small>{user.lastSeenAt}</small>
                          </div>
                          <Checkbox
                            id={`user-admin-${user.id}`}
                            labelText="Admin"
                            checked={Boolean(user.isAdmin)}
                            onChange={(_, { checked }) => setUserAdmin(user.id, checked)}
                          />
                        </div>
                      ))}
                    </div>
                  </Tile>
                </Column>
              </Grid>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </Column>
    </Grid>
  );
}

function Layout({ theme, setTheme, session, sessionLoading, sessionError, pins, onTogglePin, refreshNonce, onAdminChange }) {
  const [expanded, setExpanded] = useState(false);
  const location = useLocation();

  if (sessionLoading && !session) {
    return <Loading withOverlay={false} description="Loading session" />;
  }

  return (
    <div className="index-dashboard">
      <Theme theme={theme === "g100" ? "g90" : "g10"}>
        <Header aria-label="Home Lab Operations Dashboard">
          <SkipToContent />
          <HeaderMenuButton
            aria-label="Open navigation menu"
            isActive={expanded}
            onClick={() => setExpanded((current) => !current)}
          />
          <HeaderName href="/" prefix="Home">
            Lab Ops
          </HeaderName>
          <HeaderNavigation aria-label="Primary sections">
            <HeaderMenuItem href="/" isCurrentPage={location.pathname === "/"}>
              Overview
            </HeaderMenuItem>
            <HeaderMenuItem href="/topology" isCurrentPage={pathMatches(location.pathname, "/topology")}>
              Topology
            </HeaderMenuItem>
            <HeaderMenuItem href="/services" isCurrentPage={pathMatches(location.pathname, "/services")}>
              Directory
            </HeaderMenuItem>
            <HeaderMenuItem href="/admin" isCurrentPage={pathMatches(location.pathname, "/admin")}>
              Admin
            </HeaderMenuItem>
          </HeaderNavigation>
          <div className="index-dashboard__header-actions">
            {session?.viewer ? <Tag type="blue">{session.viewer.displayName}</Tag> : null}
            {import.meta.env.VITE_AUTH_GATEWAY_URL ? (
              <Button as="a" href={import.meta.env.VITE_AUTH_GATEWAY_URL} kind="ghost" size="sm">
                Gateway
              </Button>
            ) : null}
            {session?.logoutUrl ? (
              <Button as="a" href={session.logoutUrl} kind="ghost" size="sm">
                Log out
              </Button>
            ) : null}
            <Toggle
              id="theme-toggle"
              labelText="Theme"
              hideLabel
              labelA="Dark"
              labelB="Light"
              toggled={theme === "white"}
              onToggle={(value) => setTheme(value ? "white" : "g100")}
            />
          </div>
          <SideNav aria-label="Side navigation" expanded={expanded} isPersistent={false}>
            <SideNavItems>
              <SideNavLink href="/">Overview</SideNavLink>
              <SideNavLink href="/topology">Topology</SideNavLink>
              <SideNavLink href="/services">Directory</SideNavLink>
              <SideNavLink href="/admin">Admin</SideNavLink>
              {import.meta.env.VITE_AUTH_GATEWAY_URL ? <SideNavLink href={import.meta.env.VITE_AUTH_GATEWAY_URL}>Auth gateway</SideNavLink> : null}
            </SideNavItems>
          </SideNav>
        </Header>
      </Theme>

      <Content id="main-content" className="index-dashboard__content">
        {sessionError ? (
          <Grid condensed fullWidth className="index-dashboard__grid">
            <Column lg={16} md={8} sm={4}>
              <InlineNotification kind="error" title="Session error" subtitle={sessionError} hideCloseButton />
            </Column>
          </Grid>
        ) : null}
        <Routes>
          <Route path="/" element={<OverviewPage pins={pins} onTogglePin={onTogglePin} refreshNonce={refreshNonce} />} />
          <Route path="/topology" element={<TopologyPage refreshNonce={refreshNonce} />} />
          <Route path="/services" element={<DirectoryPage pins={pins} onTogglePin={onTogglePin} refreshNonce={refreshNonce} />} />
          <Route path="/services/:serviceId" element={<ServiceDetailPage pins={pins} onTogglePin={onTogglePin} refreshNonce={refreshNonce} />} />
          <Route path="/admin" element={<AdminPage refreshNonce={refreshNonce} onAdminChange={onAdminChange} />} />
          <Route
            path="*"
            element={
              <Grid condensed fullWidth className="index-dashboard__grid">
                <Column lg={16} md={8} sm={4}>
                  <Tile className="status-tile">
                    <h3>Page not found</h3>
                    <p>The requested dashboard route does not exist.</p>
                    <Button as="a" href="/" kind="primary">
                      Return to overview
                    </Button>
                  </Tile>
                </Column>
              </Grid>
            }
          />
        </Routes>
      </Content>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState(() => readLocalStorage(THEME_KEY, "g100"));
  const [pins, setPins] = useState([]);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState("");
  const [session, setSession] = useState(null);

  useEffect(() => {
    window.localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    async function loadSession() {
      try {
        setSessionError("");
        const payload = await api.getSession();
        if (!cancelled) {
          setSession(payload);
          setPins(payload.pins || []);
        }
      } catch (error) {
        if (!cancelled) {
          setSessionError(error.message);
        }
      } finally {
        if (!cancelled) {
          setSessionLoading(false);
        }
      }
    }
    loadSession();
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  async function togglePin(serviceId) {
    const nextPins = pins.includes(serviceId)
      ? pins.filter((item) => item !== serviceId)
      : [...pins, serviceId];
    setPins(nextPins);
    try {
      const payload = await api.updatePins(nextPins);
      setPins(payload.pins || []);
    } catch (_error) {
      setPins(pins);
    }
  }

  function bumpRefresh() {
    setRefreshNonce((current) => current + 1);
  }

  return (
    <GlobalTheme theme={theme}>
      <Layout
        theme={theme}
        setTheme={setTheme}
        session={session}
        sessionLoading={sessionLoading}
        sessionError={sessionError}
        pins={pins}
        onTogglePin={togglePin}
        refreshNonce={refreshNonce}
        onAdminChange={bumpRefresh}
      />
    </GlobalTheme>
  );
}
