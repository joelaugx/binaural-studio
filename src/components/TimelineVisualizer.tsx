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
  axesColor: string;
  curveColor: string;
  cursorColor: string;
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
  { name: "Gamma",  min: 30,  max: 65,  color: BRAIN_STATES.Gamma.color },
];

// Chart layout margins (in 1920x1080 canvas coordinates)
const MARGIN = { top: 180, right: 60, bottom: 80, left: 70 };

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
  if (!hex || typeof hex !== "string") return `rgba(255, 255, 255, ${alpha})`;
  if (hex.startsWith("rgb")) return hex;
  
  const cleanHex = hex.replace("#", "");
  let r = 255, g = 255, b = 255;
  
  if (cleanHex.length === 6) {
    r = parseInt(cleanHex.slice(0, 2), 16);
    g = parseInt(cleanHex.slice(2, 4), 16);
    b = parseInt(cleanHex.slice(4, 6), 16);
  } else if (cleanHex.length === 3) {
    r = parseInt(cleanHex[0] + cleanHex[0], 16);
    g = parseInt(cleanHex[1] + cleanHex[1], 16);
    b = parseInt(cleanHex[2] + cleanHex[2], 16);
  }
  
  if (isNaN(r)) r = 255;
  if (isNaN(g)) g = 255;
  if (isNaN(b)) b = 255;
  
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
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
        const bgGrad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.8);
        bgGrad.addColorStop(0, "#1b0a33");
        bgGrad.addColorStop(1, "#000000");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, W, H);

        const chartLeft = MARGIN.left;
        const chartRight = W - MARGIN.right;
        const chartTop = MARGIN.top;
        const chartBottom = H - MARGIN.bottom;
        const chartW = chartRight - chartLeft;
        const chartH = chartBottom - chartTop;

        // Determine Y-axis range from timeline data
        let maxTimelineHz = p.timeline
          ? Math.max(15, ...p.timeline.timeline.map((kf) => kf.target_binaural_hz))
          : 15;
        
        // If it goes into Gamma, extend the chart up to 65Hz so it doesn't touch the ceiling
        const maxHz = maxTimelineHz > 30 ? 65 : maxTimelineHz > 15 ? 30 : 15;

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

          // Band label (centered -> moved to right)
          const labelY = y1 + bandH / 2;
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          ctx.font = "800 22px 'Outfit', system-ui, sans-serif";
          ctx.fillStyle = hexToRgba(band.color, 0.35);
          ctx.shadowColor = band.color;
          ctx.shadowBlur = 15;
          const spacedName = band.name.toUpperCase().split("").join(String.fromCharCode(8202));
          ctx.fillText(spacedName, chartRight - 20, labelY);
          ctx.shadowBlur = 0;
        }



        // ===== Y-AXIS (Hz labels) =====
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.font = "500 21px 'Outfit', monospace";
        ctx.fillStyle = hexToRgba(p.axesColor, 1.0);

        let ySteps: number[];
        if (maxHz <= 15) {
          ySteps = [0, 2, 4, 6, 8, 10, 12, 14];
        } else if (maxHz <= 30) {
          ySteps = [0, 4, 8, 14, 20, 30];
        } else {
          ySteps = [0, 4, 8, 14, 20, 30, 40, 50, 60, 70, 80].filter(y => y <= Math.ceil(maxHz) + 5);
        }
        for (const hz of ySteps) {
          if (hz > maxHz) continue;
          const y = hzToY(hz);
          ctx.fillText(`${hz}`, chartLeft - 15, y);

          // Subtle grid line (uses axesColor)
          ctx.strokeStyle = hexToRgba(p.axesColor, 0.2);
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
        ctx.font = "600 18px 'Outfit', monospace";
        ctx.fillStyle = hexToRgba(p.axesColor, 0.8);
        ctx.translate(30, chartTop + chartH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("Hz", 0, 0);
        ctx.restore();

        // ===== X-AXIS (Minutes) =====
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.font = "500 21px 'Outfit', monospace";
        ctx.fillStyle = hexToRgba(p.axesColor, 1.0);

        const minuteStep = totalDur <= 1800 ? 5 : totalDur <= 3600 ? 10 : 15;
        for (let s = 0; s <= totalDur; s += minuteStep * 60) {
          const x = secToX(s);
          ctx.fillText(formatTimeAxis(s), x, chartBottom + 15);

          // Vertical grid (uses axesColor)
          ctx.strokeStyle = hexToRgba(p.axesColor, 0.2);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, chartTop);
          ctx.lineTo(x, chartBottom);
          ctx.stroke();
        }

        // "Minutes" label
        ctx.font = "600 18px 'Outfit', monospace";
        ctx.fillStyle = hexToRgba(p.axesColor, 0.8);
        ctx.fillText("Minutes", chartLeft + chartW / 2, chartBottom + 50);

        // ===== TIMELINE PATH =====
        if (p.timeline && p.timeline.timeline.length >= 2) {
          const kfs = p.timeline.timeline;
          const currentSec = p.currentTime;

          // -- Future path (dashed, dim) --
          ctx.save();
          ctx.setLineDash([8, 6]);
          ctx.strokeStyle = hexToRgba(p.curveColor, 0.4);
          ctx.lineWidth = 3;
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

          // -- Traversed path (solid, glowing — uses curveColor) --
          if (currentSec > 0) {
            ctx.save();
            ctx.shadowBlur = 18;
            ctx.shadowColor = p.curveColor;
            ctx.strokeStyle = hexToRgba(p.curveColor, 1.0);
            ctx.lineWidth = 5;
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
          }

          // -- Current position indicator (uses cursorColor) --
          const curX = secToX(currentSec);
          const curY = hzToY(p.currentHz);
          
          // Sonar / Radar expanding ring effect
          const duration = 1500; // 1.5s per pulse
          const pulseProgress = (performance.now() % duration) / duration;
          const baseRadius = 12;
          const maxExpand = baseRadius * 1.6; // Expands up to +60% of base diameter
          const currentExpandRadius = baseRadius + (maxExpand * pulseProgress);
          const fadeAlpha = 1.0 - pulseProgress;

          // Expanding Sonar Ring
          ctx.save();
          ctx.strokeStyle = hexToRgba(p.cursorColor, fadeAlpha);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(curX, curY, currentExpandRadius, 0, Math.PI * 2);
          ctx.stroke();
          
          // Fixed Outer Glow
          ctx.shadowBlur = 20;
          ctx.shadowColor = p.cursorColor;
          ctx.fillStyle = hexToRgba(p.cursorColor, 0.5);
          ctx.beginPath();
          ctx.arc(curX, curY, baseRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // Inner white core
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(curX, curY, 6, 0, Math.PI * 2);
          ctx.fill();

          // Fixed Ring (cursorColor)
          ctx.strokeStyle = hexToRgba(p.cursorColor, 1.0);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(curX, curY, baseRadius, 0, Math.PI * 2);
          ctx.stroke();

        }

        // ===== HUD: FREQUENCY DISPLAY (Top) =====
        const brainState = getBrainStateFromFreq(p.diffFreq);

        // Left Ear
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "600 13px 'Outfit', system-ui, sans-serif";
        ctx.fillText("L E F T".split("").join(String.fromCharCode(8202)), 40, 30);
        ctx.fillStyle = p.curveColor;
        ctx.font = "600 30px 'Outfit', monospace";
        ctx.fillText(`${p.baseFreq.toFixed(1)} Hz`, 40, 50);

        // Right Ear
        ctx.textAlign = "right";
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "600 13px 'Outfit', system-ui, sans-serif";
        ctx.fillText("R I G H T".split("").join(String.fromCharCode(8202)), W - 40, 30);
        ctx.fillStyle = p.cursorColor;
        ctx.font = "600 30px 'Outfit', monospace";
        ctx.fillText(`${(p.baseFreq + p.diffFreq).toFixed(1)} Hz`, W - 40, 50);

        // Binaural Result (center)
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "600 15px 'Outfit', system-ui, sans-serif";
        ctx.fillText("B I N A U R A L   B E A T", W / 2, 25);
        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.font = "800 54px 'Outfit', monospace";
        ctx.fillText(`${p.diffFreq.toFixed(1)}Hz`, W / 2, 45);

        // Rest Banner (Flashy inverted box) fixed at top HUD between left and center
        if (p.timeline?.track_metadata.name.toLowerCase().includes("pomodoro") && p.currentHz <= 14) {
          ctx.save();
          ctx.font = "800 36px 'Outfit', monospace"; // Increased by 50%
          const text = "D E S C A N S E";
          const metrics = ctx.measureText(text);
          const padX = 36; // Increased by 50%
          const padY = 18; // Increased by 50%
          const boxW = metrics.width + padX * 2;
          const boxH = 66; // Increased by 50%
          
          // Position between left trace and center: W/4
          const boxCenterX = W / 4;
          const boxX = boxCenterX - boxW / 2;
          // Align with the HUD vertically
          const boxY = 22;
          
          // Draw glowing box
          ctx.fillStyle = p.cursorColor;
          ctx.shadowColor = p.cursorColor;
          ctx.shadowBlur = 30; // Increased shadow
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(boxX, boxY, boxW, boxH, 12); // Slightly larger radius
          } else {
            ctx.rect(boxX, boxY, boxW, boxH);
          }
          ctx.fill();
          
          // Draw text
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#000000"; // inverted text for high contrast
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(text, boxCenterX, boxY + boxH / 2 + 2);
          ctx.restore();
        }

        // ===== HUD: TIMER (Top Center) =====
        if (p.timeline) {
          const totalMin = Math.floor(p.timeline.track_metadata.total_duration_seconds / 60);
          let timeStr = "00:00.0";
          
          if (p.showHud && recordingStartTimeRef.current) {
            // Live recording timer
            const recMs = Math.max(0, performance.now() - recordingStartTimeRef.current);
            timeStr = formatTimeWithTenths(recMs);
          } else if (p.currentTime > 0) {
            // Playback without recording
            timeStr = formatTimeWithTenths(p.currentTime * 1000);
          }

          ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
          ctx.font = "600 11px 'Outfit', system-ui, sans-serif";
          ctx.fillText("T I M E L I N E   P R O G R E S S", W / 2, 105);
          
          ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
          ctx.font = "600 22px 'Outfit', monospace";
          
          // Separator
          ctx.textAlign = "center";
          ctx.fillText("/", W / 2, 120);
          
          // Timer (right-aligned to prevent shifting the rest)
          ctx.textAlign = "right";
          ctx.fillText(timeStr, W / 2 - 15, 120);
          
          // Duration (left-aligned to stay completely static)
          ctx.textAlign = "left";
          ctx.fillText(`${totalMin}min`, W / 2 + 15, 120);
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
          background: "radial-gradient(circle at center, #1b0a33 0%, #000000 90%)",
          boxShadow: "0 0 80px rgba(0,0,0,0.7)",
        }}
      >
        <canvas ref={canvasRef} className="block w-full h-full" />
      </div>
    );
  }
);

export default TimelineVisualizer;
