import React from "react";
import { Button, Tag, Tile } from "@carbon/react";

function statusType(state) {
  if (state === "healthy") {
    return "green";
  }
  if (state === "degraded") {
    return "warm-gray";
  }
  if (state === "down") {
    return "red";
  }
  return "gray";
}

export default function ServiceCard({ service, pinned, onTogglePinned, compact = false }) {
  const links = service.links || [];
  const primaryLink = links.find((link) => link.isPrimary) || links[0] || null;

  return (
    <Tile className={`service-card${compact ? " service-card--compact" : ""}`}>
      <div className="service-card__header">
        <div>
          <h4>{service.name}</h4>
          <p>{service.description}</p>
        </div>
        <Tag type={statusType(service.status?.state)}>{service.status?.state || "unknown"}</Tag>
      </div>
      <div className="service-card__meta">
        <Tag type="blue">{service.authMode}</Tag>
        {(service.tags || []).slice(0, compact ? 2 : 4).map((tag) => (
          <Tag key={tag} type="gray">
            {tag}
          </Tag>
        ))}
      </div>
      <div className="service-card__details">
        <span>{service.category?.name}</span>
        <span>
          {service.status?.responseTimeMs ? `${service.status.responseTimeMs} ms` : "No recent probe"}
        </span>
      </div>
      <div className="service-card__actions">
        {primaryLink ? (
          <Button as="a" href={primaryLink.url} target="_blank" rel="noreferrer" kind="primary" size="sm">
            Open service
          </Button>
        ) : null}
        <Button as="a" href={`/services/${service.id}`} kind="secondary" size="sm">
          View details
        </Button>
        {onTogglePinned ? (
          <Button kind="ghost" size="sm" onClick={() => onTogglePinned(service.id)}>
            {pinned ? "Unpin" : "Pin"}
          </Button>
        ) : null}
      </div>
    </Tile>
  );
}
