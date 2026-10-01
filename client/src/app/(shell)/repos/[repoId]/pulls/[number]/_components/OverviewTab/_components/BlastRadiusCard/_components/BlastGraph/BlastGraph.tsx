import React from "react";
import { useTranslations } from "next-intl";
import type { DownstreamImpact } from "@devdigest/shared";
import { GRAPH_WIDTH, layoutBlastGraph } from "./helpers";
import { LEGEND_COLORS, NODE_STYLES, s } from "./styles";

export interface BlastGraphProps {
  downstream: readonly DownstreamImpact[];
}

const LEGEND = ["symbol", "caller", "endpoint", "cron"] as const;

/** Pure-SVG blast radius: changed symbols -> callers, and changed symbols -> endpoints/crons. */
export function BlastGraph({ downstream }: BlastGraphProps) {
  const t = useTranslations("blast");
  const { nodes, edges, height } = layoutBlastGraph(downstream);

  const hasCron = nodes.some((n) => n.kind === "cron");

  if (nodes.length === 0) return <span style={s.empty}>{t("graph.empty")}</span>;

  return (
    <div style={s.root}>
      <svg
        role="img"
        aria-label={t("graph.ariaLabel")}
        viewBox={`0 0 ${GRAPH_WIDTH} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={s.svg}
      >
        <g>
          {edges.map((e) => (
            <path key={e.id} d={e.path} style={s.edge} />
          ))}
        </g>
        {nodes.map((n) => {
          const look = NODE_STYLES[n.kind];
          const tooltip = n.kind === "more" ? t("graph.more", { count: n.hidden ?? 0 }) : n.full;
          return (
            <g key={n.id}>
              <title>{tooltip}</title>
              <rect x={n.x} y={n.y} width={n.width} height={n.height} rx={6} style={look.box} />
              <text
                className="mono"
                x={n.x + n.width / 2}
                y={n.y + n.height / 2}
                style={{ ...s.text, ...look.text }}
              >
                {n.kind === "more" ? t("graph.more", { count: n.hidden ?? 0 }) : n.label}
              </text>
            </g>
          );
        })}
      </svg>
      <ul style={s.legend}>
        {LEGEND.filter((k) => k !== "cron" || hasCron).map((k) => (
          <li key={k} style={s.legendItem}>
            <span aria-hidden="true" style={{ ...s.dot, background: LEGEND_COLORS[k] }} />
            {t(`graph.legend.${k}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
