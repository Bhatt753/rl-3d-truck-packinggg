import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";

import { CinematicRig } from "./camera/CinematicRig";
import { Boxes } from "./scene/Boxes";
import { Forklift } from "./scene/Forklift";
import { Lighting } from "./scene/Lighting";
import { Truck } from "./scene/Truck";
import { Warehouse } from "./scene/Warehouse";
import { MetricsOverlay } from "./hud/MetricsOverlay";
import { buildTrips, evaluateAt, type FrameState } from "./animation/timeline";
import { loadTrace } from "./trace/loader";
import type { Trace } from "./trace/schema";

const DEFAULT_TRACE_URL = "/traces/latest.json";
const FALLBACK_TRACE_URL = "/traces/sample.json";

function parseQueryStartTime(): number {
  if (typeof window === "undefined") return 0;
  const p = new URLSearchParams(window.location.search);
  const t = parseFloat(p.get("t") ?? "");
  return Number.isFinite(t) ? t : 0;
}

function parseQuerySpeed(): number {
  if (typeof window === "undefined") return 1;
  const p = new URLSearchParams(window.location.search);
  const raw = p.get("speed");
  if (raw === null) return 1;
  const s = parseFloat(raw);
  return Number.isFinite(s) && s >= 0 ? s : 1;
}

export default function App() {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(parseQuerySpeed());
  const timeRef = useRef(parseQueryStartTime());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await loadTrace(DEFAULT_TRACE_URL);
        if (!cancelled) setTrace(t);
      } catch {
        try {
          const t = await loadTrace(FALLBACK_TRACE_URL);
          if (!cancelled) setTrace(t);
        } catch (e) {
          if (!cancelled) setError(String(e));
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) return <ErrorScreen msg={error} />;
  if (!trace) return <LoadingScreen />;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <Canvas
        shadows
        // MSAA via the WebGL2 multisample renderer + high DPR up to 2 for
        // crisp edges. Logarithmic depth buffer eliminates z-fighting between
        // surfaces that are very close together (logo decal vs trailer wall,
        // floor lines vs ground, tape strip vs box).
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          logarithmicDepthBuffer: true,
          stencil: false,
        }}
        dpr={[1, 2]}
        camera={{ position: [14, 6, 10], fov: 38, near: 0.5, far: 250 }}
      >
        <color attach="background" args={["#1a1f26"]} />
        <fog attach="fog" args={["#1a1f26", 20, 55]} />
        <Scene trace={trace} timeRef={timeRef} paused={paused} speed={speed} />
      </Canvas>

      <MetricsOverlay trace={trace} timeRef={timeRef} />
      <Controls
        paused={paused}
        speed={speed}
        onTogglePause={() => setPaused((p) => !p)}
        onSpeedChange={setSpeed}
        onRestart={() => { timeRef.current = 0; }}
      />
    </div>
  );
}

function Scene({
  trace,
  timeRef,
  paused,
  speed,
}: {
  trace: Trace;
  timeRef: { current: number };
  paused: boolean;
  speed: number;
}) {
  const trips = useMemo(() => buildTrips(trace), [trace]);
  const initialState: FrameState = useMemo(() => evaluateAt(trips, 0, trace.truck.width_m), [trips, trace]);
  const frameStateRef = useRef<FrameState>(initialState);

  // Tick once per frame, BEFORE children's useFrame calls (negative priority).
  useFrame((_, delta) => {
    if (!paused) timeRef.current += delta * speed;
    if (timeRef.current > trace.metrics.duration_s + 2) {
      timeRef.current = 0;
    }
    frameStateRef.current = evaluateAt(trips, timeRef.current, trace.truck.width_m);
  }, -1);

  return (
    <>
      <Lighting />
      <Warehouse trace={trace} trips={trips} />
      <Truck truck={trace.truck} timeRef={timeRef} />
      <Forklift frameStateRef={frameStateRef} />
      <Boxes trips={trips} frameStateRef={frameStateRef} />
      <CinematicRig
        cues={trace.camera}
        truck={trace.truck}
        timeRef={timeRef}
        frameStateRef={frameStateRef}
      />
    </>
  );
}

function Controls({
  paused,
  speed,
  onTogglePause,
  onSpeedChange,
  onRestart,
}: {
  paused: boolean;
  speed: number;
  onTogglePause: () => void;
  onSpeedChange: (s: number) => void;
  onRestart: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: 16,
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: "8px 12px",
        background: "rgba(13, 17, 23, 0.7)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 6,
        fontSize: 12,
        color: "#cbd5e1",
      }}
    >
      <button onClick={onTogglePause} style={btn}>
        {paused ? "Play" : "Pause"}
      </button>
      <button onClick={onRestart} style={btn}>Restart</button>
      <span style={{ opacity: 0.6, marginLeft: 8 }}>Speed</span>
      {[0.5, 1, 2, 4].map((s) => (
        <button
          key={s}
          onClick={() => onSpeedChange(s)}
          style={{ ...btn, opacity: speed === s ? 1 : 0.55 }}
        >
          {s}×
        </button>
      ))}
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.10)",
  color: "#e6edf3",
  borderRadius: 4,
  padding: "4px 10px",
  fontSize: 12,
  cursor: "pointer",
};

function LoadingScreen() {
  return (
    <div style={center}>
      <div>Loading trace…</div>
    </div>
  );
}

function ErrorScreen({ msg }: { msg: string }) {
  return (
    <div style={center}>
      <div>Could not load a trace.</div>
      <pre style={{ marginTop: 8, opacity: 0.6, fontSize: 12 }}>{msg}</pre>
      <div style={{ marginTop: 16, opacity: 0.65, fontSize: 13 }}>
        Generate one with:{" "}
        <code>python -m src.trace.recorder --out renderer/public/traces/latest.json</code>
      </div>
    </div>
  );
}

const center: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  color: "#cbd5e1",
};
