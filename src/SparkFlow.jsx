import React, { useEffect, useId, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { normalizeSparkSetup, sparkStackUnits, SPARK_STACK_PITCH } from "./spark-setup.js";
import "./spark-flow.css";

// Decorative paths only. Never derive measurements or operational status from this scene.
const CABLES = [
  { path: "M 490 35 H 407 C 368 35 362 12 330 24 L 242 66", direction: "in", delay: "-0.6s" },
  { path: "M 490 108 H 438 C 390 108 404 31 352 42 L 275 78", direction: "in", delay: "-2.1s" },
  { path: "M 306 84 L 355 63 C 411 40 393 200 450 200 H 490", direction: "out", delay: "-1.3s" },
];

export default function SparkFlow({ active = true, setup }) {
  const id = useId().replace(/:/g, "");
  const { count, layout } = normalizeSparkSetup(setup);
  const units = sparkStackUnits(count);
  const height = 230 + (count - 1) * SPARK_STACK_PITCH;
  const width = 510;
  const scene = useRef(null);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const onVisibility = () => setPageVisible(!document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    const observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting)) : null;
    if (scene.current) observer?.observe(scene.current);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
    };
  }, []);

  return (
    <figure ref={scene} className="spark-flow" data-count={count} data-layout={layout} data-paused={paused || !active || !visible || !pageVisible}
      aria-label={`${count} DGX Spark${count > 1 ? "s" : ""}, user-configured ${layout} illustration. Decorative animation, not live device status.`}>
      <button type="button" className="spark-flow-toggle" aria-pressed={paused}
        aria-label={paused ? "Play decorative animation" : "Pause decorative animation"}
        onClick={() => setPaused(value => !value)}>
        {paused ? <Play size={13} /> : <Pause size={13} />}
      </button>
      <svg className="spark-flow-scene" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`${id}-link`} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#c49aff" /><stop offset="1" stopColor="#38cfff" />
          </linearGradient>
        </defs>
        {count > 1 && <StackCables id={id} units={units} layout={layout} />}
        {[...units].reverse().map(unit => <g className="spark-unit" key={unit.index} transform={`translate(${unit.x} ${unit.y})`}>
          <SparkUnit id={`${id}-unit-${unit.index}`} showLabels={count === 1} groundGlow={unit.index === count - 1} />
        </g>)}
      </svg>
      {count > 1 && <figcaption>{count} Sparks · {layout !== "linked" ? "Independent units" : count === 2 ? "Direct link" : count === 3 ? "Ring links" : "Switch linked"} · Configured illustration</figcaption>}
    </figure>
  );
}

// Example supported cabling, not discovered topology. Draw it behind ALL chassis
// so each cable disappears into the hidden rear, never through the visible side.
function StackCables({ id, units, layout }) {
  const count = units.length;
  const switched = layout === "linked" && count === 4;
  const cables = [];
  if (layout === "independent" || switched) {
    units.forEach((unit, index) => {
      const y = unit.y + 63;
      const endY = switched ? 105 + index * 20 : y - 15;
      cables.push(`M 313 ${y} C 370 ${y - 25} 385 ${endY} ${switched ? 432 : 482} ${endY}`);
    });
  } else {
    units.slice(0, -1).forEach((unit, index) => {
      const y = unit.y + 63;
      const nextY = units[index + 1].y + 63;
      cables.push(`M 313 ${y} C 384 ${y - 24} 384 ${nextY - 24} 313 ${nextY}`);
    });
    // Three directly connected Sparks form a closed ring, not an open chain.
    if (count === 3) cables.push(`M 305 58 C 417 0 417 183 305 182`);
  }
  return <g className="spark-stack-network" data-topology={switched ? "switch" : layout === "independent" ? "independent" : count === 3 ? "ring" : "direct"}>
    {cables.map((path, index) => <g className={`spark-cable ${layout === "linked" ? "spark-interconnect" : "spark-network-lead"}`} key={index}>
      <path d={path} className="spark-cable-sheath" />
      <path d={path} className="spark-cable-edge" stroke={`url(#${id}-link)`} />
      <path d={path} pathLength="100" className="spark-cable-pulse spark-cable-halo" stroke={`url(#${id}-link)`} style={{ animationDelay: `${index * -0.8}s` }} />
      <path d={path} pathLength="100" className="spark-cable-pulse" stroke={`url(#${id}-link)`} style={{ animationDelay: `${index * -0.8}s` }} />
    </g>)}
    {switched && <g className="spark-network-switch">
      <rect x="432" y="84" width="61" height="102" rx="7" fill="#101d25" stroke="#426576" />
      {units.map((unit, index) => <g key={unit.index}>
        <rect x="432" y={100 + index * 20} width="12" height="10" rx="2" fill="#071014" stroke="#738b97" />
        <circle cx="482" cy={105 + index * 20} r="2" fill="#a9d833" />
      </g>)}
      <text x="462" y="204" textAnchor="middle" fill="#a994d0" fontSize="9" letterSpacing="1">SWITCH</text>
    </g>}
  </g>;
}

function SparkUnit({ id, showLabels, groundGlow }) {
  return (
    <g>
        <defs>
          <linearGradient id={`${id}-in`} x1="490" y1="30" x2="245" y2="65" gradientUnits="userSpaceOnUse">
            <stop stopColor="#69d5ff" /><stop offset="0.5" stopColor="#9563ff" /><stop offset="1" stopColor="#e6abff" />
          </linearGradient>
          <linearGradient id={`${id}-out`} x1="306" y1="84" x2="490" y2="200" gradientUnits="userSpaceOnUse">
            <stop stopColor="#d197ff" /><stop offset="0.6" stopColor="#8a82ff" /><stop offset="1" stopColor="#54d9e7" />
          </linearGradient>
          {/* Occlude the cables with the chassis silhouette. Their sockets are on
              the hidden rear face, never on the visible side or top surface. */}
          <clipPath id={`${id}-behind-chassis`}>
            <path clipRule="evenodd" fillRule="evenodd"
              d="M 0 0 H 510 V 230 H 0 Z M 18 80 L 149 44 L 329 72 L 329 132 L 205 188 L 18 142 Z" />
          </clipPath>
          {/* Keep the chassis opaque, but fade its ground glow into the header
              instead of displaying the artwork's rectangular black backdrop. */}
          <radialGradient id={`${id}-ground-fade`}>
            <stop stopColor="white" stopOpacity="0.8" />
            <stop offset="0.55" stopColor="white" stopOpacity="0.45" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <filter id={`${id}-chassis-feather`} x="0" y="0" width="345" height="230" filterUnits="userSpaceOnUse">
            <feGaussianBlur stdDeviation="0.35" />
          </filter>
          <mask id={`${id}-artwork-cutout`} maskUnits="userSpaceOnUse" x="0" y="0" width="345" height="230"
            style={{ maskType: "alpha" }}>
            {/* Fade the original ground reflection only. The opaque chassis
                below keeps the hardware and its thin light strip unchanged. */}
            {groundGlow && <ellipse className="spark-underglow" cx="177" cy="172" rx="164" ry="51" fill={`url(#${id}-ground-fade)`} />}
            {/* Round only the front-left foot back toward the chassis; retain
                the original mask allowance along the thin illuminated base. */}
            <path d="M 18 80 L 149 44 L 329 72 L 329 132 L 205 188 L 28 144.46 Q 20 142.49 18 140.3 Z"
              fill="white" stroke="white" strokeWidth="1.5" strokeLinejoin="round"
              filter={`url(#${id}-chassis-feather)`} />
          </mask>
        </defs>
        <image href="/dgx-spark-flow-v4.png" x="0" y="0" width="345" height="230"
          mask={`url(#${id}-artwork-cutout)`} />
        {showLabels && CABLES.map(cable => (
          <g key={cable.path} className={`spark-cable spark-cable-${cable.direction}`} clipPath={`url(#${id}-behind-chassis)`}>
            <path d={cable.path} className="spark-cable-sheath" />
            <path d={cable.path} className="spark-cable-edge" stroke={`url(#${id}-${cable.direction})`} />
            <path d={cable.path} pathLength="100" className="spark-cable-pulse spark-cable-halo"
              stroke={`url(#${id}-${cable.direction})`} style={{ animationDelay: cable.delay }} />
            <path d={cable.path} pathLength="100" className="spark-cable-pulse"
              stroke={`url(#${id}-${cable.direction})`} style={{ animationDelay: cable.delay }} />
          </g>
        ))}
        {showLabels && <g className="spark-flow-labels">
          <text x="488" y="22" textAnchor="end">INPUT</text>
          <text x="488" y="221" textAnchor="end">OUTPUT</text>
        </g>}
    </g>
  );
}
