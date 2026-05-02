"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Brain,
  CheckCircle2,
  CircleDollarSign,
  Gauge,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Server,
  ShieldCheck,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ModelName = "xgboost" | "random_forest";

type MetricSample = {
  requests: number;
  response_time_ms: number;
  node_cpu_millicores: number;
  pod_cpu_millicores: number;
  pod_mem_mi: number;
  replicas: number;
};

type CloudWatchMetricResponse = {
  timestamp: string;
  requests: number;
  response_time_ms: number;
  cpu_percent: number;
  memory_percent: number;
  pod_cpu_millicores: number;
  pod_mem_mi: number;
  node_cpu_millicores: number;
  replicas: number;
  desired_replicas?: number;
  available_replicas?: number;
  source?: string;
};

type Point = {
  t: string;
  tsMs: number;
  rps: number;
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
  active_cpu: number;
  active_p95: number;
  active_errors: number;
  active_instances: number;
  active_cost: number;
  memory_percent: number;
};

type EventItem = {
  ts: string;
  kind: "ai" | "threshold" | "cloudwatch" | "scale" | "note";
  msg: string;
};

type PredictionResponse = {
  recommended: number | null;
  raw?: number;
  modelUsed?: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatTime(d: Date) {
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatPct(n: number) {
  if (!Number.isFinite(n)) return "0%";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(0)}%`;
}

function formatUsd(n: number) {
  if (!Number.isFinite(n)) return "$0.00";
  const sign = n > 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

function estimateCost(pods: number) {
  return Number(clamp(0.06 + pods * 0.055, 0.06, 2).toFixed(2));
}

function estimateErrors(cpu: number, p95: number) {
  return Number(
    clamp(
      (Math.max(0, cpu - 82) / 26) * 2.4 + (Math.max(0, p95 - 850) / 1150) * 3,
      0,
      8,
    ).toFixed(2),
  );
}

function projectHealth(metric: CloudWatchMetricResponse, pods: number) {
  const currentPods = Math.max(1, metric.replicas || 1);
  const safePods = Math.max(1, pods);
  const loadFactor = currentPods / safePods;

  const projectedCpu = clamp(metric.cpu_percent * loadFactor, 2, 98);
  const projectedP95 = Math.round(
    clamp(
      metric.response_time_ms * Math.max(0.7, loadFactor) +
        Math.max(0, projectedCpu - 65) * 6,
      50,
      2200,
    ),
  );

  return {
    cpu: Math.round(projectedCpu),
    p95: projectedP95,
    errors: estimateErrors(projectedCpu, projectedP95),
  };
}

async function fetchCloudWatchMetrics(): Promise<CloudWatchMetricResponse | null> {
  try {
    const res = await fetch("/api/cloudwatch", { cache: "no-store" });
    const data = await res.json();

    if (!res.ok || data.error) {
      console.warn("CloudWatch API error:", data.error ?? res.statusText);
      return null;
    }

    return data as CloudWatchMetricResponse;
  } catch (err) {
    console.warn("CloudWatch API unreachable:", err);
    return null;
  }
}

async function callPredictAPI(
  history: MetricSample[],
  model: ModelName,
): Promise<PredictionResponse> {
  try {
    const res = await fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history, model }),
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      console.warn("Predict API error:", data.error ?? res.statusText);
      return { recommended: null };
    }

    return {
      recommended: Number(data.recommended_replicas),
      raw: Number(data.predicted_replicas_raw),
      modelUsed: data.model_used,
    };
  } catch (err) {
    console.warn("Predict API unreachable:", err);
    return { recommended: null };
  }
}

async function applyScale(replicas: number) {
  try {
    const res = await fetch("/api/scale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replicas }),
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      console.warn("Scale API error:", data.error ?? res.statusText);
      return null;
    }

    return data;
  } catch (err) {
    console.warn("Scale API unreachable:", err);
    return null;
  }
}

export default function PredictiveAutoscalingDashboard() {
  const [mounted, setMounted] = useState(false);
  const [running, setRunning] = useState(true);
  const [autoApply, setAutoApply] = useState(false);
  const [mode, setMode] = useState<"predictive" | "threshold">("predictive");
  const [selectedModel, setSelectedModel] = useState<ModelName>("xgboost");
  const [series, setSeries] = useState<Point[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [windowSize, setWindowSize] = useState(80);
  const [metricsOnline, setMetricsOnline] = useState(false);
  const [metricSource, setMetricSource] = useState("waiting");
  const [lastPrediction, setLastPrediction] = useState<PredictionResponse>({
    recommended: null,
  });

  const instancesRef = useRef({ threshold: 1, predictive: 1 });
  const historyRef = useRef<MetricSample[]>([]);
  const runningRef = useRef(running);
  const autoApplyRef = useRef(autoApply);
  const modeRef = useRef(mode);
  const selectedModelRef = useRef(selectedModel);
  const windowSizeRef = useRef(windowSize);
  const lastScaleAtRef = useRef(0);
  const lastThresholdScaleAtRef = useRef(0);
  const lastObservedReplicasRef = useRef<number | null>(null);
  const lastAiRecommendationRef = useRef<number | null>(null);
  const lastEventKeyRef = useRef("");

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    autoApplyRef.current = autoApply;
  }, [autoApply]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    windowSizeRef.current = windowSize;
  }, [windowSize]);

  const logEvent = (kind: EventItem["kind"], msg: string) => {
    setEvents((prev) =>
      [{ ts: formatTime(new Date()), kind, msg }, ...prev].slice(0, 10),
    );
  };

  const logEventOnce = (kind: EventItem["kind"], msg: string) => {
    const key = `${kind}:${msg}`;
    if (lastEventKeyRef.current === key) return;
    lastEventKeyRef.current = key;
    logEvent(kind, msg);
  };

  const resetDashboard = () => {
    setSeries([]);
    setEvents([]);
    setLastPrediction({ recommended: null });
    historyRef.current = [];
    instancesRef.current = { threshold: 1, predictive: 1 };
    lastScaleAtRef.current = 0;
    lastThresholdScaleAtRef.current = 0;
    lastObservedReplicasRef.current = null;
    lastAiRecommendationRef.current = null;
    lastEventKeyRef.current = "";
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (!runningRef.current) {
        timeoutId = setTimeout(tick, 1200);
        return;
      }

      const metric = await fetchCloudWatchMetrics();

      if (!metric) {
        setMetricsOnline(false);
        logEventOnce(
          "note",
          "Waiting for CloudWatch metrics from /api/cloudwatch",
        );
        timeoutId = setTimeout(tick, 3000);
        return;
      }

      setMetricsOnline(true);
      setMetricSource(metric.source ?? "CloudWatch / EKS");

      const MAX_REPLICAS = 5;
      const now = new Date(metric.timestamp).getTime() || Date.now();
      const currentReplicas = clamp(metric.replicas || 1, 1, MAX_REPLICAS);

      if (
        lastObservedReplicasRef.current !== null &&
        currentReplicas !== lastObservedReplicasRef.current
      ) {
        const direction =
          currentReplicas > lastObservedReplicasRef.current ? "up" : "down";

        logEventOnce(
          "cloudwatch",
          `CloudWatch observed scale ${direction}: ${lastObservedReplicasRef.current} → ${currentReplicas} pods`,
        );
      }

      lastObservedReplicasRef.current = currentReplicas;

      let instT = instancesRef.current.threshold;
      let instP = instancesRef.current.predictive;

      // Only initialize from CloudWatch once. Do not overwrite the dashboard's
      // predicted pod state every tick, otherwise repeated recommendations look like
      // 1 → 3, 1 → 3, 1 → 3 even after the chart already moved to 3.
      if (instP < 1) {
        instP = currentReplicas;
      }

      const thresholdProbe = projectHealth(metric, instT);
      let desiredT = instT;

      const nowMs = Date.now();
      const thresholdCooldownMs = 20_000;

      const thresholdHigh =
        metric.cpu_percent > 65 ||
        metric.response_time_ms > 450 ||
        metric.requests > 120;

      const thresholdLow =
        metric.cpu_percent < 35 &&
        metric.response_time_ms < 280 &&
        metric.requests < 60;

      if (nowMs - lastThresholdScaleAtRef.current > thresholdCooldownMs) {
        if (thresholdHigh && instT < MAX_REPLICAS) {
          desiredT = clamp(instT + 1, 1, MAX_REPLICAS);
          lastThresholdScaleAtRef.current = nowMs;
        } else if (thresholdLow && instT > 1) {
          desiredT = clamp(instT - 1, 1, MAX_REPLICAS);
          lastThresholdScaleAtRef.current = nowMs;
        }
      }

      if (desiredT !== instT) {
        const direction = desiredT > instT ? "scale up" : "scale down";
        logEvent(
          "threshold",
          `Threshold baseline would ${direction}: ${instT} → ${desiredT} pods`,
        );
        instT = desiredT;
      }

      const sample: MetricSample = {
        requests: metric.requests,
        response_time_ms: metric.response_time_ms,
        node_cpu_millicores: metric.node_cpu_millicores,
        pod_cpu_millicores: metric.pod_cpu_millicores,
        pod_mem_mi: metric.pod_mem_mi,
        replicas: instP,
      };

      historyRef.current = [...historyRef.current, sample].slice(-30);

      const recent = historyRef.current.slice(-6);
      const avgRecentRps = recent.length
        ? recent.reduce((sum, item) => sum + item.requests, 0) / recent.length
        : metric.requests;

      const trafficIsRising =
        recent.length >= 2 &&
        recent[recent.length - 1]!.requests > recent[0]!.requests * 1.2;

      let desiredP = instP;

      if (historyRef.current.length >= 13) {
        const prediction = await callPredictAPI(
          historyRef.current,
          selectedModelRef.current,
        );

        setLastPrediction(prediction);

        if (prediction.recommended !== null) {
          desiredP = clamp(prediction.recommended, 1, MAX_REPLICAS);
        }
      }

      // SLA-aware guardrail: the model can be cost-conscious, but we prevent under-scaling.
      let safetyFloor = 1;

      if (avgRecentRps > 80 || metric.cpu_percent > 55 || trafficIsRising) {
        safetyFloor = 2;
      }
      if (
        avgRecentRps > 140 ||
        metric.cpu_percent > 70 ||
        metric.response_time_ms > 500
      ) {
        safetyFloor = 3;
      }
      if (
        avgRecentRps > 220 ||
        metric.cpu_percent > 82 ||
        metric.response_time_ms > 800
      ) {
        safetyFloor = 4;
      }
      if (
        avgRecentRps > 420 ||
        metric.cpu_percent > 94 ||
        metric.response_time_ms > 1300
      ) {
        safetyFloor = 5;
      }

      desiredP = Math.max(desiredP, safetyFloor);

      const recentLowLoad = historyRef.current
        .slice(-4)
        .every((item) => item.requests < 60);

      if (
        recentLowLoad &&
        metric.cpu_percent < 40 &&
        metric.response_time_ms < 350 &&
        instP > 1
      ) {
        desiredP = clamp(instP - 1, 1, MAX_REPLICAS);
      }

      if (desiredP !== instP) {
        const direction = desiredP > instP ? "scale up" : "scale down";

        // Avoid repeating the same recommendation every poll.
        if (lastAiRecommendationRef.current !== desiredP) {
          logEvent(
            "ai",
            `AI recommends ${direction}: ${instP} → ${desiredP} pods`,
          );
          lastAiRecommendationRef.current = desiredP;
        }
      } else {
        lastAiRecommendationRef.current = instP;
      }

      if (autoApplyRef.current && desiredP !== instP) {
        const cooldownMs = 90_000;

        if (nowMs - lastScaleAtRef.current > cooldownMs) {
          const result = await applyScale(desiredP);

          if (result?.ok) {
            lastScaleAtRef.current = nowMs;
            logEvent(
              "scale",
              `Applied AI scaling to EKS: replicas = ${desiredP}`,
            );
          } else {
            logEvent(
              "note",
              "AI scaling was recommended, but /api/scale did not apply it",
            );
          }
        } else {
          logEventOnce("note", "Scale skipped because cooldown is active");
        }
      }

      instP = desiredP;

      const thresholdMetrics = projectHealth(metric, instT);
      const predictiveMetrics = projectHealth(metric, instP);
      const costT = estimateCost(instT);
      const costP = estimateCost(instP);

      instancesRef.current = { threshold: instT, predictive: instP };

      const active =
        modeRef.current === "predictive"
          ? {
              instances: instP,
              cpu: predictiveMetrics.cpu,
              p95: predictiveMetrics.p95,
              errors: predictiveMetrics.errors,
              cost: costP,
            }
          : {
              instances: instT,
              cpu: thresholdMetrics.cpu,
              p95: thresholdMetrics.p95,
              errors: thresholdMetrics.errors,
              cost: costT,
            };

      const point: Point = {
        t: formatTime(new Date(now)),
        tsMs: now,
        rps: metric.requests,
        inst_threshold: instT,
        inst_predictive: instP,
        cpu_threshold: thresholdMetrics.cpu,
        cpu_predictive: predictiveMetrics.cpu,
        p95_threshold: thresholdMetrics.p95,
        p95_predictive: predictiveMetrics.p95,
        errors_threshold: thresholdMetrics.errors,
        errors_predictive: predictiveMetrics.errors,
        cost_threshold: costT,
        cost_predictive: costP,
        active_cpu: active.cpu,
        active_p95: active.p95,
        active_errors: active.errors,
        active_instances: active.instances,
        active_cost: active.cost,
        memory_percent: metric.memory_percent,
      };

      setSeries((prev) => [...prev, point].slice(-windowSizeRef.current));

      timeoutId = setTimeout(tick, 5000);
    };

    timeoutId = setTimeout(tick, 500);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [mounted]);

  const latest = series[series.length - 1];

  const comparison = useMemo(() => {
    if (series.length < 2) return null;

    const slice = series.slice(-Math.min(series.length, 50));
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

    const avgP95Threshold = avg(slice.map((p) => p.p95_threshold));
    const avgP95Predictive = avg(slice.map((p) => p.p95_predictive));
    const avgErrThreshold = avg(slice.map((p) => p.errors_threshold));
    const avgErrPredictive = avg(slice.map((p) => p.errors_predictive));
    const avgCostThreshold = avg(slice.map((p) => p.cost_threshold));
    const avgCostPredictive = avg(slice.map((p) => p.cost_predictive));

    const slaRiskThreshold = slice.filter(
      (p) => p.p95_threshold > 800 || p.errors_threshold > 1,
    ).length;

    const slaRiskPredictive = slice.filter(
      (p) => p.p95_predictive > 800 || p.errors_predictive > 1,
    ).length;

    const latencyImprovement =
      avgP95Threshold > 0
        ? ((avgP95Threshold - avgP95Predictive) / avgP95Threshold) * 100
        : 0;

    const errorImprovement =
      avgErrThreshold > 0
        ? ((avgErrThreshold - avgErrPredictive) / avgErrThreshold) * 100
        : 0;

    const costDelta = avgCostPredictive - avgCostThreshold;
    const costSavings =
      avgCostThreshold > 0
        ? ((avgCostThreshold - avgCostPredictive) / avgCostThreshold) * 100
        : 0;

    const slaRiskReduction = slaRiskThreshold - slaRiskPredictive;

    const score =
      costSavings * 0.45 +
      latencyImprovement * 0.3 +
      errorImprovement * 0.15 +
      slaRiskReduction * 2;

    const summary =
      latencyImprovement >= 0 && errorImprovement >= 0
        ? "AI is improving performance while controlling cost."
        : costSavings > 0
          ? "AI is saving cost, but the model is more conservative on SLA."
          : "Threshold is currently performing better; tune AI guardrails or retrain.";

    return {
      avgP95Threshold,
      avgP95Predictive,
      avgErrThreshold,
      avgErrPredictive,
      avgCostThreshold,
      avgCostPredictive,
      latencyImprovement,
      errorImprovement,
      costDelta,
      costSavings,
      slaRiskReduction,
      slaRiskThreshold,
      slaRiskPredictive,
      score,
      summary,
    };
  }, [series]);

  const status = useMemo(() => {
    if (!running) return { label: "Paused", variant: "warn" as const };
    if (!metricsOnline) {
      return { label: "Waiting for CloudWatch", variant: "warn" as const };
    }
    if ((latest?.active_p95 ?? 0) > 800 || (latest?.active_errors ?? 0) > 1) {
      return { label: "SLA risk", variant: "danger" as const };
    }

    return { label: "CloudWatch live", variant: "ok" as const };
  }, [running, metricsOnline, latest]);

  if (!mounted) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-2xl font-semibold">Loading dashboard…</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-950 md:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-3xl border bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                <Brain className="h-3.5 w-3.5" /> EKS AI pod autoscaling demo
              </div>

              <h1 className="text-2xl font-semibold tracking-tight md:text-4xl">
                Predictive Auto-Scaling Dashboard
              </h1>

              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Live CloudWatch/EKS metrics are sent to the AI model. The
                dashboard compares a threshold baseline against an SLA-aware AI
                policy and can apply the AI replica decision to a Kubernetes
                Deployment.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:min-w-130">
              <div className="rounded-2xl border bg-slate-50 p-3">
                <label className="text-xs font-medium text-slate-500">
                  Model
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) =>
                    setSelectedModel(e.target.value as ModelName)
                  }
                  className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm font-medium outline-none"
                >
                  <option value="xgboost">XGBoost</option>
                  <option value="random_forest">Random Forest</option>
                </select>
              </div>

              <div className="rounded-2xl border bg-slate-50 p-3">
                <label className="text-xs font-medium text-slate-500">
                  Active strategy
                </label>

                <div className="mt-1 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setMode("predictive")}
                    className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                      mode === "predictive"
                        ? "bg-slate-950 text-white"
                        : "border bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    AI
                  </button>

                  <button
                    onClick={() => setMode("threshold")}
                    className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                      mode === "threshold"
                        ? "bg-slate-950 text-white"
                        : "border bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    Threshold
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <StatusPill variant={status.variant}>{status.label}</StatusPill>

            <button
              onClick={() => setRunning((v) => !v)}
              className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
            >
              {running ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {running ? "Pause" : "Resume"}
            </button>

            <button
              onClick={resetDashboard}
              className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
            >
              <RotateCcw className="h-4 w-4" /> Reset
            </button>

            <label className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={autoApply}
                onChange={(e) => setAutoApply(e.target.checked)}
              />
              Apply AI scaling to EKS
            </label>

            <div className="ml-auto text-xs text-slate-500">
              Source:{" "}
              <span className="font-medium text-slate-700">{metricSource}</span>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
          <KpiCard
            icon={<Activity className="h-4 w-4" />}
            label="Requests"
            value={`${latest?.rps ?? "–"}`}
            hint="CloudWatch samples"
          />
          <KpiCard
            icon={<Gauge className="h-4 w-4" />}
            label="CPU"
            value={`${latest?.active_cpu ?? "–"}%`}
            hint="active strategy"
          />
          <KpiCard
            icon={<Server className="h-4 w-4" />}
            label="Memory"
            value={`${latest?.memory_percent ?? "–"}%`}
            hint="pod memory"
          />
          <KpiCard
            icon={<Layers className="h-4 w-4" />}
            label="AI pods"
            value={`${latest?.inst_predictive ?? "–"}`}
            hint={`raw: ${lastPrediction.raw ? lastPrediction.raw.toFixed(2) : "waiting"}`}
          />
          <KpiCard
            icon={<ShieldCheck className="h-4 w-4" />}
            label="Threshold pods"
            value={`${latest?.inst_threshold ?? "–"}`}
            hint="baseline"
          />
          <KpiCard
            icon={<Zap className="h-4 w-4" />}
            label="Active p95"
            value={`${latest?.active_p95 ?? "–"} ms`}
            hint={latest && latest.active_p95 > 800 ? "SLA risk" : "healthy"}
          />
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="rounded-3xl border bg-white p-5 shadow-sm xl:col-span-2">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  CloudWatch traffic and pod scaling
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Gray area shows request pressure. Solid blue shows AI pods.
                  Dashed orange shows threshold pods.
                </p>
              </div>

              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span>Window</span>
                <input
                  type="range"
                  min={40}
                  max={140}
                  step={10}
                  value={windowSize}
                  onChange={(e) => setWindowSize(Number(e.target.value))}
                />
                <span className="w-12 font-medium text-slate-700">
                  {windowSize}
                </span>
              </div>
            </div>

            <div className="h-95 rounded-2xl border p-3">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={series}
                  margin={{ left: 2, right: 24, top: 10, bottom: 2 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="t" tick={{ fontSize: 11 }} minTickGap={28} />

                  <YAxis
                    yAxisId="rps"
                    tick={{ fontSize: 11 }}
                    label={{
                      value: "Requests",
                      angle: -90,
                      position: "insideLeft",
                    }}
                  />

                  <YAxis
                    yAxisId="instances"
                    orientation="right"
                    domain={[0, 5]}
                    allowDecimals={false}
                    tick={{ fontSize: 11 }}
                    label={{
                      value: "Pods",
                      angle: 90,
                      position: "insideRight",
                    }}
                  />

                  <Tooltip content={<ChartTooltip />} />
                  <Legend />

                  <Area
                    yAxisId="rps"
                    type="monotone"
                    dataKey="rps"
                    name="Requests"
                    stroke="#94a3b8"
                    fill="#94a3b8"
                    fillOpacity={0.18}
                    strokeWidth={2}
                    isAnimationActive
                    animationDuration={700}
                  />

                  <Line
                    yAxisId="instances"
                    type="stepAfter"
                    dataKey="inst_predictive"
                    name="AI pods"
                    stroke="#2563eb"
                    strokeWidth={3}
                    dot={false}
                    isAnimationActive
                    animationDuration={700}
                  />

                  <Line
                    yAxisId="instances"
                    type="stepAfter"
                    dataKey="inst_threshold"
                    name="Threshold pods"
                    stroke="#f97316"
                    strokeWidth={3}
                    strokeDasharray="6 4"
                    dot={false}
                    isAnimationActive
                    animationDuration={700}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Recent events</h2>
            <p className="mt-1 text-sm text-slate-600">
              Scaling decisions and CloudWatch-observed replica changes.
            </p>

            <div className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-2">
              {events.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-4 text-sm text-slate-500">
                  Waiting for CloudWatch metrics…
                </div>
              ) : (
                events.map((event, index) => (
                  <EventRow key={index} event={event} />
                ))
              )}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <ComparisonPanel title="Traditional threshold" tone="neutral">
            <MetricRow
              label="Avg p95 latency"
              value={`${Math.round(comparison?.avgP95Threshold ?? 0)} ms`}
            />
            <MetricRow
              label="Avg errors"
              value={`${(comparison?.avgErrThreshold ?? 0).toFixed(2)}%`}
            />
            <MetricRow
              label="SLA risk points"
              value={`${comparison?.slaRiskThreshold ?? 0}`}
            />
            <MetricRow
              label="Avg spend"
              value={`$${(comparison?.avgCostThreshold ?? 0).toFixed(2)}/hr`}
            />
          </ComparisonPanel>

          <ComparisonPanel title="AI predictive" tone="success">
            <MetricRow
              label="Avg p95 latency"
              value={`${Math.round(comparison?.avgP95Predictive ?? 0)} ms`}
            />
            <MetricRow
              label="Avg errors"
              value={`${(comparison?.avgErrPredictive ?? 0).toFixed(2)}%`}
            />
            <MetricRow
              label="SLA risk points"
              value={`${comparison?.slaRiskPredictive ?? 0}`}
            />
            <MetricRow
              label="Avg spend"
              value={`$${(comparison?.avgCostPredictive ?? 0).toFixed(2)}/hr`}
            />
          </ComparisonPanel>

          <ComparisonPanel title="Decision summary" tone="accent">
            <MetricRow
              label="Latency change"
              value={formatPct(comparison?.latencyImprovement ?? 0)}
              icon={(comparison?.latencyImprovement ?? 0) >= 0 ? "up" : "down"}
            />
            <MetricRow
              label="Error change"
              value={formatPct(comparison?.errorImprovement ?? 0)}
              icon={(comparison?.errorImprovement ?? 0) >= 0 ? "up" : "down"}
            />
            <MetricRow
              label="Cost savings"
              value={formatPct(comparison?.costSavings ?? 0)}
              icon={(comparison?.costSavings ?? 0) >= 0 ? "up" : "down"}
            />
            <MetricRow
              label="Cost tradeoff"
              value={formatUsd(comparison?.costDelta ?? 0)}
            />
            <div className="rounded-2xl border bg-slate-50 px-4 py-3 text-sm leading-5 text-slate-700">
              {comparison?.summary ?? "Waiting for enough CloudWatch samples."}
            </div>
          </ComparisonPanel>
        </section>

        <section className="rounded-3xl border bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Active strategy health</h2>
              <p className="text-sm text-slate-600">
                Metrics update using the selected active strategy.
              </p>
            </div>

            <div className="text-xs text-slate-500">
              Metrics: <span className="font-mono">/api/cloudwatch</span> | AI:{" "}
              <span className="font-mono">/api/predict</span> | Scale:{" "}
              <span className="font-mono">/api/scale</span>
            </div>
          </div>

          <div className="h-70 rounded-2xl border p-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series}
                margin={{ left: 2, right: 18, top: 10, bottom: 2 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" tick={{ fontSize: 11 }} minTickGap={28} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />

                <Line
                  type="monotone"
                  dataKey="active_p95"
                  name="p95 latency (ms)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive
                  animationDuration={700}
                />
                <Line
                  type="monotone"
                  dataKey="active_cpu"
                  name="CPU (%)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive
                  animationDuration={700}
                />
                <Line
                  type="monotone"
                  dataKey="memory_percent"
                  name="Memory (%)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive
                  animationDuration={700}
                />
                <Line
                  type="monotone"
                  dataKey="active_errors"
                  name="Errors (%)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive
                  animationDuration={700}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatusPill({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: "ok" | "warn" | "danger";
}) {
  const cls =
    variant === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : variant === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-red-200 bg-red-50 text-red-700";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium ${cls}`}
    >
      <span className="h-2 w-2 rounded-full bg-current" />
      {children}
    </span>
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
  hint: string;
}) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-slate-600">{label}</div>
        <div className="rounded-xl bg-slate-100 p-2 text-slate-600">{icon}</div>
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{hint}</div>
    </div>
  );
}

function ComparisonPanel({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "neutral" | "success" | "accent";
  children: React.ReactNode;
}) {
  const icon =
    tone === "success" ? (
      <CheckCircle2 className="h-4 w-4" />
    ) : tone === "accent" ? (
      <TrendingUp className="h-4 w-4" />
    ) : (
      <Gauge className="h-4 w-4" />
    );

  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-base font-semibold">
        <span className="rounded-xl bg-slate-100 p-2 text-slate-600">
          {icon}
        </span>
        {title}
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: "up" | "down";
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border bg-slate-50 px-4 py-3">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="inline-flex items-center gap-1 text-sm font-semibold text-slate-950">
        {icon === "up" ? <ArrowUp className="h-3.5 w-3.5" /> : null}
        {icon === "down" ? <ArrowDown className="h-3.5 w-3.5" /> : null}
        {value}
      </span>
    </div>
  );
}

function EventRow({ event }: { event: EventItem }) {
  const icon =
    event.kind === "ai" ? (
      <Brain className="h-4 w-4" />
    ) : event.kind === "threshold" ? (
      <Gauge className="h-4 w-4" />
    ) : event.kind === "scale" ? (
      <Layers className="h-4 w-4" />
    ) : event.kind === "cloudwatch" ? (
      <Server className="h-4 w-4" />
    ) : (
      <Activity className="h-4 w-4" />
    );

  return (
    <div className="flex max-w-full gap-3 rounded-2xl border bg-slate-50 p-3">
      <div className="mt-0.5 shrink-0 rounded-xl bg-white p-2 text-slate-600">
        {icon}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="text-xs text-slate-500">{event.ts}</div>
        <div className="text-sm leading-5 font-medium wrap-break-word text-slate-800">
          {event.msg}
        </div>
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-2xl border bg-white/95 p-3 text-sm shadow-lg backdrop-blur">
      <div className="mb-2 font-semibold text-slate-900">{label}</div>
      <div className="space-y-1">
        {payload.map((item: any) => (
          <div
            key={item.dataKey}
            className="flex items-center justify-between gap-6"
          >
            <span className="text-slate-600">{item.name}</span>
            <span className="font-semibold text-slate-900">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
