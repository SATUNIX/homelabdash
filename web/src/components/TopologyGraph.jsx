import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, InlineLoading, Tag, Tile } from "@carbon/react";
import { useNavigate } from "react-router-dom";

const CATEGORY_COLUMNS = 2;
const CATEGORY_WIDTH = 456;
const CATEGORY_GAP = 32;
const CATEGORY_PADDING = 24;
const SERVICE_NODE_WIDTH = 392;
const SERVICE_NODE_HEIGHT = 148;
const SERVICE_NODE_GAP = 20;
const NETWORK_NODE_WIDTH = 196;
const NETWORK_NODE_HEIGHT = 84;
const NETWORK_LANE_WIDTH = 248;
const NETWORK_COLUMN_GAP = 24;
const SCENE_PADDING = 48;
const GRID_SIZE = 40;
const SCENE_MIN_HEIGHT = 820;

function formatTimestamp(value) {
  if (!value) {
    return "Unknown";
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(timestamp);
}

function runtimeTagType(node) {
  if (node.runtimeTone === "positive") {
    return "green";
  }
  if (node.runtimeTone === "critical") {
    return "red";
  }
  if (node.runtimeTone === "warning") {
    return "warm-gray";
  }
  return "gray";
}

function probeTagType(state) {
  if (state === "healthy") {
    return "green";
  }
  if (state === "down") {
    return "red";
  }
  if (state === "degraded") {
    return "warm-gray";
  }
  return "gray";
}

function networkTagType(role) {
  if (role === "host") {
    return "red";
  }
  if (role === "private") {
    return "purple";
  }
  return "blue";
}

function buildFlowProfile(service) {
  const runtimeState = (service.runtimeState || "").toLowerCase();
  const probeState = (service.probeState || "").toLowerCase();

  if (runtimeState === "running" && probeState === "healthy") {
    return {
      linkColor: "rgba(69, 137, 255, 0.58)",
      linkHighlight: "rgba(69, 137, 255, 0.96)",
      pulseColor: "rgba(120, 169, 255, 0.98)",
      active: true,
      speed: 0.18,
      pulses: 3,
      width: 2.2,
      emphasis: "healthy"
    };
  }

  if (runtimeState === "running" && (probeState === "degraded" || service.runtimeTone === "warning")) {
    return {
      linkColor: "rgba(241, 194, 27, 0.54)",
      linkHighlight: "rgba(252, 220, 128, 0.94)",
      pulseColor: "rgba(255, 214, 74, 0.95)",
      active: true,
      speed: 0.1,
      pulses: 2,
      width: 2,
      emphasis: "degraded"
    };
  }

  if (probeState === "down" || runtimeState === "exited" || runtimeState === "dead" || runtimeState === "missing") {
    return {
      linkColor: "rgba(218, 30, 40, 0.38)",
      linkHighlight: "rgba(255, 131, 137, 0.68)",
      pulseColor: "rgba(255, 131, 137, 0.55)",
      active: false,
      speed: 0,
      pulses: 0,
      width: 1.8,
      emphasis: "down"
    };
  }

  return {
    linkColor: "rgba(142, 152, 160, 0.34)",
    linkHighlight: "rgba(196, 207, 214, 0.62)",
    pulseColor: "rgba(196, 207, 214, 0.72)",
    active: runtimeState === "running",
    speed: 0.08,
    pulses: 1,
    width: 1.7,
    emphasis: "idle"
  };
}

function networkPriority(role) {
  if (role === "shared") {
    return 0;
  }
  if (role === "host") {
    return 1;
  }
  return 2;
}

function buildLayout(topology, showPrivateNetworks) {
  const allServices = (topology?.nodes || [])
    .filter((node) => node.kind === "service")
    .sort((left, right) => {
      const categoryCompare = left.categoryName.localeCompare(right.categoryName);
      if (categoryCompare !== 0) {
        return categoryCompare;
      }
      return left.label.localeCompare(right.label);
    });

  const networkNodes = (topology?.nodes || [])
    .filter((node) => node.kind === "network")
    .filter((node) => showPrivateNetworks || !node.isPrivate)
    .sort((left, right) => {
      const priorityCompare = networkPriority(left.role) - networkPriority(right.role);
      if (priorityCompare !== 0) {
        return priorityCompare;
      }
      return left.label.localeCompare(right.label);
    });

  const visibleNetworkIds = new Set(networkNodes.map((node) => node.id));
  const services = allServices.filter((service) => {
    if (!service.networks?.length) {
      return true;
    }
    return service.networks.some((networkName) => visibleNetworkIds.has(`network:${networkName}`));
  });

  const categories = [];
  const categoryMap = new Map();

  services.forEach((service) => {
    const categoryName = service.categoryName || "Uncategorized";
    if (!categoryMap.has(categoryName)) {
      const nextCategory = { name: categoryName, services: [] };
      categoryMap.set(categoryName, nextCategory);
      categories.push(nextCategory);
    }
    categoryMap.get(categoryName).services.push(service);
  });

  const serviceLayouts = new Map();
  const categoryLayouts = [];
  const rowHeights = [];
  const columnCount = Math.max(1, Math.min(CATEGORY_COLUMNS, categories.length || 1));

  categories.forEach((category, index) => {
    const rowIndex = Math.floor(index / columnCount);
    const height =
      72 + CATEGORY_PADDING * 2 + category.services.length * SERVICE_NODE_HEIGHT + Math.max(0, category.services.length - 1) * SERVICE_NODE_GAP;
    rowHeights[rowIndex] = Math.max(rowHeights[rowIndex] || 0, height);
  });

  const rowOffsets = [];
  rowHeights.reduce((offset, height, index) => {
    rowOffsets[index] = offset;
    return offset + height + CATEGORY_GAP;
  }, 0);

  categories.forEach((category, index) => {
    const columnIndex = index % columnCount;
    const rowIndex = Math.floor(index / columnCount);
    const x = SCENE_PADDING + NETWORK_LANE_WIDTH + columnIndex * (CATEGORY_WIDTH + CATEGORY_GAP);
    const y = SCENE_PADDING + (rowOffsets[rowIndex] || 0);
    const height =
      72 + CATEGORY_PADDING * 2 + category.services.length * SERVICE_NODE_HEIGHT + Math.max(0, category.services.length - 1) * SERVICE_NODE_GAP;

    categoryLayouts.push({
      id: `category:${category.name}`,
      name: category.name,
      x,
      y,
      width: CATEGORY_WIDTH,
      height
    });

    category.services.forEach((service, serviceIndex) => {
      serviceLayouts.set(service.id, {
        x: x + CATEGORY_PADDING,
        y: y + 72 + CATEGORY_PADDING + serviceIndex * (SERVICE_NODE_HEIGHT + SERVICE_NODE_GAP),
        width: SERVICE_NODE_WIDTH,
        height: SERVICE_NODE_HEIGHT
      });
    });
  });

  const sceneHeight = Math.max(
    SCENE_MIN_HEIGHT,
    SCENE_PADDING * 2 +
      (rowHeights.reduce((sum, height) => sum + height, 0) || 0) +
      Math.max(0, rowHeights.length - 1) * CATEGORY_GAP
  );
  const sceneWidth =
    SCENE_PADDING * 2 + NETWORK_LANE_WIDTH + columnCount * CATEGORY_WIDTH + Math.max(0, columnCount - 1) * CATEGORY_GAP;

  const networkLayouts = new Map();
  const edges = [];
  const networkCenters = [];

  networkNodes.forEach((network) => {
    const connectedServices = services
      .filter((service) => service.networks?.includes(network.name))
      .map((service) => serviceLayouts.get(service.id))
      .filter(Boolean);
    const averageCenter =
      connectedServices.reduce((sum, layout) => sum + layout.y + layout.height / 2, 0) /
        Math.max(connectedServices.length, 1) || sceneHeight / 2;

    networkCenters.push({
      network,
      centerY: averageCenter
    });
  });

  networkCenters.sort((left, right) => left.centerY - right.centerY);
  const networkColumns = Math.max(1, Math.min(2, Math.ceil(networkCenters.length / 8)));
  const networkRows = Math.max(1, Math.ceil(networkCenters.length / networkColumns));
  const networkColumnWidth = NETWORK_NODE_WIDTH + NETWORK_COLUMN_GAP;
  const maxLaneWidth = Math.max(NETWORK_NODE_WIDTH, networkColumns * networkColumnWidth - NETWORK_COLUMN_GAP);
  const networkStartX = SCENE_PADDING + Math.max(0, NETWORK_LANE_WIDTH - maxLaneWidth) / 2;
  const laneHeight = sceneHeight - SCENE_PADDING * 2;

  networkCenters.forEach((entry, index) => {
    const columnIndex = Math.floor(index / networkRows);
    const rowIndex = index % networkRows;
    const x = networkStartX + columnIndex * networkColumnWidth;
    const distributedCenter = SCENE_PADDING + (laneHeight * (rowIndex + 0.5)) / networkRows;
    const centerY = Math.max(
      SCENE_PADDING + NETWORK_NODE_HEIGHT / 2,
      Math.min(sceneHeight - SCENE_PADDING - NETWORK_NODE_HEIGHT / 2, (distributedCenter + entry.centerY) / 2)
    );

    networkLayouts.set(entry.network.id, {
      x,
      y: centerY - NETWORK_NODE_HEIGHT / 2,
      width: NETWORK_NODE_WIDTH,
      height: NETWORK_NODE_HEIGHT
    });
  });

  services.forEach((service) => {
    const sourceLayout = serviceLayouts.get(service.id);
    if (!sourceLayout) {
      return;
    }

    (service.networks || []).forEach((networkName) => {
      const networkId = `network:${networkName}`;
      if (!visibleNetworkIds.has(networkId)) {
        return;
      }

      const targetLayout = networkLayouts.get(networkId);
      if (!targetLayout) {
        return;
      }

      const start = {
        x: targetLayout.x + targetLayout.width,
        y: targetLayout.y + targetLayout.height / 2
      };
      const end = {
        x: sourceLayout.x,
        y: sourceLayout.y + sourceLayout.height / 2
      };
      const control = {
        x1: start.x + Math.max(90, (end.x - start.x) * 0.42),
        y1: start.y,
        x2: end.x - 68,
        y2: end.y
      };

      edges.push({
        id: `${service.id}:${networkId}`,
        serviceId: service.id,
        networkId,
        start,
        end,
        control,
        flow: buildFlowProfile(service)
      });
    });
  });

  return {
    sceneWidth,
    sceneHeight,
    services,
    networkNodes,
    categoryLayouts,
    serviceLayouts,
    networkLayouts,
    edges
  };
}

function cubicPoint(edge, t) {
  const oneMinusT = 1 - t;
  return {
    x:
      oneMinusT ** 3 * edge.start.x +
      3 * oneMinusT ** 2 * t * edge.control.x1 +
      3 * oneMinusT * t ** 2 * edge.control.x2 +
      t ** 3 * edge.end.x,
    y:
      oneMinusT ** 3 * edge.start.y +
      3 * oneMinusT ** 2 * t * edge.control.y1 +
      3 * oneMinusT * t ** 2 * edge.control.y2 +
      t ** 3 * edge.end.y
  };
}

function drawRoundedRectPath(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function drawGrid(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = "rgba(120, 135, 147, 0.12)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += GRID_SIZE) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += GRID_SIZE) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEdge(ctx, edge, isActive, isMuted) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(edge.start.x, edge.start.y);
  ctx.bezierCurveTo(edge.control.x1, edge.control.y1, edge.control.x2, edge.control.y2, edge.end.x, edge.end.y);
  ctx.strokeStyle = isActive ? edge.flow.linkHighlight : edge.flow.linkColor;
  ctx.lineWidth = isActive ? edge.flow.width + 0.75 : edge.flow.width;
  ctx.globalAlpha = isMuted ? 0.18 : isActive ? 1 : 0.78;
  ctx.shadowBlur = isActive ? 14 : 0;
  ctx.shadowColor = isActive ? edge.flow.pulseColor : "transparent";
  ctx.stroke();
  ctx.restore();
}

function drawPulse(ctx, edge, timeSeconds, pulseIndex, isActive, isMuted) {
  if (!edge.flow.active || !edge.flow.pulses) {
    return;
  }

  const pulseSpeed = edge.flow.speed;
  const offset = pulseIndex / edge.flow.pulses;
  const progress = (timeSeconds * pulseSpeed + offset) % 1;
  const point = cubicPoint(edge, progress);
  const radius = isActive ? 6.5 : 5;
  const alpha = isMuted ? 0.1 : isActive ? 0.95 : 0.68;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = edge.flow.pulseColor;
  ctx.shadowBlur = isActive ? 18 : 12;
  ctx.shadowColor = edge.flow.pulseColor;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCanvasScene(canvas, layout, activeServiceId, selectedServiceId) {
  if (!canvas) {
    return () => {};
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return () => {};
  }

  let frameId = 0;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.round(layout.sceneWidth * dpr);
  canvas.height = Math.round(layout.sceneHeight * dpr);
  canvas.style.width = `${layout.sceneWidth}px`;
  canvas.style.height = `${layout.sceneHeight}px`;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  function paint(now) {
    context.clearRect(0, 0, layout.sceneWidth, layout.sceneHeight);

    const gradient = context.createLinearGradient(0, 0, 0, layout.sceneHeight);
    gradient.addColorStop(0, "rgba(15, 98, 254, 0.08)");
    gradient.addColorStop(1, "rgba(38, 38, 38, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, layout.sceneWidth, layout.sceneHeight);

    drawGrid(context, layout.sceneWidth, layout.sceneHeight);

    layout.categoryLayouts.forEach((category) => {
      context.save();
      drawRoundedRectPath(context, category.x, category.y, category.width, category.height, 22);
      context.fillStyle = "rgba(22, 22, 22, 0.04)";
      context.fill();
      context.strokeStyle = "rgba(120, 135, 147, 0.16)";
      context.lineWidth = 1;
      context.stroke();
      context.restore();
    });

    const timeSeconds = now / 1000;
    layout.edges.forEach((edge) => {
      const isActive = Boolean(activeServiceId) && edge.serviceId === activeServiceId;
      const isMuted = Boolean(activeServiceId) && edge.serviceId !== activeServiceId;
      drawEdge(context, edge, isActive || edge.serviceId === selectedServiceId, isMuted);
    });

    layout.edges.forEach((edge) => {
      const isActive = Boolean(activeServiceId) && edge.serviceId === activeServiceId;
      const isMuted = Boolean(activeServiceId) && edge.serviceId !== activeServiceId;
      for (let pulseIndex = 0; pulseIndex < edge.flow.pulses; pulseIndex += 1) {
        drawPulse(context, edge, timeSeconds, pulseIndex, isActive || edge.serviceId === selectedServiceId, isMuted);
      }
    });

    frameId = window.requestAnimationFrame(paint);
  }

  frameId = window.requestAnimationFrame(paint);
  return () => window.cancelAnimationFrame(frameId);
}

function Inspector({ selectedService, topology }) {
  if (!selectedService) {
    return (
      <Tile className="topology-inspector">
        <h3>Topology summary</h3>
        <p>Select a service node to inspect its runtime, ports, and network attachment.</p>
        <div className="topology-inspector__stats">
          <span>{topology?.summary?.mappedServices || 0} mapped</span>
          <span>{topology?.summary?.runningServices || 0} running</span>
          <span>{topology?.summary?.networkCount || 0} networks</span>
        </div>
      </Tile>
    );
  }

  return (
    <Tile className="topology-inspector">
      <div className="topology-inspector__header">
        <div>
          <h3>{selectedService.label}</h3>
          <p>{selectedService.containerName || "No runtime container mapped"}</p>
        </div>
        <Tag type={runtimeTagType(selectedService)}>{selectedService.runtimeState}</Tag>
      </div>
      <div className="topology-inspector__tags">
        <Tag type="blue">{selectedService.categoryName}</Tag>
        <Tag type={selectedService.authMode === "protected" ? "teal" : "cyan"}>{selectedService.authMode}</Tag>
        <Tag type={probeTagType(selectedService.probeState)}>probe {selectedService.probeState}</Tag>
      </div>
      <div className="topology-inspector__meta">
        <div>
          <span>Runtime</span>
          <strong>{selectedService.runtimeStatusText}</strong>
        </div>
        <div>
          <span>Compose</span>
          <strong>
            {selectedService.composeProject || "unmanaged"}
            {selectedService.composeService ? ` / ${selectedService.composeService}` : ""}
          </strong>
        </div>
        <div>
          <span>Networks</span>
          <strong>{selectedService.networks?.join(", ") || "No attached networks"}</strong>
        </div>
      </div>
      <div className="topology-inspector__ports">
        <h4>Ports</h4>
        {(selectedService.ports || []).length ? (
          <div className="topology-inspector__port-list">
            {selectedService.ports.map((port) => (
              <Tag key={`${selectedService.id}-${port.label}`} type={port.published ? "green" : "gray"}>
                {port.label}
              </Tag>
            ))}
          </div>
        ) : (
          <p>No Docker-reported ports.</p>
        )}
      </div>
      <div className="topology-inspector__links">
        {selectedService.externalUrl ? (
          <Button as="a" href={selectedService.externalUrl} target="_blank" rel="noreferrer" size="sm">
            Open external route
          </Button>
        ) : null}
        {selectedService.internalUrl ? (
          <Button as="a" href={selectedService.internalUrl} target="_blank" rel="noreferrer" kind="secondary" size="sm">
            Open internal route
          </Button>
        ) : null}
      </div>
    </Tile>
  );
}

export { formatTimestamp };

export default function TopologyGraph({ topology, loading, error }) {
  const navigate = useNavigate();
  const scrollRef = useRef(null);
  const canvasRef = useRef(null);
  const [showPrivateNetworks, setShowPrivateNetworks] = useState(true);
  const [showPortLabels, setShowPortLabels] = useState(true);
  const [zoom, setZoom] = useState(1.08);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [hoveredServiceId, setHoveredServiceId] = useState("");

  const layout = useMemo(() => buildLayout(topology, showPrivateNetworks), [topology, showPrivateNetworks]);
  const selectedService =
    layout.services.find((service) => service.id === selectedServiceId) ||
    layout.services[0] ||
    null;
  const activeServiceId = hoveredServiceId || selectedService?.id || "";

  useEffect(() => {
    if (!layout.services.length) {
      setSelectedServiceId("");
      return;
    }
    if (!layout.services.some((service) => service.id === selectedServiceId)) {
      setSelectedServiceId(layout.services[0].id);
    }
  }, [layout.services, selectedServiceId]);

  useEffect(() => drawCanvasScene(canvasRef.current, layout, activeServiceId, selectedService?.id || ""), [layout, activeServiceId, selectedService?.id]);

  function resetView() {
    setZoom(1.08);
    const element = scrollRef.current;
    if (element) {
      element.scrollTo({ left: 0, top: 0, behavior: "smooth" });
    }
  }

  function selectService(service) {
    if (selectedServiceId === service.id) {
      navigate(`/services/${service.serviceId}`);
      return;
    }
    setSelectedServiceId(service.id);
  }

  if (loading && !topology) {
    return (
      <Tile className="topology-panel topology-panel--loading">
        <InlineLoading description="Loading topology" />
      </Tile>
    );
  }

  if (!layout.services.length && !layout.networkNodes.length) {
    return (
      <Tile className="topology-panel">
        <div className="topology-panel__header">
          <div>
            <h2>Service topology</h2>
            <p>Live Docker-backed graph for catalog services, ports, and network attachment.</p>
          </div>
          <Tag type="cool-gray">Updated {formatTimestamp(topology?.generatedAt)}</Tag>
        </div>
        {error ? <div className="topology-panel__notice topology-panel__notice--error">{error}</div> : null}
        {topology?.warning ? <div className="topology-panel__notice topology-panel__notice--warning">{topology.warning}</div> : null}
        <p>No topology data is available yet.</p>
      </Tile>
    );
  }

  return (
    <div className="topology-panel topology-panel--page">
      <div className="topology-panel__header">
        <div>
          <h2>Service topology</h2>
          <p>Canvas-rendered network map with runtime-aware traffic flow and service-to-network links.</p>
        </div>
        <div className="topology-panel__summary">
          <Tag type="blue">{topology?.summary?.mappedServices || 0}/{topology?.summary?.catalogServices || 0} mapped</Tag>
          <Tag type="green">{topology?.summary?.runningServices || 0} running</Tag>
          <Tag type="purple">{topology?.summary?.networkCount || 0} networks</Tag>
          <Tag type="cool-gray">Updated {formatTimestamp(topology?.generatedAt)}</Tag>
        </div>
      </div>

      {error ? <div className="topology-panel__notice topology-panel__notice--error">{error}</div> : null}
      {topology?.warning ? <div className="topology-panel__notice topology-panel__notice--warning">{topology.warning}</div> : null}

      <div className="topology-toolbar">
        <div className="topology-toolbar__controls">
          {selectedService ? <Tag type="cyan">Selected {selectedService.label}</Tag> : null}
          <Button kind="ghost" size="sm" onClick={() => setShowPrivateNetworks((current) => !current)}>
            {showPrivateNetworks ? "Hide private networks" : "Show private networks"}
          </Button>
          <Button kind="ghost" size="sm" onClick={() => setShowPortLabels((current) => !current)}>
            {showPortLabels ? "Hide port labels" : "Show port labels"}
          </Button>
          <Button kind="ghost" size="sm" onClick={() => setZoom((current) => Math.max(0.8, Number((current - 0.08).toFixed(2))))}>
            Zoom out
          </Button>
          <Button kind="ghost" size="sm" onClick={() => setZoom((current) => Math.min(1.8, Number((current + 0.08).toFixed(2))))}>
            Zoom in
          </Button>
          <Button kind="ghost" size="sm" onClick={resetView}>
            Reset view
          </Button>
        </div>
        <div className="topology-toolbar__legend">
          <span><i className="topology-legend topology-legend--positive" /> healthy flow</span>
          <span><i className="topology-legend topology-legend--warning" /> degraded flow</span>
          <span><i className="topology-legend topology-legend--critical" /> stopped / down</span>
        </div>
      </div>

      <div className="topology-panel__body">
        <Tile className="topology-canvas">
          <div className="topology-canvas__scroller" ref={scrollRef}>
            <div
              className="topology-canvas__viewport"
              style={{
                width: `${layout.sceneWidth * zoom}px`,
                height: `${layout.sceneHeight * zoom}px`
              }}>
              <div
                className="topology-canvas__scene"
                style={{
                  width: `${layout.sceneWidth}px`,
                  height: `${layout.sceneHeight}px`,
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left"
                }}>
                <canvas ref={canvasRef} className="topology-canvas__surface" aria-hidden="true" />

                {layout.categoryLayouts.map((category) => (
                  <div
                    key={category.id}
                    className="topology-category"
                    style={{
                      left: `${category.x}px`,
                      top: `${category.y}px`,
                      width: `${category.width}px`,
                      height: `${category.height}px`
                    }}>
                    <h3>{category.name}</h3>
                    <p>{category.height > 420 ? "High-density service lane" : "Service lane"}</p>
                  </div>
                ))}

                {layout.networkNodes.map((network) => {
                  const box = layout.networkLayouts.get(network.id);
                  if (!box) {
                    return null;
                  }

                  return (
                    <div
                      key={network.id}
                      className={`topology-node topology-node--network topology-node--network-${network.role}`}
                      style={{
                        left: `${box.x}px`,
                        top: `${box.y}px`,
                        width: `${box.width}px`,
                        height: `${box.height}px`
                      }}>
                      <small className="topology-node__eyebrow">{network.role}</small>
                      <span>{network.label}</span>
                      <div className="topology-node__footer">
                        <Tag type={networkTagType(network.role)}>{network.driver}</Tag>
                        <small>{network.serviceCount} services</small>
                      </div>
                    </div>
                  );
                })}

                {layout.services.map((service) => {
                  const box = layout.serviceLayouts.get(service.id);
                  if (!box) {
                    return null;
                  }

                  return (
                    <button
                      key={service.id}
                      type="button"
                      className={`topology-node topology-node--service${selectedService?.id === service.id ? " topology-node--selected" : ""}`}
                      style={{
                        left: `${box.x}px`,
                        top: `${box.y}px`,
                        width: `${box.width}px`,
                        height: `${box.height}px`
                      }}
                      title={selectedService?.id === service.id ? "Open service details" : "Select service"}
                      onClick={() => selectService(service)}
                      onMouseEnter={() => setHoveredServiceId(service.id)}
                      onMouseLeave={() => setHoveredServiceId("")}>
                      <div className="topology-node__header">
                        <div>
                          <strong>{service.label}</strong>
                          <small className="topology-node__eyebrow">{service.composeProject || "unmanaged runtime"}</small>
                        </div>
                        <Tag type={runtimeTagType(service)}>{service.runtimeState}</Tag>
                      </div>
                      <div className="topology-node__meta">
                        <span>{service.networks?.join(", ") || "no network"}</span>
                        <span>{service.composeService || service.categoryName}</span>
                      </div>
                      <div className="topology-node__footer">
                        <div className="topology-node__footer-tags">
                          <Tag type={service.authMode === "protected" ? "teal" : "cyan"}>{service.authMode}</Tag>
                          <Tag type={probeTagType(service.probeState)}>probe {service.probeState}</Tag>
                        </div>
                        {showPortLabels ? (
                          <div className="topology-node__port-list">
                            {(service.ports || []).slice(0, 3).map((port) => (
                              <small key={`${service.id}-${port.label}`} className={port.published ? "is-published" : ""}>
                                {port.label}
                              </small>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Tile>

        <Inspector selectedService={selectedService} topology={topology} />
      </div>
    </div>
  );
}
