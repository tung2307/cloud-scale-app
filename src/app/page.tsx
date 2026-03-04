"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { Activity, Gauge, Layers, Zap } from "lucide-react";

/**
 * Mock UI dashboard for: AI-Based Auto-Scaling for a Cloud Web App
 *
 * ✅ Adds a “Traditional (threshold) vs Predictive” comparison:
 * - Simulates BOTH strategies in parallel on the same workload point
 * - Shows side-by-side outcomes (p95, errors, cost, SLA risk)
 * - Still lets you toggle which strategy is the “active” one for KPI cards + state
 *
 * Requirements:
 *   npm i recharts lucide-react
 */

type Point = {
  t: string;
  rps: number;

  // Active (selected mode) values used by KPI cards + right chart
  p95: number;
  cost: number;
  instances: number;
  cpu: number;
  errors: number;

  // Parallel simulations for comparison
  inst_threshold: number;
  inst_predictive: number;

  cpu_threshold: number;
  cpu_predictive: number;

  p95_threshold: number;
  p95_predictive: number;

  errors_threshold: number;
  errors_predictive: number;

  cost_threshold: number;
  cost_predictive: number;
};

type EventItem = {
  ts: string;
  kind: "spike" | "scale" | "note";
  msg: string;
};

type SpikeState = {
  active: boolean;
  endsAt: number;
  mult: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// Stable, locale-independent time string for SSR safety
function formatTime(d: Date) {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

// Non-empty array pick (prevents undefined)
function pick<T>(arr: readonly [T, ...T[]]): T {
  const index = Math.floor(Math.random() * arr.length);
  return arr[index] as T;
}

function pillClass(kind: "default" | "warn" | "danger") {
  switch (kind) {
    case "danger":
      return "bg-red-100 text-red-800 border-red-200";
    case "warn":
      return "bg-yellow-100 text-yellow-900 border-yellow-200";
    default:
      return "bg-emerald-100 text-emerald-900 border-emerald-200";
  }
}

function simulateMetrics(rps: number, instances: number) {
  const loadPerInstance = rps / Math.max(1, instances);

  const cpu = clamp(18 + loadPerInstance * 0.55 + randFloat(-6, 6), 5, 98);

  const p95 = Math.round(
    clamp(
      110 + cpu * 2.3 + Math.max(0, cpu - 70) * 7.5 + randFloat(-25, 25),
      80,
      2200,
    ),
  );

  const errors = clamp(
    (Math.max(0, cpu - 80) / 30) * 2 +
      (Math.max(0, p95 - 800) / 1200) * 3 +
      randFloat(0, 0.4),
    0,
    8,
  );

  return { cpu, p95, errors };
}

function estimateCost(instances: number, spikeMult: number) {
  return clamp(
    0.05 +
      instances * 0.06 +
      (spikeMult > 1 ? 0.03 : 0) +
      randFloat(-0.01, 0.01),
    0.05,
    1.5,
  );
}

export default function MockAutoscalingDashboardTS() {
  const [mounted, setMounted] = useState(false);

  const [mode, setMode] = useState<"threshold" | "predictive">("predictive");
  const [running, setRunning] = useState(true);
  const [spikeChance, setSpikeChance] = useState(18); // % per tick
  const [windowSize, setWindowSize] = useState(60); // points

  // Baseline drift driver (workload only)
  const baseRef = useRef({ rps: 55 });

  // Parallel simulation state
  const simRef = useRef({
    inst_threshold: 2,
    inst_predictive: 2,
  });

  const [spikeState, setSpikeState] = useState<SpikeState>({
    active: false,
    endsAt: 0,
    mult: 1,
  });

  const [events, setEvents] = useState<EventItem[]>([]);
  const [series, setSeries] = useState<Point[]>([]);

  // Refs to avoid stale closures
  const modeRef = useRef(mode);
  const runningRef = useRef(running);
  const spikeChanceRef = useRef(spikeChance);
  const windowSizeRef = useRef(windowSize);
  const spikeStateRef = useRef(spikeState);
  const seriesRef = useRef<Point[]>(series);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);
  useEffect(() => {
    spikeChanceRef.current = spikeChance;
  }, [spikeChance]);
  useEffect(() => {
    windowSizeRef.current = windowSize;
  }, [windowSize]);
  useEffect(() => {
    spikeStateRef.current = spikeState;
  }, [spikeState]);
  useEffect(() => {
    seriesRef.current = series;
  }, [series]);

  const logEvent = (kind: EventItem["kind"], msg: string) => {
    const ts = formatTime(new Date());
    setEvents((prev) => [{ ts, kind, msg }, ...prev].slice(0, 8));
  };

  // Mount + seed on client only
  useEffect(() => {
    setMounted(true);

    const now = new Date();
    const seed: Point[] = [];
    for (let i = 30; i > 0; i--) {
      const t = new Date(now.getTime() - i * 1000);
      seed.push({
        t: formatTime(t),
        rps: 45,

        // active defaults
        p95: 180,
        cost: 0.12,
        instances: 2,
        cpu: 30,
        errors: 0.2,

        // parallel
        inst_threshold: 2,
        inst_predictive: 2,

        cpu_threshold: 30,
        cpu_predictive: 30,

        p95_threshold: 180,
        p95_predictive: 180,

        errors_threshold: 0.2,
        errors_predictive: 0.2,

        cost_threshold: 0.12,
        cost_predictive: 0.12,
      });
    }
    setSeries(seed);
  }, []);

  // Main scheduler: random 5–10s updates
  useEffect(() => {
    if (!mounted) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = () => {
      const ms = randInt(5000, 10000);

      timeoutId = setTimeout(() => {
        if (!runningRef.current) {
          scheduleNext();
          return;
        }

        const now = Date.now();

        // Spike handling
        const st = spikeStateRef.current;

        // Maybe start a spike
        if (!st.active && Math.random() * 100 < spikeChanceRef.current) {
          const durationMs = pick([15000, 20000, 25000] as const);
          const mult = randFloat(3.5, 7.5);

          const nextSpike: SpikeState = {
            active: true,
            endsAt: now + durationMs,
            mult,
          };
          spikeStateRef.current = nextSpike;
          setSpikeState(nextSpike);

          logEvent(
            "spike",
            `Traffic spike started (×${mult.toFixed(1)}) for ~${Math.round(durationMs / 1000)}s`,
          );
        }

        // Determine spike multiplier + end spike if needed
        let spikeMult = 1;
        const st2 = spikeStateRef.current;

        if (st2.active) {
          if (now >= st2.endsAt) {
            const cleared: SpikeState = { active: false, endsAt: 0, mult: 1 };
            spikeStateRef.current = cleared;
            setSpikeState(cleared);
            logEvent("note", "Traffic spike ended; returning to baseline");
          } else {
            spikeMult = st2.mult;
          }
        }

        // Workload drift
        baseRef.current.rps = clamp(
          baseRef.current.rps + randFloat(-6, 6),
          25,
          120,
        );
        const rps = Math.round(baseRef.current.rps * spikeMult);

        const last = seriesRef.current[seriesRef.current.length - 1];
        const recentDelta = last ? rps - last.rps : 0;
        const predictedHigh = spikeMult > 1 || recentDelta > 60;

        // Scaling thresholds
        const thresholdUp = 70;
        const thresholdDown = 35;

        // --- Parallel simulate THRESHOLD (traditional) ---
        let instT = simRef.current.inst_threshold;

        const mT1 = simulateMetrics(rps, instT);
        let desiredT = instT;

        if (mT1.cpu > thresholdUp && instT < 12) {
          desiredT = clamp(instT + 1, 1, 12);
        } else if (mT1.cpu < thresholdDown && spikeMult === 1 && instT > 2) {
          desiredT = clamp(instT - 1, 1, 12);
        }

        if (desiredT !== instT) {
          logEvent(
            "scale",
            `Threshold scaling: ${instT} → ${desiredT} instances`,
          );
          instT = desiredT;
        }

        const mT2 = simulateMetrics(rps, instT);
        const costT = estimateCost(instT, spikeMult);

        // --- Parallel simulate PREDICTIVE (AI) ---
        let instP = simRef.current.inst_predictive;

        const mP1 = simulateMetrics(rps, instP);
        let desiredP = instP;

        if (predictedHigh && instP < 10) {
          desiredP = clamp(instP + 2, 1, 12); // proactive jump
        } else if (mP1.cpu > thresholdUp && instP < 12) {
          desiredP = clamp(instP + 1, 1, 12);
        } else if (mP1.cpu < thresholdDown && spikeMult === 1 && instP > 2) {
          desiredP = clamp(instP - 1, 1, 12);
        }

        if (desiredP !== instP) {
          logEvent(
            "scale",
            `Predictive scaling: ${instP} → ${desiredP} instances`,
          );
          instP = desiredP;
        }

        const mP2 = simulateMetrics(rps, instP);
        const costP = estimateCost(instP, spikeMult);

        // Commit parallel instance state
        simRef.current.inst_threshold = instT;
        simRef.current.inst_predictive = instP;

        // Choose active mode (what KPI cards show)
        const activeMode = modeRef.current;
        const active =
          activeMode === "predictive"
            ? {
                inst: instP,
                cpu: mP2.cpu,
                p95: mP2.p95,
                errors: mP2.errors,
                cost: costP,
              }
            : {
                inst: instT,
                cpu: mT2.cpu,
                p95: mT2.p95,
                errors: mT2.errors,
                cost: costT,
              };

        const point: Point = {
          t: formatTime(new Date()),
          rps,

          instances: active.inst,
          cpu: Math.round(active.cpu),
          p95: active.p95,
          errors: Number(active.errors.toFixed(2)),
          cost: Number(active.cost.toFixed(2)),

          inst_threshold: instT,
          inst_predictive: instP,

          cpu_threshold: Math.round(mT2.cpu),
          cpu_predictive: Math.round(mP2.cpu),

          p95_threshold: mT2.p95,
          p95_predictive: mP2.p95,

          errors_threshold: Number(mT2.errors.toFixed(2)),
          errors_predictive: Number(mP2.errors.toFixed(2)),

          cost_threshold: Number(costT.toFixed(2)),
          cost_predictive: Number(costP.toFixed(2)),
        };

        setSeries((prev) => {
          const next = [...prev, point];
          const sliced = next.slice(
            Math.max(0, next.length - windowSizeRef.current),
          );
          seriesRef.current = sliced;
          return sliced;
        });

        scheduleNext();
      }, ms);
    };

    scheduleNext();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [mounted]);

  const kpis = useMemo(() => series[series.length - 1], [series]);

  const status = useMemo(() => {
    if (!running) return { label: "Paused", kind: "warn" as const };
    if (spikeState.active)
      return { label: "Spike Active", kind: "danger" as const };
    return { label: "Normal", kind: "default" as const };
  }, [running, spikeState.active]);

  const comparison = useMemo(() => {
    if (!series.length) return null;

    const slice = series.slice(
      Math.max(0, series.length - Math.min(windowSize, 60)),
    );

    const avg = (arr: number[]) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const p95T = avg(slice.map((p) => p.p95_threshold));
    const p95P = avg(slice.map((p) => p.p95_predictive));

    const errT = avg(slice.map((p) => p.errors_threshold));
    const errP = avg(slice.map((p) => p.errors_predictive));

    const costT = avg(slice.map((p) => p.cost_threshold));
    const costP = avg(slice.map((p) => p.cost_predictive));

    const slaRiskT = slice.filter(
      (p) => p.p95_threshold > 800 || p.errors_threshold > 1,
    ).length;
    const slaRiskP = slice.filter(
      (p) => p.p95_predictive > 800 || p.errors_predictive > 1,
    ).length;

    const benefitLatency = p95T > 0 ? ((p95T - p95P) / p95T) * 100 : 0;
    const benefitErrors = errT > 0 ? ((errT - errP) / errT) * 100 : 0;
    const costDelta = costP - costT;

    return {
      p95T,
      p95P,
      errT,
      errP,
      costT,
      costP,
      slaRiskT,
      slaRiskP,
      benefitLatency,
      benefitErrors,
      costDelta,
    };
  }, [series, windowSize]);

  if (!mounted) {
    return (
      <div
        className="min-h-screen w-full bg-gray-50 p-6"
        suppressHydrationWarning
      >
        <div className="mx-auto max-w-6xl">
          <h1 className="text-2xl font-semibold">
            Predictive Auto-Scaling Dashboard (Mock)
          </h1>
          <p className="mt-2 text-sm text-gray-600">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full bg-gray-50 p-4 md:p-8"
      suppressHydrationWarning
    >
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              Predictive Auto-Scaling Dashboard (Mock)
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              Simulated workload and autoscaling behavior for evaluation and
              demo.
            </p>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${pillClass(
                status.kind,
              )}`}
            >
              {status.label}
            </span>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Threshold</span>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={mode === "predictive"}
                  onChange={(e) =>
                    setMode(e.target.checked ? "predictive" : "threshold")
                  }
                  aria-label="Toggle predictive mode"
                />
                <div className="peer h-6 w-11 rounded-full bg-gray-300 peer-checked:bg-emerald-500 after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-full" />
              </label>
              <span className="text-sm text-gray-600">Predictive</span>
            </div>

            <button
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                running
                  ? "bg-white hover:bg-gray-100"
                  : "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
              }`}
              onClick={() => setRunning((r) => !r)}
            >
              {running ? "Pause" : "Resume"}
            </button>
          </div>
        </div>

        {/* KPI cards (active mode) */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <KpiCard
            icon={<Activity className="h-4 w-4" />}
            label="Traffic (RPS)"
            value={`${kpis?.rps ?? "–"}`}
            hint={spikeState.active ? "spike" : "steady"}
          />
          <KpiCard
            icon={<Gauge className="h-4 w-4" />}
            label="p95 Latency"
            value={`${kpis?.p95 ?? "–"} ms`}
            hint={(kpis?.p95 ?? 0) > 800 ? "degraded" : "ok"}
          />
          <KpiCard
            icon={<Layers className="h-4 w-4" />}
            label="Instances"
            value={`${kpis?.instances ?? "–"}`}
            hint={mode}
          />
          <KpiCard
            icon={<Zap className="h-4 w-4" />}
            label="Est. Cost"
            value={`$${(kpis?.cost ?? 0).toFixed(2)}/hr`}
            hint="approx"
          />
        </div>

        {/* Comparison panel (traditional vs predictive benefit) */}
        <div className="rounded-2xl border bg-white p-4 shadow-sm md:p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-base font-semibold">
                Traditional vs Predictive (Live Comparison)
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Both strategies are simulated on the same traffic. Predictive
                tries to scale earlier when a spike is likely.
              </p>
            </div>
            {comparison ? (
              <div className="text-xs text-gray-600">
                Window: last ~{Math.min(windowSize, 60)} points
              </div>
            ) : null}
          </div>

          {!comparison ? (
            <p className="mt-4 text-sm text-gray-600">Collecting data…</p>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-2xl border p-4">
                  <div className="text-xs font-medium text-gray-600">
                    Traditional (Threshold)
                  </div>
                  <div className="mt-3 space-y-2 text-sm">
                    <Row
                      label="Avg p95"
                      value={`${Math.round(comparison.p95T)} ms`}
                    />
                    <Row
                      label="Avg errors"
                      value={`${comparison.errT.toFixed(2)}%`}
                    />
                    <Row
                      label="SLA risk count"
                      value={`${comparison.slaRiskT}`}
                    />
                    <Row
                      label="Avg cost"
                      value={`$${comparison.costT.toFixed(2)}/hr`}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border p-4">
                  <div className="text-xs font-medium text-gray-600">
                    Predictive (AI)
                  </div>
                  <div className="mt-3 space-y-2 text-sm">
                    <Row
                      label="Avg p95"
                      value={`${Math.round(comparison.p95P)} ms`}
                    />
                    <Row
                      label="Avg errors"
                      value={`${comparison.errP.toFixed(2)}%`}
                    />
                    <Row
                      label="SLA risk count"
                      value={`${comparison.slaRiskP}`}
                    />
                    <Row
                      label="Avg cost"
                      value={`$${comparison.costP.toFixed(2)}/hr`}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border p-4">
                  <div className="text-xs font-medium text-gray-600">
                    Benefit Summary
                  </div>
                  <div className="mt-3 space-y-2 text-sm">
                    <Row
                      label="Latency improvement"
                      value={`${comparison.benefitLatency >= 0 ? "+" : ""}${comparison.benefitLatency.toFixed(
                        0,
                      )}%`}
                    />
                    <Row
                      label="Errors improvement"
                      value={`${comparison.benefitErrors >= 0 ? "+" : ""}${comparison.benefitErrors.toFixed(
                        0,
                      )}%`}
                    />
                    <Row
                      label="SLA risk reduction"
                      value={`${Math.max(0, comparison.slaRiskT - comparison.slaRiskP)}`}
                    />
                    <Row
                      label="Cost tradeoff"
                      value={`${comparison.costDelta >= 0 ? "+" : ""}$${comparison.costDelta.toFixed(2)}/hr`}
                    />
                  </div>
                  <p className="mt-3 text-xs text-gray-600">
                    Predictive usually reduces p95/errors during spikes by
                    scaling earlier, but may cost slightly more when it
                    over-prepares.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Charts */}
        <div className="rounded-2xl border bg-white p-4 shadow-sm md:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-base font-semibold">
                Traffic & Scaling Over Time
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                Top chart: RPS + instance counts for both strategies. Bottom
                chart: active mode quality metrics.
              </p>
            </div>

            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">Spike chance</span>
                  <span className="text-xs font-medium">
                    {spikeChance}% / tick
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={45}
                  step={1}
                  value={spikeChance}
                  onChange={(e) => setSpikeChance(Number(e.target.value))}
                  className="w-56"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">Window</span>
                  <span className="text-xs font-medium">
                    {windowSize} points
                  </span>
                </div>
                <input
                  type="range"
                  min={30}
                  max={180}
                  step={10}
                  value={windowSize}
                  onChange={(e) => setWindowSize(Number(e.target.value))}
                  className="w-56"
                />
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* RPS + BOTH instance strategies */}
            <div className="h-72 rounded-xl border p-3">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={series}
                  margin={{ left: 0, right: 12, top: 10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="t" tick={{ fontSize: 11 }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="rps"
                    name="RPS"
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="inst_threshold"
                    name="Instances (Threshold)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="inst_predictive"
                    name="Instances (Predictive)"
                    strokeWidth={2}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Active mode quality metrics */}
            <div className="h-72 rounded-xl border p-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={series}
                  margin={{ left: 0, right: 12, top: 10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="t" tick={{ fontSize: 11 }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="p95"
                    name="p95 (ms) [active]"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="cpu"
                    name="CPU (%) [active]"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="errors"
                    name="Errors (%) [active]"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Events + state */}
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border p-4">
              <h3 className="text-sm font-semibold">Current State</h3>
              <div className="mt-3 space-y-2 text-sm">
                <Row
                  label="Mode"
                  value={
                    mode === "predictive"
                      ? "Predictive (AI)"
                      : "Threshold (Baseline)"
                  }
                />
                <Row label="CPU" value={`${kpis?.cpu ?? "–"}%`} />
                <Row
                  label="Error rate"
                  value={`${(kpis?.errors ?? 0).toFixed(2)}%`}
                />
                <Row
                  label="Estimated cost"
                  value={`$${(kpis?.cost ?? 0).toFixed(2)}/hr`}
                />
              </div>
            </div>

            <div className="rounded-2xl border p-4 lg:col-span-2">
              <h3 className="text-sm font-semibold">Recent Events</h3>

              <div className="mt-3 space-y-2">
                {events.length === 0 ? (
                  <p className="text-sm text-gray-600">
                    No events yet. Wait for the first spike.
                  </p>
                ) : (
                  events.map((e, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-3 rounded-xl border p-3"
                    >
                      <div className="mt-0.5">
                        {e.kind === "spike" ? (
                          <Zap className="h-4 w-4" />
                        ) : e.kind === "scale" ? (
                          <Layers className="h-4 w-4" />
                        ) : (
                          <Activity className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs text-gray-600">{e.ts}</div>
                        <div className="text-sm font-medium wrap-break-word">
                          {e.msg}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <p className="mt-6 text-xs text-gray-600">
            Note: This is simulated data for UI/demo purposes. Replace the
            generator with real metrics from CloudWatch/Prometheus later.
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-gray-600">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
        <span className="text-gray-500">{icon}</span>
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      {hint ? <div className="mt-1 text-xs text-gray-600">{hint}</div> : null}
    </div>
  );
}
