import React, { useEffect, useId, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import "./spark-flow.css";

// Decorative paths only. Never derive measurements or operational status from this scene.
const CABLES = [
  { path: "M 490 35 H 407 C 368 35 362 12 330 24 L 242 66", direction: "in", delay: "-0.6s" },
  { path: "M 490 108 H 438 C 390 108 404 31 352 42 L 275 78", direction: "in", delay: "-2.1s" },
  { path: "M 306 84 L 355 63 C 411 40 393 200 450 200 H 490", direction: "out", delay: "-1.3s" },
];

export default function SparkFlow({ active = true }) {
  const id = useId().replace(/:/g, "");
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
    <figure ref={scene} className="spark-flow" data-paused={paused || !active || !visible || !pageVisible}
      aria-label="DGX Spark illustration with decorative token-flow animation">
      <button type="button" className="spark-flow-toggle" aria-pressed={paused}
        aria-label={paused ? "Play decorative animation" : "Pause decorative animation"}
        onClick={() => setPaused(value => !value)}>
        {paused ? <Play size={13} /> : <Pause size={13} />}
      </button>
      <svg className="spark-flow-scene" viewBox="0 0 510 230" aria-hidden="true" focusable="false">
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
          <mask id={`${id}-artwork-cutout`} maskUnits="userSpaceOnUse" x="0" y="0" width="345" height="230"
            style={{ maskType: "alpha" }}>
            {/* Fade the original ground reflection only. The opaque chassis
                below keeps the hardware and its thin light strip unchanged. */}
            <ellipse className="spark-underglow" cx="177" cy="172" rx="164" ry="51" fill={`url(#${id}-ground-fade)`} />
            <path d="M 18 80 L 149 44 L 329 72 L 329 132 L 205 188 L 18 142 Z"
              fill="white" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
          </mask>
        </defs>
        <image href="/dgx-spark-flow-v4.png" x="0" y="0" width="345" height="230"
          mask={`url(#${id}-artwork-cutout)`} />
        {CABLES.map(cable => (
          <g key={cable.path} className={`spark-cable spark-cable-${cable.direction}`} clipPath={`url(#${id}-behind-chassis)`}>
            <path d={cable.path} className="spark-cable-sheath" />
            <path d={cable.path} className="spark-cable-edge" stroke={`url(#${id}-${cable.direction})`} />
            <path d={cable.path} pathLength="100" className="spark-cable-pulse spark-cable-halo"
              stroke={`url(#${id}-${cable.direction})`} style={{ animationDelay: cable.delay }} />
            <path d={cable.path} pathLength="100" className="spark-cable-pulse"
              stroke={`url(#${id}-${cable.direction})`} style={{ animationDelay: cable.delay }} />
          </g>
        ))}
        <g className="spark-flow-labels">
          <text x="488" y="22" textAnchor="end">INPUT</text>
          <text x="488" y="221" textAnchor="end">OUTPUT</text>
        </g>
      </svg>
    </figure>
  );
}
