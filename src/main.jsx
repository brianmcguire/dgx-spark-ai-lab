import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  Box,
  CheckCircle2,
  Cpu,
  FileText,
  Gauge,
  HardDrive,
  ImageIcon,
  LockKeyhole,
  MemoryStick,
  Play,
  RefreshCcw,
  Save,
  Server,
  Settings2,
  Square,
  TerminalSquare,
  Trash2,
  Zap,
} from "lucide-react";
import {
  bestComparableSingleCodingView,
  benchmarkSeriesKey,
  benchmarkPresentationModels,
  catalogModelPresentations,
  inferenceConfigLabel,
  initialCodingBenchmarkView,
  speculativeDecodingLabel,
  summarizeBenchmarkModels,
} from "./benchmark-history.js";
import { PROVIDER_LOGO_PATHS } from "./provider-logos.js";
import "./styles.css";

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const compactNumber = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const DASHBOARD_TABS = [
  { id: "health", label: "Health Dashboard", detail: "Health, telemetry, and trends", icon: Activity },
  { id: "controller", label: "Model Controller", detail: "Primary vLLM service control", icon: TerminalSquare },
  { id: "latency", label: "Model Benchmark Lab", detail: "Coding and visual throughput benchmarks", icon: Gauge },
  { id: "settings", label: "Settings", detail: "Identity, connections, and optional services", icon: Settings2 },
];

const FALLBACK_CONFIG = {
  title: "AI Operations Lab",
  brand: "AI Operations",
  logoUrl: "/dgx-spark-icon.png",
  logoAlt: "AI Operations profile",
  subtitle: "Inference health, telemetry, and repeatable model benchmarks.",
  compute: { label: "Compute host", host: "local", connection: "local" },
  services: { pm2: { enabled: false }, gateway: { enabled: false } },
  capabilities: { modelControl: false, sparkDoctor: false, benchmarks: false },
};

function visibleTabs(config) {
  return DASHBOARD_TABS.filter(({ id }) => (
    id === "health" || id === "settings"
    || (id === "controller" && config.capabilities?.modelControl)
    || (id === "latency" && config.capabilities?.benchmarks)
  ));
}

function controlHeaders(headers = {}) {
  const token = window.localStorage.getItem("ai-lab-control-token");
  return token ? { ...headers, authorization: `Bearer ${token}` } : headers;
}

const HASH_TO_TAB = {
  dgx: "health",
  vllm: "health",
  trends: "health",
  models: "health",
  docker: "health",
  pm2: "health",
  "model-control": "controller",
  latency: "latency",
  settings: "settings",
};

function ProviderMark({ providerLogo, className = "" }) {
  const source = PROVIDER_LOGO_PATHS[providerLogo];
  if (!source) return null;
  return <span className={`provider-mark ${className}`.trim()} aria-hidden="true"><img src={source} alt="" /></span>;
}

function BrandAvatar({ source, alt }) {
  const fallbackSource = "/dgx-spark-icon.png";
  const [imageSource, setImageSource] = useState(source || fallbackSource);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setImageSource(source || fallbackSource);
    setHidden(false);
  }, [source]);

  if (hidden) return null;
  return (
    <img
      className="brand-avatar"
      src={imageSource}
      alt={alt || "Dashboard profile"}
      onError={() => {
        if (imageSource !== fallbackSource) setImageSource(fallbackSource);
        else setHidden(true);
      }}
    />
  );
}

function bytesToGb(bytes) {
  return Number(bytes || 0) / 1024 / 1024 / 1024;
}

function uptime(seconds) {
  const days = Math.floor((seconds || 0) / 86400);
  const hours = Math.floor(((seconds || 0) % 86400) / 3600);
  return `${days}d ${hours}h`;
}

function compact(value, suffix = "") {
  if (value == null || Number.isNaN(Number(value))) return "n/a";
  return `${number.format(Number(value))}${suffix}`;
}

function formatLargeNumber(value, suffix = "") {
  if (value == null || Number.isNaN(Number(value))) return "n/a";
  return `${compactNumber.format(Number(value))}${suffix}`;
}

function formatRate(value, unit = "t/s") {
  if (value == null || !Number.isFinite(Number(value))) return "collecting";
  return `${number.format(Number(value))} ${unit}`;
}

function formatLatency(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return "n/a";
  const value = Number(seconds);
  return value < 1 ? `${number.format(value * 1000)} ms` : `${number.format(value)} s`;
}

function formatProbeMs(milliseconds) {
  if (milliseconds == null || !Number.isFinite(Number(milliseconds))) return "n/a";
  const value = Number(milliseconds);
  return value < 1000 ? `${number.format(value)} ms` : `${number.format(value / 1000)} s`;
}

function formatBytesRate(bytesPerSecond) {
  if (bytesPerSecond == null || !Number.isFinite(Number(bytesPerSecond))) return "n/a";
  const value = Number(bytesPerSecond);
  if (value >= 1024 ** 2) return `${number.format(value / 1024 ** 2)} MB/s`;
  if (value >= 1024) return `${number.format(value / 1024)} KB/s`;
  return `${number.format(value)} B/s`;
}

function formatDate(value) {
  if (!value) return "n/a";
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function formatTimeLabel(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

async function api(path, options) {
  const res = await fetch(path, options ? { ...options, headers: controlHeaders(options.headers) } : options);
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(payload?.error || `Request failed: ${res.status}`);
  return payload;
}

async function streamApi(path, payload, onEvent) {
  const response = await fetch(path, {
    method: "POST",
    headers: controlHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(detail ? safeJson(detail)?.error || detail : `Request failed: ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const event of events) {
      const eventType = event.match(/^event:\s*(.+)$/m)?.[1];
      const data = event.match(/^data:\s*(.+)$/m)?.[1];
      if (!eventType || !data) continue;
      onEvent(eventType, JSON.parse(data));
    }
  }
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function StatusPill({ ok, tone, children }) {
  const resolvedTone = tone || (ok ? "ok" : "warn");
  return <span className={`status-pill ${resolvedTone}`}>{ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{children}</span>;
}

function MiniSparkline({ values = [] }) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (clean.length < 2) return null;
  const width = 220;
  const height = 56;
  const min = Math.min(0, ...clean);
  const max = Math.max(1, ...clean);
  const span = Math.max(1, max - min);
  const points = clean.map((value, index) => ({
    x: (index / (clean.length - 1)) * width,
    y: height - 3 - ((value - min) / span) * (height - 8),
  }));
  const line = points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  return (
    <svg className="metric-sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="metric-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a8d83a" stopOpacity="0.48" />
          <stop offset="100%" stopColor="#76b900" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      <path className="metric-spark-area" d={area} />
      <path className="metric-spark-line" d={line} />
    </svg>
  );
}

function SemiGauge({ percent = 0, value, label }) {
  const bounded = Math.max(0, Math.min(100, Number(percent) || 0));
  return (
    <div className="semi-gauge" role="img" aria-label={`${label}: ${number.format(bounded)} percent`}>
      <svg viewBox="0 0 180 104" aria-hidden="true">
        <path className="semi-gauge-track" pathLength="100" d="M 18 90 A 72 72 0 0 1 162 90" />
        <path className="semi-gauge-value" pathLength="100" strokeDasharray={`${bounded} 100`} d="M 18 90 A 72 72 0 0 1 162 90" />
      </svg>
      <strong>{value}</strong>
      <span className="semi-gauge-needle"><i style={{ width: `${bounded}%` }} /></span>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, detail, tone = "default", meter, gauge, sparkline }) {
  return (
    <section className={`metric-card ${tone} ${gauge != null ? "gauge-card" : ""} ${sparkline?.length ? "spark-card" : ""}`}>
      <div className="metric-head">
        <span className="metric-icon"><Icon size={18} /></span>
        <span>{label}</span>
      </div>
      {gauge != null ? <SemiGauge percent={gauge} value={value} label={label} /> : <div className="metric-value">{value}</div>}
      <div className="metric-detail">{detail}</div>
      {sparkline?.length ? <MiniSparkline values={sparkline} /> : null}
      {typeof meter === "number" && (
        <div className="meter"><span style={{ width: `${Math.max(0, Math.min(100, meter))}%` }} /></div>
      )}
    </section>
  );
}

function LiveMetricCard({ label, value, unit = "", detail, tone = "default", meter = null, priority = false }) {
  return (
    <article className={`live-metric-card ${tone} ${priority ? "priority" : ""}`} aria-label={`${label}: ${value}${unit ? ` ${unit}` : ""}`}>
      <div className="live-metric-head">
        <span>{label}</span>
        <i aria-hidden="true" />
      </div>
      <div className="live-metric-reading">
        <strong>{value}</strong>
        {unit && <small>{unit}</small>}
      </div>
      <p>{detail}</p>
      {typeof meter === "number" && (
        <div className="live-metric-meter" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, meter))}%` }} /></div>
      )}
    </article>
  );
}

function TrendChart({ points = [], series = [], min = 0, max, height = 142, hoverIndex = null, onHoverIndex, thresholds = [] }) {
  const width = 640;
  const pad = { top: 12, right: 12, bottom: 24, left: 34 };
  const plotted = points;
  const values = plotted.flatMap((point) => series.map((item) => point[item.field]).filter((value) => value != null && Number.isFinite(Number(value))));
  const yMax = max ?? Math.max(1, ...values) * 1.12;
  const yMin = min;
  const span = Math.max(1, yMax - yMin);
  const usableWidth = width - pad.left - pad.right;
  const usableHeight = height - pad.top - pad.bottom;
  const xFor = (index) => pad.left + (plotted.length <= 1 ? usableWidth : (index / (plotted.length - 1)) * usableWidth);
  const yFor = (value) => pad.top + usableHeight - ((Math.max(yMin, Math.min(yMax, Number(value))) - yMin) / span) * usableHeight;
  const chartBottom = height - pad.bottom;
  const paths = series.map((item, seriesIndex) => {
    const segments = [];
    let current = [];
    plotted.forEach((point, index) => {
      const value = point[item.field];
      if (value == null || !Number.isFinite(Number(value))) {
        if (current.length) segments.push(current);
        current = [];
        return;
      }
      if (point.modelSwitch && current.length) {
        segments.push(current);
        current = [];
      }
      current.push({ x: xFor(index), y: yFor(value) });
    });
    if (current.length) segments.push(current);
    return {
      ...item,
      gradientId: `chart-fill-${item.field.replace(/[^a-zA-Z0-9_-]/g, "-")}-${seriesIndex}`,
      path: segments.map((segment) => segment.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ")).join(" "),
      areaPaths: segments.map((segment) => `M ${segment[0].x.toFixed(1)} ${chartBottom.toFixed(1)} L ${segment.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" L ")} L ${segment.at(-1).x.toFixed(1)} ${chartBottom.toFixed(1)} Z`),
      last: segments.at(-1)?.at(-1),
    };
  });
  const modelSwitches = plotted
    .map((point, index) => ({ ...point, x: xFor(index) }))
    .filter((point) => point.modelSwitch);
  const start = plotted[0]?.collectedAt;
  const end = plotted.at(-1)?.collectedAt;
  const activeIndex = hoverIndex == null ? null : Math.max(0, Math.min(plotted.length - 1, hoverIndex));
  const hoverX = activeIndex == null ? null : xFor(activeIndex);

  if (!plotted.length || !values.length) {
    return <div className="chart-empty">Waiting for history samples.</div>;
  }

  return (
    <svg
      className="trend-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      onMouseMove={onHoverIndex ? (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const svgX = ((event.clientX - rect.left) / rect.width) * width;
        const ratio = Math.max(0, Math.min(1, (svgX - pad.left) / usableWidth));
        onHoverIndex(Math.round(ratio * Math.max(0, plotted.length - 1)));
      } : undefined}
      onMouseLeave={onHoverIndex ? () => onHoverIndex(null) : undefined}
    >
      <defs>
        {paths.map((item) => (
          <linearGradient key={item.gradientId} id={item.gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={item.color} stopOpacity="0.36" />
            <stop offset="58%" stopColor={item.color} stopOpacity="0.12" />
            <stop offset="100%" stopColor={item.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      <rect className="chart-surface" x={pad.left} y={pad.top} width={usableWidth} height={usableHeight} rx="6" />
      {thresholds.map((threshold, index) => {
        const from = Math.max(yMin, threshold.from ?? yMin);
        const to = Math.min(yMax, threshold.to ?? yMax);
        if (to <= from) return null;
        return <rect key={index} className="chart-threshold" x={pad.left} y={yFor(to)} width={usableWidth} height={Math.max(0, yFor(from) - yFor(to))} fill={threshold.color} />;
      })}
      <line className="chart-axis" x1={pad.left} y1={pad.top} x2={pad.left} y2={chartBottom} />
      <line className="chart-axis" x1={pad.left} y1={chartBottom} x2={width - pad.right} y2={chartBottom} />
      {[0.25, 0.5, 0.75].map((tick) => (
        <line className="grid-line" key={tick} x1={pad.left} y1={pad.top + usableHeight * tick} x2={width - pad.right} y2={pad.top + usableHeight * tick} />
      ))}
      {modelSwitches.map((point) => (
        <g className="model-switch-marker" key={`${point.collectedAt}-${point.modelId}`}>
          <title>{`Model changed to ${point.modelLabel || point.modelId}`}</title>
          <line x1={point.x} y1={pad.top} x2={point.x} y2={chartBottom} />
          <circle cx={point.x} cy={pad.top + 5} r="3" />
        </g>
      ))}
      <text x={pad.left} y={height - 6}>{formatTimeLabel(start)}</text>
      <text x={width - pad.right} y={height - 6} textAnchor="end">{formatTimeLabel(end)}</text>
      <text x={pad.left - 8} y={pad.top + 4} textAnchor="end">{compact(yMax)}</text>
      <text x={pad.left - 8} y={height - pad.bottom} textAnchor="end">{compact(yMin)}</text>
      {paths.map((item) => (
        <g key={item.field}>
          {item.areaPaths.map((areaPath, index) => <path className="trend-area" d={areaPath} style={{ fill: `url(#${item.gradientId})` }} key={index} />)}
          <path className="trend-line" d={item.path} style={{ "--line-color": item.color }} />
          {item.last && <>
            <circle className="trend-halo" cx={item.last.x} cy={item.last.y} r="7" style={{ "--line-color": item.color }} />
            <circle className="trend-last" cx={item.last.x} cy={item.last.y} r="3.5" style={{ "--line-color": item.color }} />
          </>}
        </g>
      ))}
      {hoverX != null && (
        <g className="chart-hover">
          <line x1={hoverX} y1={pad.top} x2={hoverX} y2={chartBottom} />
          {series.map((item) => {
            const value = plotted[activeIndex]?.[item.field];
            if (!Number.isFinite(Number(value))) return null;
            return <circle key={item.field} cx={hoverX} cy={yFor(value)} r="4.5" style={{ "--line-color": item.color }} />;
          })}
        </g>
      )}
      {onHoverIndex && <rect className="chart-hit-area" x={pad.left} y={pad.top} width={usableWidth} height={usableHeight} />}
    </svg>
  );
}

function TrendCard({ title, value, subtitle, points, series, min, max, hoverIndex, onHoverIndex, showStats = false, valueFormatter = compact, thresholds }) {
  const activeIndex = hoverIndex == null ? points.length - 1 : Math.max(0, Math.min(points.length - 1, hoverIndex));
  const activePoint = points[activeIndex] || {};
  return (
    <section className="trend-card">
      <div className="trend-head">
        <div>
          <h3>{title}</h3>
          <strong>{value}</strong>
          <span>{subtitle}</span>
        </div>
        <div className="legend">
          {series.map((item) => (
            <span key={item.field}><i style={{ background: item.color }} />{item.label}</span>
          ))}
        </div>
      </div>
      <TrendChart points={points} series={series} min={min} max={max} hoverIndex={hoverIndex} onHoverIndex={onHoverIndex} thresholds={thresholds} />
      {showStats && (
        <div className="trend-stats">
          <div className="trend-stats-head"><span>Series</span><span>{hoverIndex == null ? "Last" : formatTimeLabel(activePoint.collectedAt)}</span><span>Average</span><span>Maximum</span></div>
          {series.map((item) => {
            const values = points.map((point) => Number(point[item.field])).filter(Number.isFinite);
            const average = values.length ? values.reduce((sum, entry) => sum + entry, 0) / values.length : null;
            const maximum = values.length ? Math.max(...values) : null;
            return (
              <div className="trend-stats-row" key={item.field}>
                <span><i style={{ background: item.color }} />{item.label}</span>
                <strong>{valueFormatter(activePoint[item.field])}</strong>
                <span>{valueFormatter(average)}</span>
                <span>{valueFormatter(maximum)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TrendsPanel({ history = [] }) {
  const points = history.slice(-120);
  const latest = points.at(-1) || {};
  const healthyPct = points.length ? (points.filter((point) => point.healthScore === 100).length / points.length) * 100 : null;
  const modelAndPm2Max = Math.max(1024, ...points.flatMap((point) => [point.modelRssMb || 0, point.pm2MemoryMb || 0]));

  return (
    <section className="panel wide trend-panel trend-subsection">
      <div className="panel-title">
        <div>
          <h2>System Resources</h2>
          <p>{points.length ? `${points.length} retained samples from the dashboard collector.` : "Trends will populate as the collector refreshes."}</p>
        </div>
        <StatusPill ok={(latest.healthScore ?? 0) === 100}>{(latest.healthScore ?? 0) === 100 ? "healthy" : "watching"}</StatusPill>
      </div>
      <div className="trend-grid">
        <TrendCard
          title="Overall health"
          value={healthyPct == null ? "n/a" : `${number.format(healthyPct)}% OK`}
          subtitle={`DGX ${latest.dgxOk ? "reachable" : "offline"} · PM2 ${latest.pm2Ok ? "online" : "offline"}`}
          points={points}
          min={0}
          max={100}
          series={[{ field: "healthScore", label: "health", color: "#7cf0c2" }]}
        />
        <TrendCard
          title="DGX memory used"
          value={compact(latest.memoryUsedPct, "%")}
          subtitle={`${compact(latest.memoryAvailableGb, " GB")} available`}
          points={points}
          min={0}
          max={100}
          series={[{ field: "memoryUsedPct", label: "used", color: "#f2c46d" }]}
        />
        <TrendCard
          title="GPU utilization"
          value={compact(latest.gpuUtil, "%")}
          subtitle={`${compact(latest.gpuTemp, " C")} · ${compact(latest.gpuPower, " W")}`}
          points={points}
          min={0}
          max={100}
          series={[{ field: "gpuUtil", label: "util", color: "#53b7ff" }]}
        />
        <TrendCard
          title="Process memory"
          value={compact(latest.modelRssMb, " MB")}
          subtitle={`${compact(latest.pm2MemoryMb, " MB")} across PM2 services`}
          points={points}
          min={0}
          max={modelAndPm2Max}
          series={[
            { field: "modelRssMb", label: "models", color: "#34d399" },
            { field: "pm2MemoryMb", label: "pm2", color: "#c084fc" },
          ]}
        />
      </div>
    </section>
  );
}

function LlmMetricsPanel({ dgx, liveVllm, history = [] }) {
  const metrics = liveVllm?.ok ? liveVllm.metrics : dgx?.vllm?.metrics;
  const latest = history.at(-1) || {};
  const historyTotalRate = Number.isFinite(latest.promptTokensPerSecond) && Number.isFinite(latest.generationTokensPerSecond)
    ? latest.promptTokensPerSecond + latest.generationTokensPerSecond
    : null;
  const requestRate = formatRate(metrics?.rates?.requestsPerSecond ?? latest.requestsPerSecond, "req/s");
  const totalRate = formatRate(metrics?.rates?.totalTokensPerSecond ?? historyTotalRate);
  const inputRate = formatRate(metrics?.rates?.promptTokensPerSecond ?? latest.promptTokensPerSecond);
  const outputRate = formatRate(metrics?.rates?.generationTokensPerSecond ?? latest.generationTokensPerSecond);
  const activeOrWaiting = (metrics?.queue?.running || 0) + (metrics?.queue?.waiting || 0);
  const rawOutputRate = metrics?.rates?.generationTokensPerSecond ?? latest.generationTokensPerSecond;
  const perRequestOutputRate = activeOrWaiting > 0 && Number.isFinite(rawOutputRate)
    ? rawOutputRate / activeOrWaiting
    : null;
  const cacheUsage = metrics?.cache?.kvUsagePct;
  const prefixHitRate = metrics?.cache?.prefixHitRatePct;
  const requestErrors = metrics?.requests?.errors || 0;
  const recent = history.slice(-30);
  const totalRateHistory = recent.map((point) => Number(point.promptTokensPerSecond || 0) + Number(point.generationTokensPerSecond || 0));
  const outputRateHistory = recent.map((point) => Number(point.generationTokensPerSecond || 0));
  const rawInputRate = metrics?.rates?.promptTokensPerSecond ?? latest.promptTokensPerSecond;
  const runningRequests = Number(metrics?.queue?.running || 0);
  const waitingRequests = Number(metrics?.queue?.waiting || 0);
  const liveMetricValue = (value) => Number.isFinite(Number(value)) ? number.format(Number(value)) : "n/a";

  return (
    <section className="panel wide vllm-panel" id="vllm">
      <div className="panel-title">
        <div>
          <h2>vLLM Telemetry</h2>
          <p>Native counters and latency histograms from vLLM. TPS cards refresh every five seconds; retained trends use the dashboard collector.</p>
        </div>
        <StatusPill ok={metrics?.available}>{liveVllm?.ok ? "live 5s" : metrics?.available ? "snapshot" : "unavailable"}</StatusPill>
      </div>
      {metrics?.available ? (
        <>
          <div className="vllm-live-grid" aria-label="Live inference metrics">
            <LiveMetricCard label="Decode throughput" value={liveMetricValue(rawOutputRate)} unit="tok/s" detail="Generated tokens per second" tone={Number(rawOutputRate) > 0 ? "good" : "default"} priority />
            <LiveMetricCard label="Prompt throughput" value={liveMetricValue(rawInputRate)} unit="tok/s" detail="Prompt tokens processed per second" tone={Number(rawInputRate) > 0 ? "good" : "default"} priority />
            <LiveMetricCard label="Running requests" value={liveMetricValue(runningRequests)} detail="Active inference sequences" tone={runningRequests > 0 ? "good" : "default"} />
            <LiveMetricCard label="Queued requests" value={liveMetricValue(waitingRequests)} detail={waitingRequests > 0 ? "Waiting for inference capacity" : "No requests waiting"} tone={waitingRequests > 0 ? "warn" : "good"} />
            <LiveMetricCard label="KV cache usage" value={liveMetricValue(cacheUsage)} unit={cacheUsage == null ? "" : "%"} detail={prefixHitRate == null ? "No prefix-cache queries yet" : `${number.format(prefixHitRate)}% prefix hit rate`} tone={Number(cacheUsage) >= 85 ? "warn" : "good"} meter={cacheUsage} />
          </div>
          <div className="vllm-grid vllm-secondary-grid">
            <MetricCard icon={Activity} label="Total tokens" value={formatLargeNumber(metrics.totalTokens)} detail={`${formatLargeNumber(metrics.promptTokens)} input · ${formatLargeNumber(metrics.generationTokens)} output`} />
            <MetricCard icon={Gauge} label="Total TPS" value={totalRate} detail={`Input ${inputRate} · Output ${outputRate}`} tone={metrics.rates?.totalTokensPerSecond > 0 ? "good" : "default"} sparkline={totalRateHistory} />
            <MetricCard icon={Activity} label="Per-request Output TPS" value={perRequestOutputRate == null ? "idle" : formatRate(perRequestOutputRate)} detail={activeOrWaiting ? `${number.format(activeOrWaiting)} active or waiting request${activeOrWaiting === 1 ? "" : "s"}` : "Available while requests are active or queued"} tone={perRequestOutputRate > 0 ? "good" : "default"} />
            <MetricCard icon={Gauge} label="Request outcomes" value={`${formatLargeNumber(metrics.requests?.successful)} ok`} detail={`${requestRate} · ${requestErrors} errors · ${formatLargeNumber(metrics.toolCalls)} tool parses`} tone={requestErrors ? "warn" : "good"} />
            <MetricCard icon={Zap} label="Time to first token p95" value={formatLatency(metrics.latency?.ttftP95Seconds)} detail={`Queue p95 ${formatLatency(metrics.latency?.queueP95Seconds)}`} />
            <MetricCard icon={Gauge} label="End-to-end latency p95" value={formatLatency(metrics.latency?.e2eP95Seconds)} detail={`Inter-token p95 ${formatLatency(metrics.latency?.interTokenP95Seconds)}`} />
          </div>
        </>
      ) : (
        <div className="offline-box"><AlertTriangle size={18} /><div><strong>vLLM metrics are not available.</strong><span>The model endpoint is reachable separately, but the telemetry endpoint did not return Prometheus samples.</span></div></div>
      )}
    </section>
  );
}

function LlmTrendsPanel({ history = [] }) {
  const points = history.slice(-120);
  const latest = points.at(-1) || {};
  return (
    <section className="panel wide trend-panel trend-subsection">
      <div className="panel-title">
        <div>
          <h2>LLM Performance</h2>
          <p>Rates are calculated between dashboard collections; latency values are vLLM p95 histogram bounds.</p>
        </div>
      </div>
      <div className="trend-grid llm-trend-grid">
        <TrendCard
          title="Token throughput"
          value={formatRate(latest.promptTokensPerSecond)}
          subtitle={`Output ${formatRate(latest.generationTokensPerSecond)}`}
          points={points}
          series={[
            { field: "promptTokensPerSecond", label: "input", color: "#53b7ff" },
            { field: "generationTokensPerSecond", label: "output", color: "#34d399" },
          ]}
          showStats
          valueFormatter={(value) => formatRate(value)}
        />
        <TrendCard
          title="Requests and queue"
          value={formatRate(latest.requestsPerSecond, "req/s")}
          subtitle={`${number.format(latest.vllmRunning || 0)} running · ${number.format(latest.vllmWaiting || 0)} waiting`}
          points={points}
          min={0}
          series={[
            { field: "vllmRunning", label: "running", color: "#f2c46d" },
            { field: "vllmWaiting", label: "waiting", color: "#f47b67" },
          ]}
          showStats
        />
        <TrendCard
          title="Latency p95"
          value={`TTFT ${formatLatency(latest.ttftP95Seconds)}`}
          subtitle={`End-to-end ${formatLatency(latest.e2eP95Seconds)}`}
          points={points}
          min={0}
          series={[
            { field: "ttftP95Seconds", label: "TTFT", color: "#c084fc" },
            { field: "e2eP95Seconds", label: "end-to-end", color: "#f2c46d" },
          ]}
          showStats
          valueFormatter={formatLatency}
        />
      </div>
    </section>
  );
}

function PerformanceTrendsSection({ history = [] }) {
  return (
    <section className="performance-trends-group" id="trends">
      <div className="performance-trends-heading">
        <div>
          <span>Retained telemetry</span>
          <h2>Performance Trends</h2>
          <p>Correlate LLM throughput and latency with the system resources supporting each request.</p>
        </div>
      </div>
      <LlmTrendsPanel history={history} />
      <TrendsPanel history={history} />
    </section>
  );
}

function DistributionBars({ title, subtitle, bands = [], color = "#76b900" }) {
  const maximum = Math.max(1, ...bands.map((band) => band.count || 0));
  return (
    <section className="diagnostic-block distribution-block">
      <div className="diagnostic-block-title"><div><h3>{title}</h3><p>{subtitle}</p></div></div>
      <div className="distribution-bars">
        {bands.map((band) => (
          <div className="distribution-row" key={band.label}>
            <span>{band.label}</span>
            <div className="distribution-track"><i style={{ width: `${((band.count || 0) / maximum) * 100}%`, "--bar-color": color }} /></div>
            <strong>{formatLargeNumber(band.count)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function InferenceDiagnosticsPanel({ dgx, liveVllm, history = [] }) {
  const [rangeMinutes, setRangeMinutes] = useState(60);
  const [hoverIndex, setHoverIndex] = useState(null);
  const metrics = liveVllm?.ok ? liveVllm.metrics : dgx?.vllm?.metrics;
  const latestTimestamp = new Date(history.at(-1)?.collectedAt || Date.now()).getTime();
  const points = history.filter((point) => new Date(point.collectedAt).getTime() >= latestTimestamp - rangeMinutes * 60 * 1000);
  const latest = points.at(-1) || {};
  const speculative = metrics?.speculative || {};
  const endpoint = metrics?.endpoints || {};
  const acceptedPct = speculative.acceptanceRatePct;
  const rejectedPct = acceptedPct == null ? 0 : Math.max(0, 100 - acceptedPct);
  const thresholdBands = (metric) => {
    const profile = latest.latencyThresholds?.[metric];
    if (!profile) return [];
    return [
      { to: profile.good, color: "rgba(118, 185, 0, 0.08)" },
      { from: profile.good, to: profile.watch, color: "rgba(242, 196, 109, 0.07)" },
      { from: profile.watch, color: "rgba(244, 123, 103, 0.06)" },
    ];
  };
  const latencyCards = [
    {
      title: "Time to first token",
      prefix: "ttft",
      latest: latest.ttftP95Seconds,
      thresholds: thresholdBands("ttft"),
    },
    {
      title: "Queue time",
      prefix: "queue",
      latest: latest.queueP95Seconds,
      thresholds: thresholdBands("queue"),
    },
    {
      title: "End-to-end latency",
      prefix: "e2e",
      latest: latest.e2eP95Seconds,
      thresholds: thresholdBands("e2e"),
    },
    {
      title: "Inter-token latency",
      prefix: "interToken",
      latest: latest.interTokenP95Seconds,
      thresholds: thresholdBands("interToken"),
    },
  ];
  const percentileSeries = (prefix) => [
    { field: `${prefix}P50Seconds`, label: "p50", color: "#a3e635" },
    { field: `${prefix}P95Seconds`, label: "p95", color: "#f2c46d" },
    { field: `${prefix}P99Seconds`, label: "p99", color: "#f47b67" },
  ];

  return (
    <section className="panel wide diagnostics-panel" id="inference-diagnostics">
      <div className="panel-title diagnostics-title">
        <div>
          <h2>Inference Diagnostics</h2>
          <p>Speculative decoding, latency percentiles, request shape, endpoint health, and host pressure.</p>
          <span className="diagnostic-model-context">{latest.modelLabel ? `Threshold profile: ${latest.modelLabel}` : "Threshold profile: default"}</span>
        </div>
        <div className="range-control" aria-label="Diagnostic time range">
          {[15, 60, 360, 1440].map((minutes) => (
            <button key={minutes} type="button" className={rangeMinutes === minutes ? "active" : ""} onClick={() => { setRangeMinutes(minutes); setHoverIndex(null); }}>
              {minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
            </button>
          ))}
        </div>
      </div>

      <div className="diagnostic-summary-grid">
        <section className="diagnostic-block speculative-block">
          <div className="diagnostic-block-title">
            <div><h3>Speculative decoding</h3><p>MTP draft-token efficiency for the active model.</p></div>
            <strong>{acceptedPct == null ? "n/a" : `${number.format(acceptedPct)}% accepted`}</strong>
          </div>
          <SemiGauge percent={acceptedPct || 0} value={acceptedPct == null ? "n/a" : `${number.format(acceptedPct)}%`} label="Speculative decode acceptance" />
          <div className="spec-meter" aria-label={`${number.format(acceptedPct || 0)} percent of speculative tokens accepted`}>
            <i className="accepted" style={{ width: `${acceptedPct || 0}%` }} />
            <i className="rejected" style={{ width: `${rejectedPct}%` }} />
          </div>
          <div className="spec-counts">
            <span><i className="accepted" />{formatLargeNumber(speculative.acceptedTokens)} accepted</span>
            <span><i className="rejected" />{formatLargeNumber(speculative.rejectedTokens)} rejected</span>
            <span>{formatLargeNumber(speculative.draftTokens)} drafted</span>
          </div>
          <div className="position-bars">
            {(speculative.byPosition || []).length ? speculative.byPosition.map((position) => (
              <div className="position-row" key={position.position}>
                <span>Position {position.position}</span>
                <div><i style={{ width: `${Math.max(0, Math.min(100, position.acceptanceRatePct || 0))}%` }} /></div>
                <strong>{position.acceptanceRatePct == null ? "n/a" : `${number.format(position.acceptanceRatePct)}%`}</strong>
              </div>
            )) : <p className="diagnostic-empty">The active model is not reporting speculative-token positions.</p>}
          </div>
        </section>

        <section className="diagnostic-block endpoint-block">
          <div className="diagnostic-block-title"><div><h3>Endpoint performance</h3><p>Observed from the Mac Mini gateway host.</p></div></div>
          <div className="endpoint-rows">
            <div><StatusPill ok={endpoint.models?.ok}>{endpoint.models?.ok ? "available" : "unavailable"}</StatusPill><span>/v1/models</span><strong>{formatProbeMs(endpoint.models?.latencyMs)}</strong></div>
            <div><StatusPill ok={endpoint.metrics?.ok}>{endpoint.metrics?.ok ? "available" : "unavailable"}</StatusPill><span>/metrics</span><strong>{formatProbeMs(endpoint.metrics?.latencyMs)}</strong></div>
            <div><StatusPill ok={endpoint.chatCompletions?.ok}>{endpoint.chatCompletions?.ok ? "healthy" : "watch"}</StatusPill><span>/v1/chat/completions</span><strong>{formatLatency(endpoint.chatCompletions?.p95LatencySeconds)} p95</strong></div>
            <div><StatusPill ok={endpoint.syntheticCompletion?.ok}>{endpoint.syntheticCompletion?.ok ? "verified" : endpoint.syntheticCompletion ? "failed" : "pending"}</StatusPill><span>Synthetic completion</span><strong>{formatProbeMs(endpoint.syntheticCompletion?.latencyMs)}</strong></div>
            <div><StatusPill ok={endpoint.models?.ok}>{endpoint.models?.ok ? "connected" : "unavailable"}</StatusPill><span>Gateway → vLLM</span><strong>{formatProbeMs(endpoint.gatewayToVllmLatencyMs)}</strong></div>
          </div>
          <p className="endpoint-note">{formatLargeNumber(endpoint.chatCompletions?.observedRequests)} observed completions · {number.format(endpoint.chatCompletions?.errors || 0)} errors · synthetic check every 10 minutes</p>
        </section>
      </div>

      <div className="diagnostic-section-head"><div><h3>Latency Percentiles</h3><p>Hover any chart to inspect the same retained timestamp across all four.</p></div><span>{points.length} samples</span></div>
      <div className="latency-diagnostic-grid">
        {latencyCards.map((card) => (
          <TrendCard
            key={card.prefix}
            title={card.title}
            value={`p95 ${formatLatency(card.latest)}`}
            subtitle="Typical, tail, and outlier latency"
            points={points}
            min={0}
            series={percentileSeries(card.prefix)}
            hoverIndex={hoverIndex}
            onHoverIndex={setHoverIndex}
            showStats
            valueFormatter={formatLatency}
            thresholds={card.thresholds}
          />
        ))}
      </div>

      <div className="diagnostic-section-head"><div><h3>Request Shape</h3><p>Lifetime request counts grouped by prompt and generated-token size.</p></div></div>
      <div className="distribution-grid">
        <DistributionBars title="Prompt-size distribution" subtitle="Prefill tokens per request" bands={metrics?.requestSize?.prompt || []} color="#53b7ff" />
        <DistributionBars title="Output-size distribution" subtitle="Generated tokens per request" bands={metrics?.requestSize?.output || []} color="#a3e635" />
      </div>

      <div className="diagnostic-section-head"><div><h3>Resource Pressure</h3><p>DGX host utilization during inference and model loading.</p></div></div>
      <div className="resource-diagnostic-grid">
        <TrendCard
          title="Memory"
          value={`${compact(latest.memoryUsedGb, " GB")} used`}
          subtitle={`${compact(latest.memoryAvailableGb, " GB")} available · ${compact(latest.memoryCachedGb, " GB")} cache`}
          points={points}
          min={0}
          series={[
            { field: "memoryUsedGb", label: "used", color: "#f2c46d" },
            { field: "memoryAvailableGb", label: "available", color: "#a3e635" },
            { field: "memoryCachedGb", label: "cache", color: "#53b7ff" },
          ]}
          showStats
          valueFormatter={(value) => compact(value, " GB")}
        />
        <TrendCard
          title="CPU pressure"
          value={`${compact(latest.cpuUserPct, "%")} user`}
          subtitle={`${compact(latest.cpuSystemPct, "%")} system · ${compact(latest.cpuIowaitPct, "%")} I/O wait`}
          points={points}
          min={0}
          series={[
            { field: "cpuUserPct", label: "user", color: "#a3e635" },
            { field: "cpuSystemPct", label: "system", color: "#53b7ff" },
            { field: "cpuIowaitPct", label: "I/O wait", color: "#f47b67" },
          ]}
          showStats
          valueFormatter={(value) => compact(value, "%")}
        />
        <TrendCard
          title="Network throughput"
          value={`RX ${formatBytesRate(latest.networkRxBytesPerSecond)}`}
          subtitle={`TX ${formatBytesRate(latest.networkTxBytesPerSecond)}`}
          points={points}
          min={0}
          series={[
            { field: "networkRxBytesPerSecond", label: "receive", color: "#53b7ff" },
            { field: "networkTxBytesPerSecond", label: "transmit", color: "#a3e635" },
          ]}
          showStats
          valueFormatter={formatBytesRate}
        />
        <TrendCard
          title="Disk throughput"
          value={`Read ${formatBytesRate(latest.diskReadBytesPerSecond)}`}
          subtitle={`Write ${formatBytesRate(latest.diskWriteBytesPerSecond)}`}
          points={points}
          min={0}
          series={[
            { field: "diskReadBytesPerSecond", label: "read", color: "#c084fc" },
            { field: "diskWriteBytesPerSecond", label: "write", color: "#f2c46d" },
          ]}
          showStats
          valueFormatter={formatBytesRate}
        />
      </div>
    </section>
  );
}

function ModelControlPanel() {
  const [control, setControl] = useState(null);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const loadingRef = useRef(false);

  async function loadControl() {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const next = await api("/api/models/control");
      setControl(next);
    } finally {
      loadingRef.current = false;
    }
  }

  useEffect(() => {
    let disposed = false;
    const refresh = () => loadControl().catch((err) => {
      if (!disposed) setError(err.message);
    });
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  async function sendAction(action, modelKey) {
    const isSwitch = action === "activate" && modelKey !== control?.activeModelKey;
    const isStop = action === "stop";
    if ((isSwitch || isStop) && !window.confirm(isSwitch
      ? "Switch the active vLLM model? The shared LLM endpoint will be unavailable while the new model loads."
      : "Stop the vLLM model? OpenClaw, A2V, and AI Assessment will not receive LLM responses until it is started again.")) return;

    setPending(`${action}:${modelKey || "service"}`);
    setError("");
    try {
      const next = await api("/api/models/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, modelKey }),
      });
      setControl(next);
      window.setTimeout(() => loadControl().catch(() => {}), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending("");
    }
  }

  const service = control?.service;
  const activeModel = control?.models?.find((model) => model.active);
  const activeSpeculativeDecoding = speculativeDecodingLabel(activeModel?.inferenceConfig, null);
  const serviceReady = service?.state === "ready";
  const serviceOnline = service?.pm2Status === "online";

  return (
    <section className="panel wide model-control-panel" id="model-control">
      <div className="panel-title">
        <div>
          <h2>Model Control</h2>
          <p>Start, stop, or replace the primary vLLM model with an allowlisted checkpoint downloaded on the DGX Spark.</p>
        </div>
        <div className="model-control-header-actions">
          <StatusPill ok={serviceReady}>{serviceReady ? "vLLM ready" : serviceOnline ? "model loading" : "model stopped"}</StatusPill>
          <button className="icon-button" onClick={() => loadControl().catch((err) => setError(err.message))} disabled={Boolean(pending)} title="Refresh model status"><RefreshCcw size={16} /></button>
        </div>
      </div>

      <div className="model-service-bar">
        <div>
          <span>Service</span>
          <strong>{service?.pm2Status || "checking"}</strong>
          <small>{activeModel ? `${activeModel.provider} · ${activeModel.precision} · ${activeModel.context}${activeSpeculativeDecoding ? ` · ${activeSpeculativeDecoding}` : ""}` : "No model configuration selected"}</small>
        </div>
        <div>
          <span>Aliases</span>
          <strong>{service?.servedNames?.length ? service.servedNames.join(", ") : "Not serving"}</strong>
          <small>Applications continue using their configured alias after a model switch.</small>
        </div>
        <div className="model-service-actions">
          <button className="primary" onClick={() => sendAction("start")} disabled={Boolean(pending) || serviceOnline || !activeModel}><Play size={15} />Start</button>
          <button className="stop-button" onClick={() => sendAction("stop")} disabled={Boolean(pending) || !serviceOnline}><Square size={14} />Stop</button>
          <button className="clear-button" onClick={() => sendAction("restart")} disabled={Boolean(pending) || !activeModel}><RefreshCcw size={15} />Restart</button>
        </div>
      </div>

      {error && <div className="error-banner model-control-error"><AlertTriangle size={18} />{error}</div>}
      {control?.lastAction && <div className={`model-control-feedback ${control.lastAction.ok ? "ok" : "error"}`}>{control.lastAction.error || `${control.lastAction.label} at ${formatTimeLabel(control.lastAction.at)}. The panel will show ready once vLLM finishes loading.`}</div>}

      <div className="model-control-grid">
        {(control?.models || []).map((model) => {
          const pendingActivation = pending === `activate:${model.key}`;
          const loading = model.loading || pendingActivation;
          const progress = model.loadProgress || (pendingActivation ? {
            percent: 3,
            phase: "Preparing runtime",
            detail: "Starting the model replacement workflow.",
            elapsedSeconds: 0,
            memoryUsedGb: control?.service?.memoryUsedGb,
            loadedMemoryGb: 0,
          } : null);
          const status = model.active
            ? "active"
            : loading
              ? "loading"
              : model.setupRequired
                ? "discovered"
                : model.installed
                  ? model.status === "ready" ? "ready" : "staged"
                  : "unavailable";
          const elapsedMinutes = Math.floor((progress?.elapsedSeconds || 0) / 60);
          const elapsedSeconds = (progress?.elapsedSeconds || 0) % 60;
          const elapsedLabel = elapsedMinutes ? `${elapsedMinutes}m ${String(elapsedSeconds).padStart(2, "0")}s` : `${elapsedSeconds}s`;
          return (
          <article className={`model-control-card ${model.active ? "active" : ""} ${loading ? "loading" : ""}`} key={model.key}>
            <div className="model-control-card-head">
              <div className="model-provider-heading">
                <ProviderMark providerLogo={model.providerLogo} />
                <div>
                  <span className="eyebrow">{model.provider}</span>
                  <h3>{model.label}</h3>
                </div>
              </div>
              <StatusPill ok={status === "active" || status === "ready"} tone={status}>{status === "loading" && progress ? `loading ${progress.percent}%` : status}</StatusPill>
            </div>
            <p>{model.description}</p>
            <dl>
              <div><dt>Parameters</dt><dd>{model.parameters || "n/a"}</dd></div>
              <div><dt>Architecture</dt><dd>{model.architecture || "n/a"}</dd></div>
              <div><dt>Format</dt><dd>{model.precision}</dd></div>
              <div><dt>Context</dt><dd>{model.context}</dd></div>
              <div><dt>Checkpoint size</dt><dd>{model.checkpointSize || "n/a"}</dd></div>
              <div><dt>KV cache</dt><dd>{model.kvCache}</dd></div>
              {model.speculativeDecoding && <div><dt>Speculative decoding</dt><dd>{speculativeDecodingLabel(model.inferenceConfig)} · {model.speculativeDecoding.draftTokens} draft tokens</dd></div>}
              <div><dt>Checkpoint</dt><dd>{model.installed ? "downloaded" : "not found"}</dd></div>
              <div><dt>Inputs</dt><dd>{model.modalities}</dd></div>
              <div className="model-workload"><dt>Best for</dt><dd>{model.bestFor || "n/a"}</dd></div>
            </dl>
            <code>{model.repository}</code>
            {loading && progress && (
              <div className="model-load-progress" aria-live="polite">
                <div className="model-load-progress-heading">
                  <div>
                    <strong>{progress.phase}</strong>
                    <span>{progress.detail}</span>
                  </div>
                  <b>{progress.percent}%</b>
                </div>
                <div
                  className="model-load-progress-track"
                  role="progressbar"
                  aria-label={`${model.label} loading progress`}
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={progress.percent}
                >
                  <span style={{ width: `${progress.percent}%` }} />
                </div>
                <div className="model-load-progress-meta">
                  <span>Elapsed <strong>{elapsedLabel}</strong></span>
                  {Number.isFinite(progress.memoryUsedGb) && <span>System memory <strong>{progress.memoryUsedGb.toFixed(1)} GB</strong></span>}
                  {Number.isFinite(progress.loadedMemoryGb) && progress.loadedMemoryGb > 0.05 && <span>Loaded <strong>+{progress.loadedMemoryGb.toFixed(1)} GB</strong></span>}
                </div>
              </div>
            )}
            <div className="model-card-actions">
              {loading ? (
                <button className="clear-button model-loading-button" disabled><RefreshCcw className="spin" size={15} />Loading {progress?.percent || 0}%</button>
              ) : model.active ? (
                <button className="clear-button" onClick={() => sendAction("restart")} disabled={Boolean(pending)}><RefreshCcw size={15} />Restart Active</button>
              ) : model.setupRequired ? (
                <button className="clear-button" disabled title="Add a reviewed launch profile to config/models.local.json before starting this checkpoint."><AlertTriangle size={15} />Setup Required</button>
              ) : (
                <button className="primary" onClick={() => sendAction("activate", model.key)} disabled={!model.installed || Boolean(pending)}><Play size={15} />Replace Primary</button>
              )}
            </div>
          </article>
          );
        })}
      </div>
    </section>
  );
}

function ModelBenchmarkComparison({
  history = [],
  catalogModels = [],
  benchmarkType = "coding",
  suiteId = "",
  suites = {},
  profile = "",
  maxTokens = 0,
  parallel = 1,
  onShowSingleHistory,
}) {
  const modelPresentation = useMemo(() => catalogModelPresentations(catalogModels), [catalogModels]);
  const selectedSuite = suiteId ? suites[suiteId] : null;
  const models = useMemo(() => {
    const grouped = new Map();
    const addResult = (entry, tps, ttft, caseCount = 1) => {
      if (!entry?.model || !Number.isFinite(tps) || tps <= 0) return;
      const key = benchmarkSeriesKey(entry);
      const current = grouped.get(key) || {
        key,
        model: entry.model,
        inferenceConfig: entry.inferenceConfig || null,
        tps: [],
        ttft: [],
        runs: 0,
        cases: 0,
      };
      current.tps.push(tps);
      if (Number.isFinite(ttft)) current.ttft.push(ttft);
      current.runs += 1;
      current.cases += caseCount;
      grouped.set(key, current);
    };

    if (selectedSuite) {
      const expectedCases = new Set(selectedSuite.cases.map((item) => item.id));
      const suiteRuns = new Map();

      for (const entry of history) {
        if (entry.benchmarkType === "visual" || entry.suiteId !== suiteId || !entry.suiteRunId || !entry.model) continue;
        const key = `${entry.model}:${entry.suiteRunId}`;
        const run = suiteRuns.get(key) || { model: entry.model, cases: new Map() };
        run.cases.set(entry.suiteCaseId, entry);
        suiteRuns.set(key, run);
      }

      for (const run of suiteRuns.values()) {
        const entries = [...expectedCases].map((caseId) => run.cases.get(caseId));
        const complete = entries.every((entry) => entry
          && entry.summary?.failed === 0
          && entry.summary?.completed === entry.parallel);
        if (!complete) continue;

        const throughputs = entries.map((entry) => {
          const aggregate = Number(entry.summary?.aggregateGenerationTokensPerSecond);
          if (Number.isFinite(aggregate) && aggregate > 0) return aggregate;
          const perStream = Number(entry.summary?.avgGenerationTokensPerSecond);
          return perStream * Number(entry.summary?.completed || 1);
        });
        if (throughputs.some((value) => !Number.isFinite(value) || value <= 0)) continue;
        const ttfts = entries.map((entry) => Number(entry.summary?.avgTtftMs)).filter(Number.isFinite);
        addResult(
          entries[0],
          throughputs.reduce((total, value) => total + value, 0) / throughputs.length,
          ttfts.length ? ttfts.reduce((total, value) => total + value, 0) / ttfts.length : null,
          entries.length,
        );
      }
    } else {
      for (const entry of history) {
        const matchingType = benchmarkType === "visual" ? entry.benchmarkType === "visual" : entry.benchmarkType !== "visual";
        if (!matchingType || entry.suiteId) continue;
        if (entry.profile !== profile || Number(entry.maxTokens) !== Number(maxTokens) || Number(entry.parallel) !== Number(parallel)) continue;

        addResult(
          entry,
          Number(entry.summary?.avgGenerationTokensPerSecond),
          Number(entry.summary?.avgTtftMs),
        );
      }
    }

    return [...grouped.values()]
      .map((item) => ({
        ...item,
        averageTps: item.tps.reduce((total, value) => total + value, 0) / item.tps.length,
        averageTtftMs: item.ttft.length ? item.ttft.reduce((total, value) => total + value, 0) / item.ttft.length : null,
      }))
      .sort((left, right) => {
        const throughputDifference = right.averageTps - left.averageTps;
        if (throughputDifference) return throughputDifference;

        const leftTtft = left.averageTtftMs ?? Number.POSITIVE_INFINITY;
        const rightTtft = right.averageTtftMs ?? Number.POSITIVE_INFINITY;
        const ttftDifference = leftTtft - rightTtft;
        return ttftDifference || left.model.localeCompare(right.model);
      });
  }, [benchmarkType, history, maxTokens, parallel, profile, selectedSuite, suiteId]);

  const maxTps = models[0]?.averageTps || 0;
  const totalTests = models.reduce((total, item) => total + item.runs, 0);
  const savedSingleRuns = history.filter((entry) => (
    (entry.historyCategory || entry.benchmarkType || "coding") === "coding"
    && !entry.suiteId
    && Number(entry.summary?.completed || 0) > 0
  )).length;

  return (
    <section className="benchmark-comparison" aria-labelledby="model-throughput-title">
      <div className="benchmark-comparison-head">
        <div>
          <span className="comparison-kicker">Saved benchmark history</span>
          <h3 id="model-throughput-title">{benchmarkType === "visual" ? "Visual Model Leaderboard" : "Model Leaderboard"}</h3>
        </div>
        <span>{totalTests} completed {selectedSuite ? `suite${totalTests === 1 ? "" : "s"}` : `test${totalTests === 1 ? "" : "s"}`}</span>
      </div>

      {models.length ? (
        <div className="model-throughput-list">
          {models.map((item) => {
            const width = Math.max(5, (item.averageTps / maxTps) * 100);
            const presentation = modelPresentation.get(item.model);
            const baseDisplayName = presentation?.displayName || item.model;
            const configurationName = speculativeDecodingLabel(item.inferenceConfig, null);
            const displayName = configurationName ? `${baseDisplayName} · ${configurationName}` : baseDisplayName;
            return (
              <div className="model-throughput-row" key={item.key}>
                <div className="model-throughput-label" title={item.model}><ProviderMark providerLogo={presentation?.providerLogo} /><span>{displayName}</span></div>
                <div className="model-throughput-track" aria-label={`${displayName}: ${formatRate(item.averageTps)} average generation throughput`}>
                  <div className="model-throughput-fill" style={{ width: `${width}%` }} />
                </div>
                <div className="model-throughput-value">
                  <strong>{formatRate(item.averageTps)}</strong>
                  <span>{item.runs} {selectedSuite ? "suite" : "run"}{item.runs === 1 ? "" : "s"} · TTFT {formatProbeMs(item.averageTtftMs)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="chart-empty benchmark-comparison-empty">
          <span>{selectedSuite ? `No complete ${selectedSuite.label} is stored yet.` : `Run this exact ${benchmarkType === "visual" ? "visual analysis" : "coding"} configuration to compare models here.`}</span>
          {selectedSuite && savedSingleRuns > 0 && onShowSingleHistory && (
            <button type="button" className="clear-button" onClick={onShowSingleHistory}>Show {savedSingleRuns} saved single-scenario run{savedSingleRuns === 1 ? "" : "s"}</button>
          )}
        </div>
      )}

      <p className="benchmark-comparison-note">
        {selectedSuite
          ? `Only complete ${selectedSuite.label} runs are ranked. All ${selectedSuite.cases.length} cases are weighted equally; the two-stream case uses aggregate throughput.`
          : `Filtered to ${profile || "the selected task"}, ${maxTokens} output tokens, and ${parallel} parallel stream${Number(parallel) === 1 ? "" : "s"}.`}
      </p>
    </section>
  );
}

function SavedModelHistory({ history = [], catalogModels = [], benchmarkType = "coding" }) {
  const models = useMemo(
    () => summarizeBenchmarkModels(history, benchmarkType, catalogModels),
    [benchmarkType, catalogModels, history],
  );
  const presentation = useMemo(() => catalogModelPresentations(catalogModels), [catalogModels]);
  const totalRecords = models.reduce((total, model) => total + model.records, 0);

  return (
    <section className="saved-model-history" aria-labelledby="saved-model-history-title">
      <div className="benchmark-comparison-head">
        <div>
          <span className="comparison-kicker">Unfiltered persisted inventory</span>
          <h3 id="saved-model-history-title">Saved model history</h3>
        </div>
        <span>{models.length} model{models.length === 1 ? "" : "s"} · {totalRecords} saved record{totalRecords === 1 ? "" : "s"}</span>
      </div>
      {models.length ? (
        <div className="saved-model-history-grid">
          {models.map((item) => {
            const metadata = presentation.get(item.modelKey) || presentation.get(item.model);
            const displayName = item.modelLabel || metadata?.displayName || item.model;
            return (
              <article className="saved-model-history-card" key={item.key}>
                <div className="saved-model-history-name"><ProviderMark providerLogo={metadata?.providerLogo} /><strong>{displayName}</strong></div>
                <span>{item.completed} completed · {item.failed} incomplete</span>
                <dl>
                  <div><dt>Saved records</dt><dd>{item.records}</dd></div>
                  <div><dt>Configurations</dt><dd>{item.configurations}</dd></div>
                  <div><dt>Latest inference</dt><dd>{speculativeDecodingLabel(item.latestInferenceConfig)}</dd></div>
                  <div><dt>Best generation</dt><dd>{item.bestTps ? formatRate(item.bestTps) : "n/a"}</dd></div>
                  <div><dt>Latest run</dt><dd>{item.latestAt ? `${formatDate(item.latestAt)} · ${formatTimeLabel(item.latestAt)}` : "n/a"}</dd></div>
                </dl>
              </article>
            );
          })}
        </div>
      ) : <div className="chart-empty">No saved {benchmarkType === "visual" ? "visual analysis" : "coding"} records were found in the configured data directory.</div>}
      <p>This inventory shows every model present in persisted history. The leaderboard below applies the selected fair-comparison filter.</p>
    </section>
  );
}

function LatencyLab() {
  const [catalog, setCatalog] = useState({ models: [], profiles: {}, visualProfiles: {}, codingSuites: {}, endpoint: "" });
  const [benchmarkType, setBenchmarkType] = useState("coding");
  const [benchmarkPlan, setBenchmarkPlan] = useState("standardCodingV1");
  const [profile, setProfile] = useState("standard");
  const [model, setModel] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [maxTokens, setMaxTokens] = useState(512);
  const [parallel, setParallel] = useState(1);
  const [running, setRunning] = useState(false);
  const [activeBenchmarkId, setActiveBenchmarkId] = useState("");
  const [runs, setRuns] = useState([]);
  const [completed, setCompleted] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [suiteProgress, setSuiteProgress] = useState(null);
  const cancelSuiteRef = useRef(false);
  const historyPresentationModels = useMemo(
    () => benchmarkPresentationModels(history, catalog.catalogModels, catalog.historyModels),
    [catalog.catalogModels, catalog.historyModels, history],
  );

  async function loadCatalog() {
    const [modelsData, historyData] = await Promise.all([api("/api/latency/models"), api("/api/latency/history")]);
    const loadedHistory = historyData.runs || [];
    setCatalog(modelsData);
    setHistory(loadedHistory);
    const initialView = initialCodingBenchmarkView(
      loadedHistory,
      modelsData.codingSuites,
      "standardCodingV1",
      benchmarkPresentationModels(loadedHistory, modelsData.catalogModels, modelsData.historyModels),
    );
    setBenchmarkPlan(initialView.benchmarkPlan);
    if (initialView.profile) setProfile(initialView.profile);
    if (initialView.maxTokens) setMaxTokens(initialView.maxTokens);
    if (initialView.parallel) setParallel(initialView.parallel);
    const activeModel = modelsData.catalogModels?.find((item) => item.state === "active" && item.selectable);
    setModel((current) => activeModel?.id || current || modelsData.selectableModels?.[0]?.id || modelsData.models?.[0]?.id || "");
  }

  useEffect(() => {
    loadCatalog().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (running) return undefined;
    const refreshModels = async () => {
      try {
        const modelsData = await api("/api/latency/models");
        setCatalog((current) => ({ ...current, ...modelsData }));
        const activeModel = modelsData.catalogModels?.find((item) => item.state === "active" && item.selectable);
        if (activeModel?.id) setModel(activeModel.id);
      } catch (err) {
        setError(err.message);
      }
    };
    const timer = window.setInterval(refreshModels, 5000);
    return () => window.clearInterval(timer);
  }, [running]);

  function changeProfile(nextProfile) {
    setProfile(nextProfile);
    const profiles = benchmarkType === "visual" ? catalog.visualProfiles : catalog.profiles;
    const selected = profiles?.[nextProfile];
    if (selected?.maxTokens) setMaxTokens(selected.maxTokens);
    if (nextProfile === "custom" && !maxTokens) setMaxTokens(512);
  }

  function changeBenchmarkType(nextType) {
    const nextProfile = nextType === "visual" ? "extraction" : "standard";
    const nextProfiles = nextType === "visual" ? catalog.visualProfiles : catalog.profiles;
    setBenchmarkType(nextType);
    setBenchmarkPlan(nextType === "visual" ? "single" : "standardCodingV1");
    setProfile(nextProfile);
    setCustomPrompt("");
    setMaxTokens(nextProfiles?.[nextProfile]?.maxTokens || (nextType === "visual" ? 256 : 512));
    setCompleted(null);
    setRuns([]);
    setSuiteProgress(null);
    setError("");
  }

  async function startBenchmark() {
    setError("");
    setCompleted(null);
    setSuiteProgress(null);
    cancelSuiteRef.current = false;
    setRunning(true);

    const runCase = async (payload, progress = null) => {
      const expectedParallel = Number(progress?.parallel || payload.parallel || 1);
      setRuns(Array.from({ length: expectedParallel }, (_, index) => ({ index: index + 1, status: "queued", output: "", liveEstimatedTps: null })));
      if (progress) setSuiteProgress(progress);
      let record = null;

      await streamApi("/api/latency/run", payload, (event, eventPayload) => {
        if (event === "started") {
          setActiveBenchmarkId(eventPayload.benchmarkId);
          setRuns(Array.from({ length: Number(eventPayload.parallel || expectedParallel) }, (_, index) => ({
            index: index + 1,
            status: "streaming",
            output: "",
            liveEstimatedTps: null,
          })));
          return;
        }
        if (event === "token") {
          setRuns((current) => current.map((run) => run.index === eventPayload.index ? {
            ...run,
            status: "streaming",
            output: `${run.output || ""}${eventPayload.text}`.slice(0, 9000),
            liveEstimatedTps: eventPayload.liveEstimatedTps,
          } : run));
          return;
        }
        if (event === "complete") {
          record = eventPayload;
          setCompleted(eventPayload);
          setActiveBenchmarkId("");
          setRuns(eventPayload.runs.map((run) => ({ ...run, status: run.ok ? "complete" : "failed", output: run.preview || "" })));
          setHistory((current) => [eventPayload, ...current].slice(0, 250));
        }
      });

      if (!record) throw new Error("The benchmark ended without a saved result.");
      return record;
    };

    try {
      const selectedSuite = benchmarkType === "coding" && benchmarkPlan !== "single"
        ? catalog.codingSuites?.[benchmarkPlan]
        : null;

      if (selectedSuite) {
        const suiteRunId = `suite-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const records = [];
        for (let index = 0; index < selectedSuite.cases.length; index += 1) {
          if (cancelSuiteRef.current) break;
          const suiteCase = selectedSuite.cases[index];
          const record = await runCase({
            model,
            benchmarkType: "coding",
            suiteId: benchmarkPlan,
            suiteRunId,
            suiteCaseId: suiteCase.id,
          }, {
            current: index + 1,
            total: selectedSuite.cases.length,
            label: suiteCase.label,
            parallel: suiteCase.parallel,
          });
          records.push(record);
          if (record.summary?.failed > 0 || record.summary?.completed !== record.parallel) {
            throw new Error(`${suiteCase.label} did not complete successfully. This suite was saved as incomplete and will not affect the leaderboard.`);
          }
        }

        if (records.length === selectedSuite.cases.length && !cancelSuiteRef.current) {
          const average = (field) => records.reduce((total, record) => total + Number(record.summary?.[field] || 0), 0) / records.length;
          const suiteSummary = {
            completed: records.reduce((total, record) => total + Number(record.summary?.completed || 0), 0),
            failed: records.reduce((total, record) => total + Number(record.summary?.failed || 0), 0),
            avgTtftMs: average("avgTtftMs"),
            avgEndToEndMs: average("avgEndToEndMs"),
            avgGenerationTokensPerSecond: average("aggregateGenerationTokensPerSecond"),
            totalPromptTokens: records.reduce((total, record) => total + Number(record.summary?.totalPromptTokens || 0), 0),
            totalCompletionTokens: records.reduce((total, record) => total + Number(record.summary?.totalCompletionTokens || 0), 0),
          };
          setCompleted({
            ...records.at(-1),
            id: suiteRunId,
            suiteId: benchmarkPlan,
            suiteLabel: selectedSuite.label,
            maxTokens: null,
            summary: suiteSummary,
          });
          setSuiteProgress({ current: selectedSuite.cases.length, total: selectedSuite.cases.length, label: "Suite complete", complete: true });
        }
      } else {
        await runCase({ model, benchmarkType, profile, customPrompt, maxTokens: Number(maxTokens), parallel: Number(parallel) });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
      setActiveBenchmarkId("");
    }
  }

  async function stopBenchmark() {
    cancelSuiteRef.current = true;
    if (!activeBenchmarkId) return;
    try {
      await api("/api/latency/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ benchmarkId: activeBenchmarkId }) });
    } catch (err) {
      setError(err.message);
    }
  }

  async function killAllBenchmarks() {
    cancelSuiteRef.current = true;
    try {
      await api("/api/latency/kill-all", { method: "POST" });
    } catch (err) {
      setError(err.message);
    }
  }

  function clearLiveRuns() {
    setRuns([]);
    setCompleted(null);
    setSuiteProgress(null);
    setError("");
  }

  function showSavedSingleHistory() {
    const view = bestComparableSingleCodingView(history, historyPresentationModels);
    if (!view) return;
    setBenchmarkPlan(view.benchmarkPlan);
    setProfile(view.profile);
    setMaxTokens(view.maxTokens);
    setParallel(view.parallel);
    setCompleted(null);
    setRuns([]);
    setSuiteProgress(null);
  }

  const summary = completed?.summary;
  const profileOptions = Object.entries(benchmarkType === "visual" ? catalog.visualProfiles || {} : catalog.profiles || {});
  const suiteOptions = Object.entries(catalog.codingSuites || {});
  const selectedSuite = benchmarkType === "coding" && benchmarkPlan !== "single" ? catalog.codingSuites?.[benchmarkPlan] : null;
  const visibleModels = catalog.catalogModels?.length ? catalog.catalogModels : catalog.models || [];
  const selectableModels = visibleModels.filter((item) => item.selectable);
  const selectedModel = visibleModels.find((item) => item.id === model);
  const selectedInferenceConfig = selectedModel?.inferenceConfig || null;
  const visualModelReady = benchmarkType !== "visual" || selectedModel?.visualCapable;
  const isReady = selectableModels.length && model && visualModelReady;
  const stagedModels = visibleModels.filter((item) => item.state === "staged");
  const relevantHistory = history.filter((entry) => entry.historyCategory === benchmarkType);

  return (
    <section className="panel wide latency-panel" id="latency">
      <div className="panel-title">
        <div>
          <h2>Model Benchmark Lab</h2>
          <p>Coding and visual throughput benchmarks.</p>
        </div>
        <StatusPill ok={selectableModels.length > 0}>{selectableModels.length ? `${selectableModels.length} active · ${stagedModels.length} staged` : "endpoint unavailable"}</StatusPill>
      </div>

      <div className="benchmark-mode" role="tablist" aria-label="Benchmark type">
        <button type="button" className={benchmarkType === "coding" ? "active" : ""} onClick={() => changeBenchmarkType("coding")} disabled={running} role="tab" aria-selected={benchmarkType === "coding"}>
          <TerminalSquare size={17} />Coding
        </button>
        <button type="button" className={benchmarkType === "visual" ? "active" : ""} onClick={() => changeBenchmarkType("visual")} disabled={running} role="tab" aria-selected={benchmarkType === "visual"}>
          <ImageIcon size={17} />Visual Analysis
        </button>
      </div>

      {benchmarkType === "coding" && (
        <div className="benchmark-template-bar">
          <label>
            <span>Comparison template</span>
            <select value={benchmarkPlan} onChange={(event) => { setBenchmarkPlan(event.target.value); setSuiteProgress(null); setCompleted(null); setRuns([]); }} disabled={running}>
              {suiteOptions.map(([id, suite]) => <option key={id} value={id}>{suite.label}</option>)}
              <option value="single">Single scenario</option>
            </select>
          </label>
          <div>
            <strong>{selectedSuite ? selectedSuite.description : "Run one manually configured scenario."}</strong>
            <span>{selectedSuite ? `${selectedSuite.cases.length} fixed cases · 6 total streams · server-enforced settings` : "The leaderboard will only compare runs with this exact task, output budget, and stream count."}</span>
          </div>
          {suiteProgress && <StatusPill ok={suiteProgress.complete}>{suiteProgress.complete ? "suite complete" : `${suiteProgress.current}/${suiteProgress.total} · ${suiteProgress.label}`}</StatusPill>}
        </div>
      )}

      <div className="benchmark-controls">
        <label>
          <span>{benchmarkType === "visual" ? "Visual model" : "Model"}</span>
          <select value={model} onChange={(event) => setModel(event.target.value)} disabled={!selectableModels.length || running}>
            {visibleModels.map((item) => <option key={item.key || item.id} value={item.id} disabled={!item.selectable}>{item.label || item.id}</option>)}
          </select>
        </label>
        {selectedSuite ? (
          <>
            <div className="suite-fixed-control"><span>Coding effort</span><strong>{selectedSuite.cases.length} fixed cases</strong></div>
            <div className="suite-fixed-control"><span>Output budget</span><strong>256–1024 tokens</strong></div>
            <div className="suite-fixed-control"><span>Parallel streams</span><strong>1× and 2×</strong></div>
          </>
        ) : (
          <>
            <label>
              <span>{benchmarkType === "visual" ? "Visual task" : "Coding effort"}</span>
              <select value={profile} onChange={(event) => changeProfile(event.target.value)} disabled={running}>
                {profileOptions.map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
                {benchmarkType === "coding" && <option value="custom">Custom coding prompt</option>}
              </select>
            </label>
            <label>
              <span>Output budget</span>
              <select value={maxTokens} onChange={(event) => setMaxTokens(Number(event.target.value))} disabled={running}>
                {[128, 256, 512, 1024, 1536, 2048].map((value) => <option key={value} value={value}>{value} tokens</option>)}
              </select>
            </label>
            <label>
              <span>Parallel streams</span>
              <select value={parallel} onChange={(event) => setParallel(Number(event.target.value))} disabled={running}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => <option key={value} value={value}>{value} run{value === 1 ? "" : "s"}</option>)}
              </select>
            </label>
          </>
        )}
        <div className="benchmark-actions">
          <button className="primary run-button" onClick={startBenchmark} disabled={!isReady || running}><Play size={20} />Run</button>
          <button className="stop-button" onClick={stopBenchmark} disabled={!running || !activeBenchmarkId}><Square size={20} />Stop</button>
          <button className="kill-button" onClick={killAllBenchmarks} disabled={!running}><Square size={20} />Kill All</button>
          <button className="clear-button" onClick={clearLiveRuns} disabled={running || (!runs.length && !completed)}><Trash2 size={20} />Clear</button>
        </div>
      </div>

      {selectedModel && (
        <div className="benchmark-runtime-config">
          <div>
            <span>Recorded inference configuration</span>
            <strong>{inferenceConfigLabel(selectedInferenceConfig)}</strong>
          </div>
          <small>This configuration is saved with every new benchmark result.</small>
        </div>
      )}

      {!selectedSuite && profile !== "custom" && profileOptions.find(([id]) => id === profile)?.[1] && <div className="benchmark-hint">{profileOptions.find(([id]) => id === profile)?.[1].detail}</div>}
      {!selectedSuite && profile === "custom" && (
        <label className="custom-prompt">
          <span>Custom coding prompt</span>
          <textarea value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} placeholder="Describe a coding task to benchmark." disabled={running} />
        </label>
      )}
      {benchmarkType === "visual" && !visualModelReady && <div className="benchmark-hint benchmark-warning">Start an image-capable model in Model Controller before running visual analysis.</div>}
      {error && <div className="error-banner benchmark-error"><AlertTriangle size={18} />{error}</div>}

      <div className="benchmark-metrics">
        <MetricCard icon={Zap} label="Average TTFT" value={formatProbeMs(summary?.avgTtftMs)} detail="First streamed token" tone={summary?.avgTtftMs != null ? "good" : "default"} />
        <MetricCard icon={Gauge} label="Generation TPS" value={summary?.avgGenerationTokensPerSecond == null ? "waiting" : formatRate(summary.avgGenerationTokensPerSecond)} detail={completed?.suiteId ? "Average aggregate throughput across suite cases" : "Actual completion tokens after TTFT"} tone={summary?.avgGenerationTokensPerSecond > 0 ? "good" : "default"} />
        <MetricCard icon={Activity} label="End-to-end" value={formatProbeMs(summary?.avgEndToEndMs)} detail={`${summary?.completed ?? 0} completed · ${summary?.failed ?? 0} failed`} />
        <MetricCard icon={FileText} label="Prefill tokens" value={summary ? formatLargeNumber(summary.totalPromptTokens) : "waiting"} detail={completed ? "Total prompt tokens across completed streams" : "Awaiting a benchmark"} />
        <MetricCard icon={TerminalSquare} label="Output tokens" value={summary ? formatLargeNumber(summary.totalCompletionTokens) : "waiting"} detail={completed?.suiteId ? "Total output across all suite cases" : completed ? `${completed.maxTokens} token budget per stream` : "Awaiting a benchmark"} />
      </div>

      {runs.length > 0 && (
        <div className="streaming-grid">
          {runs.map((run) => (
            <article className={`stream-card ${run.status}`} key={run.index}>
              <div className="stream-card-head">
                <strong>Run {run.index}</strong>
                <span className={`run-status ${run.status}`}>{run.status === "complete" ? "done" : run.status}</span>
              </div>
              <div className="stream-card-stats">
                <div className="probe-stat ttft"><span>TTFT</span><strong>{formatProbeMs(run.ttftMs)}</strong></div>
                <div className="probe-stat tps"><span>{run.status === "streaming" ? "Live tok/s" : "TPS"}</span><strong>{run.generationTokensPerSecond ? formatRate(run.generationTokensPerSecond) : run.liveEstimatedTps ? `~${formatRate(run.liveEstimatedTps)}` : "..."}</strong></div>
                <div className="probe-stat e2e"><span>E2E</span><strong>{formatProbeMs(run.endToEndMs)}</strong></div>
                <div className="probe-stat prefill"><span>Prefill</span><strong>{run.promptTokens != null ? formatLargeNumber(run.promptTokens) : "..."}</strong></div>
                <div className="probe-stat tokens"><span>Tokens</span><strong>{run.completionTokens ?? "..."}</strong></div>
              </div>
              <pre>{run.error || run.output || "Awaiting streamed output..."}</pre>
            </article>
          ))}
        </div>
      )}

      <SavedModelHistory history={history} catalogModels={historyPresentationModels} benchmarkType={benchmarkType} />

      <ModelBenchmarkComparison
        history={history}
        catalogModels={historyPresentationModels}
        benchmarkType={benchmarkType}
        suiteId={selectedSuite ? benchmarkPlan : ""}
        suites={catalog.codingSuites}
        profile={profile}
        maxTokens={maxTokens}
        parallel={parallel}
        onShowSingleHistory={showSavedSingleHistory}
      />

      <div className="benchmark-history">
        <div className="benchmark-history-head"><strong>Recent {benchmarkType === "visual" ? "visual analysis" : "coding"} benchmark runs</strong><span>{catalog.endpoint || "vLLM endpoint"}</span></div>
        {relevantHistory.length ? (
          <div className="benchmark-history-table">
            <div className="benchmark-history-row head"><span>Time</span><span>Model</span><span>Configuration</span><span>Task</span><span>TTFT</span><span>Prefill</span><span>TPS</span><span>E2E</span></div>
            {relevantHistory.slice(0, 10).map((entry) => (
              <div className="benchmark-history-row" key={entry.id}>
                <span>{formatTimeLabel(entry.createdAt)}</span><span className="truncate" title={entry.model}>{entry.model}</span><span title={inferenceConfigLabel(entry.inferenceConfig)}>{speculativeDecodingLabel(entry.inferenceConfig)}</span><span>{entry.suiteCaseLabel || entry.promptLabel}{entry.parallel > 1 && !entry.suiteCaseLabel ? ` · ${entry.parallel}×` : ""}</span><span>{formatProbeMs(entry.summary?.avgTtftMs)}</span><span>{entry.summary?.totalPromptTokens != null ? formatLargeNumber(entry.summary.totalPromptTokens) : "n/a"}</span><span>{entry.summary?.avgGenerationTokensPerSecond ? formatRate(entry.summary.avgGenerationTokensPerSecond) : "n/a"}</span><span>{formatProbeMs(entry.summary?.avgEndToEndMs)}</span>
              </div>
            ))}
          </div>
        ) : <div className="empty">No saved {benchmarkType === "visual" ? "visual analysis" : "coding"} probes yet.</div>}
      </div>
    </section>
  );
}

function Header({ config, loading, running, onRefresh, onRunDoctor, updatedAt }) {
  const [controlsUnlocked, setControlsUnlocked] = useState(() => Boolean(window.localStorage.getItem("ai-lab-control-token")));

  function configureControlToken() {
    if (controlsUnlocked) {
      window.localStorage.removeItem("ai-lab-control-token");
      setControlsUnlocked(false);
      return;
    }
    const token = window.prompt("Enter the dashboard control token");
    if (!token) return;
    window.localStorage.setItem("ai-lab-control-token", token);
    setControlsUnlocked(true);
  }

  return (
    <header className="topbar">
      <div>
        <h1>{config.title}</h1>
        <p>{config.subtitle}</p>
      </div>
      <div className="top-actions">
        <div className="updated">Updated {updatedAt ? new Date(updatedAt).toLocaleTimeString() : "never"}</div>
        {config.controlAuthRequired && (
          <button type="button" onClick={configureControlToken} title={controlsUnlocked ? "Lock write controls" : "Unlock write controls"}>
            <LockKeyhole size={16} />
            {controlsUnlocked ? "Lock" : "Unlock"}
          </button>
        )}
        <button onClick={onRefresh} disabled={loading || running}>
          <RefreshCcw size={16} className={loading ? "spin" : ""} />
          Refresh
        </button>
        {config.capabilities?.sparkDoctor && (
          <button className="primary" onClick={onRunDoctor} disabled={loading || running}>
            <Play size={16} />
            <span className="action-label-full">{running ? "Running..." : "Run Spark Doctor"}</span>
            <span className="action-label-mobile">{running ? "Running" : "Spark Doctor"}</span>
          </button>
        )}
      </div>
    </header>
  );
}

function Sidebar({ config, tabs, dgx, pm2, gateway, activeTab, onNavigate }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <BrandAvatar source={config.logoUrl} alt={config.logoAlt} />
        <div>
          <strong>{config.brand || config.title}</strong>
          <span>{config.capabilities?.modelControl ? "Models, benchmarks, and system telemetry" : "Inference monitoring and telemetry"}</span>
        </div>
      </div>
      <nav>
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={activeTab === id ? "active" : ""}
            onClick={() => onNavigate(id)}
            aria-current={activeTab === id ? "page" : undefined}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>
      <div className="rail-card">
        <span>{config.compute?.label || "Compute target"}</span>
        <strong>{dgx?.host || config.compute?.host || "local"}</strong>
        <StatusPill ok={dgx?.ok !== false}>{dgx?.ok === false ? "offline" : "reachable"}</StatusPill>
      </div>
      {config.services?.pm2?.enabled && <div className="rail-card">
        <span>PM2 target</span>
        <strong>{pm2?.host || "nexus-mac-mini.local"}</strong>
        <StatusPill ok={pm2?.ok}>{pm2?.ok ? "connected" : "needs SSH"}</StatusPill>
      </div>}
      {config.services?.gateway?.enabled && <div className="rail-card">
        <span>LLM gateway</span>
        <strong>spark-production</strong>
        <StatusPill ok={gateway?.ok}>{gateway?.ok ? "routing" : "offline"}</StatusPill>
      </div>}
    </aside>
  );
}

function DashboardTabs({ tabs, activeTab, onNavigate }) {
  const mobileLabels = { health: "Health", controller: "Models", latency: "Benchmarks", settings: "Settings" };
  return (
    <div className="workspace-tabs" role="tablist" aria-label="Dashboard views">
      {tabs.map(({ id, label, detail, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={activeTab === id}
          className={activeTab === id ? "active" : ""}
          onClick={() => onNavigate(id)}
        >
          <span className="workspace-tab-icon"><Icon size={19} /></span>
          <span>
            <strong className="tab-label-full">{label}</strong>
            <strong className="tab-label-mobile">{mobileLabels[id] || label}</strong>
            <small>{detail}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

function settingValue(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function withSetting(object, path, value) {
  const copy = structuredClone(object);
  const keys = path.split(".");
  let target = copy;
  for (const key of keys.slice(0, -1)) {
    target[key] ||= {};
    target = target[key];
  }
  target[keys.at(-1)] = value;
  return copy;
}

function SettingsField({ form, managed, path, label, help, type = "text", options = [], onChange }) {
  const managedBy = managed[path];
  const value = settingValue(form, path) ?? "";
  const inputProps = {
    id: `setting-${path}`,
    value,
    disabled: Boolean(managedBy),
    onChange: (event) => onChange(path, type === "number" ? Number(event.target.value) : event.target.value),
  };
  return (
    <label className="settings-field" htmlFor={inputProps.id}>
      <span>{label}</span>
      {options.length ? (
        <select {...inputProps}>{options.map(({ value: optionValue, label: optionLabel }) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select>
      ) : (
        <input {...inputProps} type={type} />
      )}
      <small>{managedBy ? `Managed by ${managedBy}` : help}</small>
    </label>
  );
}

function SettingsToggle({ form, managed, path, label, help, onChange }) {
  const managedBy = managed[path];
  const checked = Boolean(settingValue(form, path));
  return (
    <label className="settings-toggle">
      <span>
        <strong>{label}</strong>
        <small>{managedBy ? `Managed by ${managedBy}` : help}</small>
      </span>
      <input type="checkbox" checked={checked} disabled={Boolean(managedBy)} onChange={(event) => onChange(path, event.target.checked)} />
    </label>
  );
}

function SettingsPanel() {
  const [form, setForm] = useState(null);
  const [managed, setManaged] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadSettings() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/settings");
      if (!response.ok) throw new Error(`Unable to load settings (${response.status}).`);
      const payload = await response.json();
      setForm(payload.values);
      setManaged(payload.managed || {});
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadSettings(); }, []);

  function update(path, value) {
    setForm((current) => withSetting(current, path, value));
    setMessage("");
  }

  async function saveSettings(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: controlHeaders({ "content-type": "application/json" }),
        body: JSON.stringify(form),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Unable to save settings (${response.status}).`);
      setForm(payload.values);
      setManaged(payload.managed || {});
      setMessage("Settings saved. Restart the dashboard service to apply connection or listening changes.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <section className="settings-panel"><p>Loading settings...</p></section>;
  if (!form) return <section className="settings-panel"><div className="error-banner"><AlertTriangle size={18} />{error || "Settings are unavailable."}</div></section>;

  const modeOptions = [
    { value: "readonly", label: "Read only" },
    { value: "benchmark", label: "Benchmark controls" },
    { value: "full", label: "Full model controls" },
  ];
  const connectionOptions = [
    { value: "local", label: "This computer" },
    { value: "ssh", label: "Remote over SSH" },
  ];

  return (
    <form className="settings-panel" onSubmit={saveSettings}>
      <div className="settings-header">
        <div>
          <h2>Settings</h2>
          <p>Customize the dashboard and connect it to your compute and inference services.</p>
        </div>
        <button className="primary settings-save" type="submit" disabled={saving}><Save size={18} />{saving ? "Saving" : "Save Settings"}</button>
      </div>
      <div className="settings-notice">
        <LockKeyhole size={19} />
        <span>Credentials, control tokens, and model launch recipes stay in environment variables or configuration files. This screen only edits common, non-secret settings.</span>
      </div>
      {error && <div className="error-banner"><AlertTriangle size={18} />{error}</div>}
      {message && <div className="success-slab"><CheckCircle2 size={18} />{message}</div>}

      <section className="settings-section">
        <div className="settings-section-title"><h3>Identity and access</h3><p>Brand the interface and choose which controls are exposed.</p></div>
        <div className="settings-grid">
          <SettingsField form={form} managed={managed} path="dashboard.title" label="Dashboard title" help="The primary page heading." onChange={update} />
          <SettingsField form={form} managed={managed} path="dashboard.brand" label="Sidebar brand" help="Short name shown beside the profile image." onChange={update} />
          <SettingsField form={form} managed={managed} path="dashboard.subtitle" label="Subtitle" help="A concise description of this installation." onChange={update} />
          <SettingsField form={form} managed={managed} path="dashboard.logoUrl" label="Logo URL or path" help="Use a bundled path such as /dgx-spark-icon.png or an HTTPS URL." onChange={update} />
          <SettingsField form={form} managed={managed} path="dashboard.logoAlt" label="Logo description" help="Accessible description for the profile image." onChange={update} />
          <SettingsField form={form} managed={managed} path="dashboard.mode" label="Operating mode" help="Controls whether model and benchmark actions are available." options={modeOptions} onChange={update} />
          <SettingsField form={form} managed={managed} path="dashboard.host" label="Listen address" help="Use 127.0.0.1 for local-only access or 0.0.0.0 for trusted-network access." onChange={update} />
          <SettingsField form={form} managed={managed} path="dashboard.port" label="Port" help="Web server port." type="number" onChange={update} />
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title"><h3>Compute and inference</h3><p>Point the dashboard at the machine and OpenAI-compatible inference endpoint it should monitor.</p></div>
        <div className="settings-grid">
          <SettingsField form={form} managed={managed} path="compute.label" label="Compute label" help="Friendly name for the monitored host." onChange={update} />
          <SettingsField form={form} managed={managed} path="compute.connection" label="Compute connection" help="Collect locally or through SSH." options={connectionOptions} onChange={update} />
          <SettingsField form={form} managed={managed} path="compute.host" label="Compute host" help="Hostname or SSH target." onChange={update} />
          <SettingsField form={form} managed={managed} path="inference.apiUrl" label="Inference API URL" help="OpenAI-compatible API base URL, normally ending in /v1." onChange={update} />
          <SettingsField form={form} managed={managed} path="inference.metricsUrl" label="Metrics URL" help="Optional Prometheus-compatible metrics endpoint." onChange={update} />
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title"><h3>Optional integrations</h3><p>Show extra operational services only when this installation uses them.</p></div>
        <div className="settings-toggle-grid">
          <SettingsToggle form={form} managed={managed} path="services.pm2.enabled" label="PM2 monitoring" help="Collect Node.js process status from a local or remote host." onChange={update} />
          <SettingsToggle form={form} managed={managed} path="services.gateway.enabled" label="Inference gateway" help="Monitor an optional application-facing LLM gateway." onChange={update} />
          <SettingsToggle form={form} managed={managed} path="sparkDoctor.enabled" label="Spark Doctor" help="Show diagnostic controls only when an external Spark Doctor installation is detected." onChange={update} />
        </div>
        <div className="settings-grid">
          <SettingsField form={form} managed={managed} path="services.pm2.label" label="PM2 label" help="Friendly name for the PM2 host." onChange={update} />
          <SettingsField form={form} managed={managed} path="services.pm2.connection" label="PM2 connection" help="Collect locally or through SSH." options={connectionOptions} onChange={update} />
          <SettingsField form={form} managed={managed} path="services.pm2.host" label="PM2 host" help="Hostname or SSH target for PM2 collection." onChange={update} />
          <SettingsField form={form} managed={managed} path="services.gateway.label" label="Gateway label" help="Friendly name for the gateway." onChange={update} />
          <SettingsField form={form} managed={managed} path="services.gateway.apiUrl" label="Gateway API URL" help="Health or API URL used to check gateway availability." onChange={update} />
          <SettingsField form={form} managed={managed} path="sparkDoctor.directory" label="Spark Doctor directory" help="Path to the separately installed joeynyc/spark-doctor project on the compute host." onChange={update} />
        </div>
      </section>
      <div className="settings-footer"><button className="primary settings-save" type="submit" disabled={saving}><Save size={18} />{saving ? "Saving" : "Save Settings"}</button></div>
    </form>
  );
}

function ModelBanner({ dgx }) {
  const loaded = dgx?.vllm?.loadedModel;
  const aliases = (dgx?.vllm?.models || []).map((model) => model.id).filter(Boolean);
  const details = dgx?.vllm?.huggingFace;
  const aliasText = `${aliases.length || 1} served alias${aliases.length === 1 ? "" : "es"}`;
  const contextText = loaded?.maxModelLen ? `${number.format(loaded.maxModelLen)} token context` : "Context metadata unavailable";
  const detailItems = details?.ok ? [
    ["Base model", details.baseModel || "n/a"],
    ["Provider", details.provider || details.author || "n/a"],
    ["License", details.license || "n/a"],
    ["Parameters", formatLargeNumber(details.parameters)],
    ["Served aliases", aliases.length ? aliases.join(", ") : "n/a"],
    ["Tasks", details.tasks?.length ? details.tasks.join(", ") : "n/a"],
    ["Updated", formatDate(details.lastModified)],
    ["Downloads", formatLargeNumber(details.downloads)],
    ["Likes", formatLargeNumber(details.likes)],
  ] : [];

  return (
    <article className={`model-banner infrastructure-model ${loaded ? "good" : "warn"}`} aria-label="Loaded vLLM model">
      <div className="model-primary">
        <span className="metric-icon"><TerminalSquare size={18} /></span>
        <div>
          <span>Active vLLM</span>
          <strong>{loaded?.id || "Model endpoint unavailable"}</strong>
          {loaded ? (
            <div className="model-inline-meta">
              <small>{contextText}</small>
              <small>{aliasText}</small>
            </div>
          ) : (
            <small>The dashboard could not read the DGX /v1/models endpoint on this refresh.</small>
          )}
        </div>
      </div>
      {details?.ok ? (
        <details className="model-details">
          <summary>Model metadata</summary>
          <div className="model-detail-popover">
            {details.description && <p className="model-description">{details.description}</p>}
            <div className="model-detail-grid">
              {detailItems.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <div className="model-tags">
              {details.toolCallingSupported && <span>tool calling</span>}
              {(details.tags || []).slice(0, 8).map((tag) => <span key={tag}>{tag}</span>)}
              {details.repoUrl && <a href={details.repoUrl} target="_blank" rel="noreferrer">Hugging Face</a>}
            </div>
          </div>
        </details>
      ) : (
        <div className="model-metadata-warning">
          <AlertTriangle size={16} />
          <span>{details?.error || "Hugging Face metadata is not available for this model yet."}</span>
          {details?.repoUrl && <a href={details.repoUrl} target="_blank" rel="noreferrer">Open model page</a>}
        </div>
      )}
    </article>
  );
}

function DgxOverview({ dgx, liveGpu }) {
  const gpu = liveGpu || dgx?.gpu?.[0] || {};
  const mem = dgx?.summary?.meminfo || {};
  const totalGb = bytesToGb(mem.MemTotal);
  const availGb = bytesToGb(mem.MemAvailable);
  const usedPct = totalGb ? ((totalGb - availGb) / totalGb) * 100 : 0;
  const latest = dgx?.latestSparkDoctor?.data;
  const overall = latest?.overall || latest?.summary?.overall || "OK";

  return (
    <div className="overview-grid">
      <MetricCard icon={Gauge} label="GPU utilization" value={`${number.format(gpu.util || 0)}%`} detail={`${gpu.name || "NVIDIA GPU"} · driver ${gpu.driver || "unknown"}`} gauge={gpu.util || 0} />
      <MetricCard icon={Zap} label="Power / Temp" value={`${number.format(gpu.power || 0)} W`} detail={`${number.format(gpu.temp || 0)} C · ${number.format(gpu.clock || 0)} MHz`} tone={(gpu.temp || 0) > 80 ? "warn" : "default"} />
      <MetricCard icon={MemoryStick} label="Memory used" value={`${number.format(usedPct)}%`} detail={`${number.format(availGb)} GB free · ${number.format(totalGb)} GB total`} gauge={usedPct} />
      {dgx?.sparkDoctor?.available && <MetricCard icon={CheckCircle2} label="Spark Doctor" value={overall} detail={dgx?.latestSparkDoctor?.path || "No saved report yet"} tone={overall === "OK" ? "good" : "warn"} />}
      <MetricCard icon={Box} label="Docker runtime" value={dgx?.docker?.length ? `${dgx.docker.length} running` : "0 running"} detail="Docker + NVIDIA runtime collected from DGX" />
      <MetricCard icon={HardDrive} label="Uptime / Load" value={uptime(dgx?.summary?.uptimeSeconds)} detail={dgx?.summary?.loadavg || "load unavailable"} />
    </div>
  );
}

function ProcessTable({ processes = [] }) {
  return (
    <section className="panel wide" id="models">
      <div className="panel-title">
        <div>
          <h2>Running Model Processes</h2>
          <p>Filtered for vLLM, Open WebUI, Ollama, llama, Triton, and related workers.</p>
        </div>
      </div>
      <div className="table">
        <div className="row head"><span>PID</span><span>Command</span><span>CPU</span><span>Mem</span><span>RSS</span></div>
        {processes.length ? processes.map((proc) => (
          <div className="row" key={`${proc.pid}-${proc.command}`}>
            <span>{proc.pid}</span>
            <span className="truncate" title={proc.args}>{proc.command} · {proc.args}</span>
            <span>{number.format(proc.cpu)}%</span>
            <span>{number.format(proc.mem)}%</span>
            <span>{proc.rssMb} MB</span>
          </div>
        )) : <div className="empty">No matching model processes found.</div>}
      </div>
    </section>
  );
}

function DockerPanel({ containers = [] }) {
  return (
    <section className="panel" id="docker">
      <div className="panel-title">
        <div>
          <h2>Docker Runtime</h2>
          <p>Running containers on DGX Spark.</p>
        </div>
      </div>
      <div className="stack-list">
        {containers.length ? containers.map((item) => (
          <div className="service-line" key={item.ID || item.Names}>
            <div>
              <strong>{item.Names || item.Image}</strong>
              <span>{item.Image}</span>
            </div>
            <StatusPill ok={(item.State || "").toLowerCase() === "running"}>{item.Status || item.State}</StatusPill>
          </div>
        )) : <div className="empty">No running containers reported.</div>}
      </div>
    </section>
  );
}

function Pm2Panel({ pm2 }) {
  return (
    <section className="panel" id="pm2">
      <div className="panel-title">
        <div>
          <h2>Mac Mini PM2</h2>
          <p>{pm2?.ok ? `Collected from ${pm2.host}` : "Waiting for a reachable SSH alias."}</p>
        </div>
        <StatusPill ok={pm2?.ok}>{pm2?.ok ? "online" : "offline"}</StatusPill>
      </div>
      {pm2?.ok ? (
        <div className="stack-list">
          {pm2.processes.map((proc) => (
            <div className="service-line" key={proc.id}>
              <div>
                <strong>{proc.name}</strong>
                <span>{proc.mode || "fork"} · restarts {proc.restarts ?? 0}</span>
              </div>
              <div className="pm2-metrics">
                <span>{number.format(proc.cpu || 0)}% CPU</span>
                <span>{proc.memoryMb} MB</span>
                <StatusPill ok={proc.status === "online"}>{proc.status}</StatusPill>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="offline-box">
          <AlertTriangle size={18} />
          <div>
            <strong>{pm2?.error || "PM2 host not connected."}</strong>
            <span>{pm2?.setup || "Start this app with MAC_MINI_HOST=<ssh-alias> once SSH is configured."}</span>
          </div>
        </div>
      )}
    </section>
  );
}

function GatewayPanel({ gateway }) {
  const modelNames = gateway?.models?.length ? gateway.models.join(", ") : "No routes available";
  return (
    <section className="panel" id="gateway">
      <div className="panel-title">
        <div>
          <h2>LLM Gateway</h2>
          <p>Local production routing layer for Mac Mini services.</p>
        </div>
        <StatusPill ok={gateway?.ok}>{gateway?.ok ? "routing" : "offline"}</StatusPill>
      </div>
      <div className="stack-list">
        <div className="service-line">
          <div>
            <strong>spark-production</strong>
            <span>{modelNames}</span>
          </div>
          <div className="pm2-metrics">
            <span>{gateway?.latencyMs == null ? "checking" : `${number.format(gateway.latencyMs)} ms`}</span>
            <StatusPill ok={gateway?.ok}>{gateway?.ok ? "ready" : "unavailable"}</StatusPill>
          </div>
        </div>
      </div>
      {!gateway?.ok && gateway?.error && <div className="offline-box"><AlertTriangle size={18} /><div><strong>{gateway.error}</strong><span>{gateway.endpoint}</span></div></div>}
    </section>
  );
}

function SparkDoctorPanel({ dgx, lastRun }) {
  const latest = lastRun?.scan || dgx?.latestSparkDoctor?.data;
  const report = lastRun?.report;
  const findings = latest?.findings || [];
  return (
    <section className="panel wide">
      <div className="panel-title">
        <div>
          <h2>Spark Doctor Findings</h2>
          <p>{lastRun?.runDir || dgx?.latestSparkDoctor?.path || "Run a scan to generate a dashboard report."}</p>
        </div>
        <StatusPill ok={!findings.length}>{findings.length ? `${findings.length} findings` : "clean"}</StatusPill>
      </div>
      <p className="integration-credit">Optional diagnostics provided by the external <a href="https://github.com/joeynyc/spark-doctor" target="_blank" rel="noreferrer">Spark Doctor project</a> (MIT).</p>
      {findings.length ? (
        <div className="table findings">
          <div className="row head"><span>Severity</span><span>Rule</span><span>Message</span></div>
          {findings.map((finding, index) => (
            <div className="row" key={index}><span>{finding.severity}</span><span>{finding.rule_id || finding.rule}</span><span>{finding.message}</span></div>
          ))}
        </div>
      ) : (
        <div className="success-slab"><CheckCircle2 size={20} />No issues detected by the current Spark Doctor rule set.</div>
      )}
      {report && <pre className="report-snippet">{report.split("\n").slice(0, 28).join("\n")}</pre>}
    </section>
  );
}

function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("health");
  const [history, setHistory] = useState([]);
  const [liveVllm, setLiveVllm] = useState(null);
  const appConfig = snapshot?.config || FALLBACK_CONFIG;
  const tabs = useMemo(() => visibleTabs(appConfig), [appConfig]);

  async function refresh(force = false) {
    setLoading(true);
    setError("");
    try {
      const status = await api(`/api/status${force ? "?refresh=1" : ""}`);
      const historyData = await api("/api/history");
      setSnapshot(status);
      setHistory(historyData.points || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function runDoctor() {
    setRunning(true);
    setError("");
    try {
      const result = await api("/api/spark-doctor/run", { method: "POST" });
      setLastRun(result);
      await refresh(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    refresh(true);
    const id = setInterval(() => refresh(true), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function refreshLiveVllm() {
      try {
        const telemetry = await api("/api/vllm/live");
        if (mounted) setLiveVllm(telemetry);
      } catch {
        if (mounted) setLiveVllm({ ok: false });
      }
    }
    refreshLiveVllm();
    const id = setInterval(refreshLiveVllm, 5000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    function syncActiveFromHash() {
      const hash = window.location.hash.replace("#", "");
      const tabId = HASH_TO_TAB[hash] || hash;
      if (DASHBOARD_TABS.some((item) => item.id === tabId)) {
        setActiveTab(tabId);
      }
    }

    syncActiveFromHash();
    window.addEventListener("hashchange", syncActiveFromHash);
    return () => window.removeEventListener("hashchange", syncActiveFromHash);
  }, []);

  useEffect(() => {
    if (!tabs.some(({ id }) => id === activeTab)) {
      setActiveTab("health");
      window.history.replaceState(null, "", "#health");
    }
  }, [activeTab, tabs]);

  function handleNavigate(tabId) {
    setActiveTab(tabId);
    window.history.replaceState(null, "", `#${tabId}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const dgx = snapshot?.dgx;
  const pm2 = snapshot?.pm2;
  const gateway = snapshot?.gateway;
  const ok = useMemo(() => dgx?.ok !== false && !((dgx?.latestSparkDoctor?.data?.findings || []).length), [dgx]);

  return (
    <div className="app-shell">
      <Sidebar config={appConfig} tabs={tabs} dgx={dgx} pm2={pm2} gateway={gateway} activeTab={activeTab} onNavigate={handleNavigate} />
      <main>
        <Header config={appConfig} loading={loading} running={running} onRefresh={() => refresh(true)} onRunDoctor={runDoctor} updatedAt={snapshot?.collectedAt} />
        {error && <div className="error-banner"><AlertTriangle size={18} />{error}</div>}
        <DashboardTabs tabs={tabs} activeTab={activeTab} onNavigate={handleNavigate} />
        <div className="tab-view health-view" role="tabpanel" hidden={activeTab !== "health"}>
          <section className="hero-status infrastructure-hero" id="dgx">
            <div className="infrastructure-identity">
              <StatusPill ok={ok}>{ok ? "Overall OK" : "Needs attention"}</StatusPill>
              <h2>
                <span>{dgx?.summary?.hostname || appConfig.compute?.label || "Compute host"}</span>
                <small>Infrastructure view</small>
              </h2>
              <p>
                Live data is collected {appConfig.compute?.connection === "ssh" ? "over SSH" : "from this host"}.
                {appConfig.capabilities?.sparkDoctor ? " Spark Doctor results are folded into the dashboard." : " Inference and system telemetry refresh automatically."}
              </p>
            </div>
            <ModelBanner dgx={dgx} />
            <div className="signal-card">
              <Activity size={26} />
              <span>Collector cadence</span>
              <strong>5s live telemetry</strong>
              <small>60s retained system samples</small>
            </div>
          </section>
          <DgxOverview dgx={dgx} liveGpu={liveVllm?.gpu?.[0]} />
          <LlmMetricsPanel dgx={dgx} liveVllm={liveVllm} history={history} />
          <PerformanceTrendsSection history={history} />
          <InferenceDiagnosticsPanel dgx={dgx} liveVllm={liveVllm} history={history} />
          <div className="content-grid">
            <ProcessTable processes={dgx?.processes} />
            {appConfig.services?.pm2?.enabled && <Pm2Panel pm2={pm2} />}
            {appConfig.services?.gateway?.enabled && <GatewayPanel gateway={gateway} />}
            <DockerPanel containers={dgx?.docker} />
            {appConfig.capabilities?.sparkDoctor && <SparkDoctorPanel dgx={dgx} lastRun={lastRun} />}
          </div>
        </div>
        {appConfig.capabilities?.modelControl && <div className="tab-view" role="tabpanel" hidden={activeTab !== "controller"}>
          <ModelControlPanel />
        </div>}
        {appConfig.capabilities?.benchmarks && <div className="tab-view" role="tabpanel" hidden={activeTab !== "latency"}>
          <LatencyLab />
        </div>}
        <div className="tab-view" role="tabpanel" hidden={activeTab !== "settings"}>
          <SettingsPanel />
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
