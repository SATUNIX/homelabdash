import React from "react";
import { Tile } from "@carbon/react";

export default function MetricTile({ label, value, helper }) {
  return (
    <Tile className="metric-tile">
      <div className="metric-tile__label">{label}</div>
      <div className="metric-tile__value">{value}</div>
      <div className="metric-tile__helper">{helper}</div>
    </Tile>
  );
}
