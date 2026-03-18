import React from "react";
import { Button, Tag, Tile } from "@carbon/react";
import { formatTimestamp } from "./TopologyGraph";

export default function TopologySummaryCard({ topology, loading, error }) {
  const summary = topology?.summary || {};

  return (
    <Tile className="topology-summary-card">
      <div className="topology-summary-card__header">
        <div>
          <h2>Network graph</h2>
          <p>Open the full canvas view to inspect service links, attached networks, and simulated traffic flow.</p>
        </div>
        <Button as="a" href="/topology" kind="primary">
          Open full graph
        </Button>
      </div>

      <div className="topology-summary-card__stats">
        <Tag type="blue">{summary.mappedServices || 0}/{summary.catalogServices || 0} mapped</Tag>
        <Tag type="green">{summary.runningServices || 0} running</Tag>
        <Tag type="purple">{summary.networkCount || 0} networks</Tag>
        <Tag type="cool-gray">Updated {formatTimestamp(topology?.generatedAt)}</Tag>
      </div>

      {error ? <div className="topology-panel__notice topology-panel__notice--error">{error}</div> : null}
      {topology?.warning ? <div className="topology-panel__notice topology-panel__notice--warning">{topology.warning}</div> : null}

      <div className="topology-summary-card__body">
        <div className="topology-summary-card__signal">
          <span className="topology-summary-card__signal-dot topology-summary-card__signal-dot--healthy" />
          <div>
            <strong>Healthy traffic</strong>
            <p>Animated blue traffic on running, healthy services.</p>
          </div>
        </div>
        <div className="topology-summary-card__signal">
          <span className="topology-summary-card__signal-dot topology-summary-card__signal-dot--degraded" />
          <div>
            <strong>Degraded traffic</strong>
            <p>Amber intermittent flow on warning or degraded nodes.</p>
          </div>
        </div>
        <div className="topology-summary-card__signal">
          <span className="topology-summary-card__signal-dot topology-summary-card__signal-dot--down" />
          <div>
            <strong>Down links</strong>
            <p>Muted or stopped traffic when services are missing or down.</p>
          </div>
        </div>
      </div>

      {loading ? <p className="topology-summary-card__footnote">Refreshing topology snapshot…</p> : null}
    </Tile>
  );
}
