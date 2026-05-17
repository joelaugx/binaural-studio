"use client";

import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { TimelineScript, interpolateFrequency } from "@/lib/timelineSchema";
import { BRAIN_STATES, getBrainStateFromFreq } from "@/lib/constants";

// ---- TYPES ----

interface TimelineVisualizerProps {
  timeline: TimelineScript | null;
  isPlaying: boolean;
  showHud: boolean;
  isRecording: boolean;
  currentTime: number;        // seconds into timeline
  currentHz: number;           // current interpolated binaural Hz
  currentLabel: string;
  baseFreq: number;
  diffFreq: number;
  brainStateName: string;
  elapsed: number;
  traceAColor: string;
  traceBColor: string;
  stateColor: string;
}

export interface TimelineVisualizerHandle {
  getCanvas: () => HTMLCanvasElement | null;
}

// ---- CONSTANTS ----

// Brain state bands for the Y-axis (bottom to top)
const BANDS = [
  { name: "Delta",  min: 0,   max: 4,   color: BRAIN_STATES.Delta.color },
  { name: "Theta",  min: 4,   max: 8,   color: BRAIN_STATES.Theta.color },
  { name: "Alpha",  min: 8,   max: 14,  color: BRAIN_STATES.Alpha.color },
  { name: "Beta",   min: 14,  max: 30,  color: BRAIN_STATES.Beta.color },
  { name: "Gamma",  min: 30,  max: 45,  color: BRAIN_STATES.Gamma.color },
];

// Chart layout margins (in 1920x1080 canvas coordinates)
const MARGIN = { top: 140, right: 60, bottom: 80, left: 70 };

// ---- HELPERS ----

function formatTimeAxis(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}`;
}

function formatTimeWithTenths(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const tenths = Math.floor((ms % 1000) / 100);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${tenths}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${tenths}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---- COMPONENT ----

const TimelineVisualizer = forwardRef<TimelineVisualizerHandle, TimelineVisualizerProps>(
  function TimelineVisualizer(props, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const animRef = useRef(0);
    const recordingStartTimeRef = useRef<number | null>(null);

    // Expose canvas to parent for recording
    useImperativeHandle(ref, () => ({
      getCanvas: () => canvasRef.current,
    }));

    // Props as refs for animation loop
    const propsRef = useRef(props);
    propsRef.current = props;

    // Track recording start for HUD timer
    useEffect(() => {
      if (props.isRecording) {
        recordingStartTimeRef.current = performance.now();
      } else {
        recordingStartTimeRef.current = null;
      }
    }, [props.isRecording]);

    // ---- RESIZE ----
    useEffect(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const resize = () => {
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        const ratio = 16 / 9;
        const winRatio = winW / winH;

        let w: number, h: number;
        if (winRatio > ratio) {
          h = winH;
          w = winH * ratio;
        } else {
          w = winW;
          h = winW / ratio;
        }

        container.style.width = w + "px";
        container.style.height = h + "px";

        // Internal resolution always 1920x1080
        canvas.width = 1920;
        canvas.height = 1080;
      };

      resize();
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }, []);

    // ---- ANIMATION LOOP ----
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const draw = () => {
        const p = propsRef.current;
        const W = 1920;
        const H = 1080;

        // ===== BACKGROUND =====
        ctx.fillStyle = "#02040a";
        ctx.fillRect(0, 0, W, H);

        const chartLeft = MARGIN.left;
        const chartRight = W - MARGIN.right;
        const chartTop = MARGIN.top;
        const chartBottom = H - MARGIN.bottom;
        const chartW = chartRight - chartLeft;
        const chartH = chartBottom - chartTop;

        // Determine Y-axis range from timeline data
        const maxHz = p.timeline
          ? Math.max(15, ...p.timeline.timeline.map((kf) => kf.target_binaural_hz) , 15)
          : 15;

        // Map Hz to Y pixel
        const hzToY = (hz: number) => chartBottom - (hz / maxHz) * chartH;
        // Map seconds to X pixel
        const totalDur = p.timeline?.track_metadata.total_duration_seconds ?? 5400;
        const secToX = (s: number) => chartLeft + (s / totalDur) * chartW;

        // ===== BRAIN STATE BANDS =====
        for (const band of BANDS) {
          if (band.min >= maxHz) continue;
          const bandMax = Math.min(band.max, maxHz);
          const y1 = hzToY(bandMax);
          const y2 = hzToY(band.min);
          const bandH = y2 - y1;

          // Gradient fill
          const grad = ctx.createLinearGradient(chartLeft, y1, chartLeft, y2);
          grad.addColorStop(0, hexToRgba(band.color, 0.12));
          grad.addColorStop(1, hexToRgba(band.color, 0.04));
          ctx.fillStyle = grad;
          ctx.fillRect(chartLeft, y1, chartW, bandH);

          // Band border line (bottom)
          ctx.strokeStyle = `rgba(255, 255, 255, 0.06)`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(chartLeft, y2);
          ctx.lineTo(chartRight, y2);
          ctx.stroke();

          // Band label (centered)
          const labelY = y1 + bandH / 2;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = "800 22px 'Inter', system-ui, sans-serif";
          ctx.fillStyle = hexToRgba(band.color, 0.35);
          ctx.shadowColor = band.color;
          ctx.shadowBlur = 15;
          const spacedName = band.name.toUpperCase().split("").join(String.fromCharCode(8202));
          ctx.fillText(spacedName, chartLeft + chartW / 2, labelY);
          ctx.shadowBlur = 0;
        }

        // ===== REM LINE (7 Hz dashed line) =====
        const remY = hzToY(7);
        if (remY > chartTop && remY < chartBottom) {
          ctx.strokeStyle = "rgba(168, 85, 247, 0.25)";
          ctx.lineWidth = 1;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(chartLeft, remY);
          ctx.lineTo(chartRight, remY);
          ctx.stroke();
          ctx.setLineDash([]);

          // REM label
          ctx.textAlign = "left";
          ctx.textBaseline = "bottom";
          ctx.font = "600 11px 'Inter', system-ui, sans-serif";
          ctx.fillStyle = "rgba(168, 85, 247, 0.4)";
          ctx.fillText("REM state", chartLeft + 8, remY - 4);
        }

        // ===== Y-AXIS (Hz labels) =====
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.font = "500 13px 'JetBrains Mono', monospace";
        ctx.fillStyle = hexToRgba(p.traceAColor, 0.4);

        const ySteps = maxHz <= 15 ? [0, 2, 4, 6, 8, 10, 12, 14] : [0, 4, 8, 14, 20, 30, 40];
        for (const hz of ySteps) {
          if (hz > maxHz) continue;
          const y = hzToY(hz);
          ctx.fillText(`${hz}`, chartLeft - 10, y);

          // Subtle grid line (uses traceA color)
          ctx.strokeStyle = hexToRgba(p.traceAColor, 0.06);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(chartLeft, y);
          ctx.lineTo(chartRight, y);
          ctx.stroke();
        }

        // Hz label
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "600 12px 'JetBrains Mono', monospace";
        ctx.fillStyle = hexToRgba(p.traceAColor, 0.3);
        ctx.translate(20, chartTop + chartH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("Hz", 0, 0);
        ctx.restore();

        // ===== X-AXIS (Minutes) =====
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.font = "500 13px 'JetBrains Mono', monospace";
        ctx.fillStyle = hexToRgba(p.traceAColor, 0.4);

        const minuteStep = totalDur <= 1800 ? 5 : totalDur <= 3600 ? 10 : 15;
        for (let s = 0; s <= totalDur; s += minuteStep * 60) {
          const x = secToX(s);
          ctx.fillText(formatTimeAxis(s), x, chartBottom + 10);

          // Vertical grid (uses traceA color)
          ctx.strokeStyle = hexToRgba(p.traceAColor, 0.06);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, chartTop);
          ctx.lineTo(x, chartBottom);
          ctx.stroke();
        }

        // "Minutes" label
        ctx.font = "600 12px 'JetBrains Mono', monospace";
        ctx.fillStyle = hexToRgba(p.traceAColor, 0.3);
        ctx.fillText("Minutes", chartLeft + chartW / 2, chartBottom + 35);

        // ===== TIMELINE PATH =====
        if (p.timeline && p.timeline.timeline.length >= 2) {
          const kfs = p.timeline.timeline;
          const currentSec = p.currentTime;

          // -- Future path (dashed, dim) --
          ctx.save();
          ctx.setLineDash([8, 6]);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
          ctx.lineWidth = 2;
          ctx.beginPath();

          // Draw full path
          for (let i = 0; i < kfs.length; i++) {
            const x = secToX(kfs[i].time_second);
            const y = hzToY(kfs[i].target_binaural_hz);
            if (i === 0) {
              ctx.moveTo(x, y);
            } else {
              // For smooth interpolation, draw with intermediate points
              const prev = kfs[i - 1];
              const steps = 20;
              for (let s = 1; s <= steps; s++) {
                const t = s / steps;
                const timeSec = prev.time_second + (kfs[i].time_second - prev.time_second) * t;
                const result = interpolateFrequency(kfs, timeSec);
                ctx.lineTo(secToX(timeSec), hzToY(result.hz));
              }
            }
          }
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();

          // -- Traversed path (solid, glowing — uses traceA color) --
          if (currentSec > 0) {
            ctx.save();
            ctx.shadowBlur = 18;
            ctx.shadowColor = p.traceAColor;
            ctx.strokeStyle = hexToRgba(p.traceAColor, 0.9);
            ctx.lineWidth = 3;
            ctx.beginPath();

            // Draw from start to currentTime with fine resolution
            const pixelsPerStep = 4;
            const totalPixels = (currentSec / totalDur) * chartW;
            const stepCount = Math.max(1, Math.floor(totalPixels / pixelsPerStep));

            for (let i = 0; i <= stepCount; i++) {
              const t = i / stepCount;
              const timeSec = currentSec * t;
              const result = interpolateFrequency(kfs, timeSec);
              const x = secToX(timeSec);
              const y = hzToY(result.hz);
              if (i === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
            }
            ctx.stroke();
            ctx.restore();

            // -- Current position indicator (uses traceB color) --
            const curX = secToX(currentSec);
            const curY = hzToY(p.currentHz);

            // Outer glow
            ctx.save();
            ctx.shadowBlur = 25;
            ctx.shadowColor = p.traceBColor;
            ctx.fillStyle = p.traceBColor;
            ctx.beginPath();
            ctx.arc(curX, curY, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // Inner white core
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(curX, curY, 5, 0, Math.PI * 2);
            ctx.fill();

            // Ring (traceB color)
            ctx.strokeStyle = hexToRgba(p.traceBColor, 0.8);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(curX, curY, 10, 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        // ===== HUD: FREQUENCY DISPLAY (Top) =====
        const brainState = getBrainStateFromFreq(p.diffFreq);

        // Left Ear
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "600 13px 'Inter', system-ui, sans-serif";
        ctx.fillText("L E F T".split("").join(String.fromCharCode(8202)), 40, 30);
        ctx.fillStyle = p.traceAColor;
        ctx.font = "600 30px 'JetBrains Mono', monospace";
        ctx.fillText(`${p.baseFreq.toFixed(1)} Hz`, 40, 50);

        // Right Ear
        ctx.textAlign = "right";
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "600 13px 'Inter', system-ui, sans-serif";
        ctx.fillText("R I G H T".split("").join(String.fromCharCode(8202)), W - 40, 30);
        ctx.fillStyle = p.traceBColor;
        ctx.font = "600 30px 'JetBrains Mono', monospace";
        ctx.fillText(`${(p.baseFreq + p.diffFreq).toFixed(1)} Hz`, W - 40, 50);

        // Binaural Result (center)
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "600 16px 'Inter', system-ui, sans-serif";
        ctx.fillText("B I N A U R A L   B E A T", W / 2, 30);
        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.font = "800 56px 'JetBrains Mono', monospace";
        ctx.fillText(`${p.diffFreq.toFixed(1)}Hz`, W / 2, 58);

        // ===== HUD: BOTTOM BAR =====
        // State name (center-bottom)
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.font = "800 24px 'Inter', system-ui, sans-serif";
        ctx.fillStyle = brainState.color;
        ctx.shadowColor = brainState.color;
        ctx.shadowBlur = 12;
        const stateStr = `${p.brainStateName} STATE`.toUpperCase();
        const spacedState = stateStr.split("").join(String.fromCharCode(8198));
        ctx.fillText(spacedState, W / 2, H - 28);
        ctx.shadowBlur = 0;

        // Timeline progress time (bottom-left)
        if (p.timeline) {
          const totalMin = Math.floor(p.timeline.track_metadata.total_duration_seconds / 60);
          const curMin = Math.floor(p.currentTime / 60);
          const curSec = Math.floor(p.currentTime % 60);
          ctx.textAlign = "left";
          ctx.textBaseline = "bottom";
          ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
          ctx.font = "600 12px 'Inter', system-ui, sans-serif";
          ctx.fillText("TIMELINE", 40, H - 55);
          ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
          ctx.font = "600 28px 'JetBrains Mono', monospace";
          ctx.fillText(
            `${curMin.toString().padStart(2, "0")}:${curSec.toString().padStart(2, "0")} / ${totalMin}min`,
            40, H - 28
          );
        }

        // Recording timer (bottom-right)
        if (p.showHud && recordingStartTimeRef.current) {
          const recMs = performance.now() - recordingStartTimeRef.current;
          const timeStr = formatTimeWithTenths(recMs);

          ctx.textAlign = "right";
          ctx.textBaseline = "bottom";
          ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
          ctx.font = "600 12px 'Inter', system-ui, sans-serif";
          ctx.fillText("R E C   T I M E", W - 40, H - 55);
          ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
          ctx.font = "600 28px 'JetBrains Mono', monospace";
          ctx.fillText(timeStr, W - 40, H - 28);
        }

        animRef.current = requestAnimationFrame(draw);
      };

      animRef.current = requestAnimationFrame(draw);
      return () => cancelAnimationFrame(animRef.current);
    }, []);

    return (
      <div
        ref={containerRef}
        className="relative flex items-center justify-center overflow-hidden"
        style={{
          backgroundColor: "var(--color-bg-deep)",
          boxShadow: "0 0 80px rgba(0,0,0,0.7)",
        }}
      >
        <canvas ref={canvasRef} className="block w-full h-full" />
      </div>
    );
  }
);

export default TimelineVisualizer;
