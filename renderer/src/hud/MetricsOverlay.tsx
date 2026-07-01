// Minimal HUD: small top-left tag, top-right live metrics, and a final
// metrics card that fades in during the last shot.

import { useEffect, useState } from "react";

import type { Trace, TraceEvent } from "../trace/schema";

const styles: { [k: string]: React.CSSProperties } = {
  tag: {
    position: "absolute",
    top: 16,
    left: 16,
    padding: "8px 12px",
    background: "rgba(13, 17, 23, 0.7)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 6,
    fontSize: 12,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#cbd5e1",
  },
  metric: {
    position: "absolute",
    top: 16,
    right: 16,
    padding: "10px 14px",
    background: "rgba(13, 17, 23, 0.7)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 6,
    fontVariantNumeric: "tabular-nums",
    fontSize: 13,
    color: "#e6edf3",
    minWidth: 200,
  },
  finalCard: {
    position: "absolute",
    bottom: 32,
    left: "50%",
    transform: "translateX(-50%)",
    padding: "20px 28px",
    background: "rgba(13, 17, 23, 0.88)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 10,
    fontVariantNumeric: "tabular-nums",
    fontSize: 14,
    color: "#e6edf3",
    transition: "opacity 0.8s ease, transform 0.8s ease",
  },
};

export function MetricsOverlay({
  trace,
  timeRef,
}: {
  trace: Trace;
  timeRef: { current: number };
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((x) => x + 1), 100);
    return () => clearInterval(i);
  }, []);

  const now = timeRef.current;
  const placed = countPlaced(trace.events, now);
  const liveUtil = estimateUtilization(trace, placed);

  const finalT = trace.metrics.duration_s - 5.0;
  const finalVisible = now >= finalT;

  return (
    <>
      <div style={styles.tag}>
        Smart Truck Loading <span style={{ opacity: 0.6 }}>·</span> Maskable PPO
      </div>
      <div style={styles.metric}>
        <Row label="Utilization" value={`${(liveUtil * 100).toFixed(1)}%`} />
        <Row label="Boxes loaded" value={`${placed} / ${trace.metrics.boxes_total}`} />
        <Row label="t" value={`${now.toFixed(1)}s`} />
      </div>
      <div
        style={{
          ...styles.finalCard,
          opacity: finalVisible ? 1 : 0,
          transform: `translateX(-50%) translateY(${finalVisible ? 0 : 12}px)`,
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", opacity: 0.65 }}>
          Final result
        </div>
        <div style={{ display: "flex", gap: 28, marginTop: 8 }}>
          <Stat label="Volume utilization" value={`${(trace.metrics.utilization * 100).toFixed(1)}%`} />
          <Stat label="Boxes loaded" value={`${trace.metrics.boxes_placed} / ${trace.metrics.boxes_total}`} />
          <Stat label="Duration" value={`${(trace.metrics.duration_s - 8.5).toFixed(1)}s`} />
          <Stat label="Policy" value={trace.policy === "trained" ? "Maskable PPO" : "Random + mask"} />
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
      <span style={{ opacity: 0.65 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, opacity: 0.55, textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function countPlaced(events: TraceEvent[], now: number): number {
  let n = 0;
  for (const e of events) {
    if (e.type === "place" && e.t <= now) n++;
  }
  return n;
}

function estimateUtilization(trace: Trace, placed: number): number {
  if (placed >= trace.metrics.boxes_placed) return trace.metrics.utilization;
  return (placed / Math.max(1, trace.metrics.boxes_placed)) * trace.metrics.utilization;
}
