"use client";

import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";

interface VisualizerProps {
  isPlaying: boolean;
  showHud: boolean;
  isRecording: boolean;
  diffFreq: number;
  baseFreq: number;
  brainStateName: string;
  elapsed: number;
  traceAColor: string;
  traceBColor: string;
  stateColor: string;
}

function formatTimeWithTenths(ms: number) {
  const totalTenths = Math.floor(ms / 100);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(ms / 1000);
  
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  
  if (h > 0) {
    return `${h.toString().padStart(2, "0")}:${m
      .toString()
      .padStart(2, "0")}:${s.toString().padStart(2, "0")}.${tenths}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${tenths}`;
}

export interface VisualizerHandle {
  getCanvas: () => HTMLCanvasElement | null;
}

const Visualizer = forwardRef<VisualizerHandle, VisualizerProps>(
  function Visualizer(
    {
      isPlaying,
      showHud,
      isRecording,
      diffFreq,
      baseFreq,
      brainStateName,
      elapsed,
      traceAColor,
      traceBColor,
      stateColor,
    },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const animRef = useRef<number>(0);
    const timeRef = useRef(0);
    const recordingStartTimeRef = useRef<number | null>(null);
    const logoImgRef = useRef<HTMLImageElement | null>(null);
    const dprRef = useRef(1);

    // Carrega o logotipo
    useEffect(() => {
      const img = new Image();
      img.src = "/logo.png";
      img.onload = () => {
        logoImgRef.current = img;
      };
    }, []);

    // Expose canvas to parent for recording
    useImperativeHandle(ref, () => ({
      getCanvas: () => canvasRef.current,
    }));

    // Props as refs for animation loop
    const isPlayingRef = useRef(isPlaying);
    const showHudRef = useRef(showHud);
    const isRecordingRef = useRef(isRecording);
    const diffFreqRef = useRef(diffFreq);
    const baseFreqRef = useRef(baseFreq);
    const brainStateNameRef = useRef(brainStateName);
    const elapsedRef = useRef(elapsed);
    const traceAColorRef = useRef(traceAColor);
    const traceBColorRef = useRef(traceBColor);
    const stateColorRef = useRef(stateColor);

    useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
    useEffect(() => { showHudRef.current = showHud; }, [showHud]);
    useEffect(() => { 
      isRecordingRef.current = isRecording; 
      if (isRecording) {
        recordingStartTimeRef.current = performance.now();
      } else {
        recordingStartTimeRef.current = null;
      }
    }, [isRecording]);
    useEffect(() => { diffFreqRef.current = diffFreq; }, [diffFreq]);
    useEffect(() => { baseFreqRef.current = baseFreq; }, [baseFreq]);
    useEffect(() => { brainStateNameRef.current = brainStateName; }, [brainStateName]);
    useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);
    useEffect(() => { traceAColorRef.current = traceAColor; }, [traceAColor]);
    useEffect(() => { traceBColorRef.current = traceBColor; }, [traceBColor]);
    useEffect(() => { stateColorRef.current = stateColor; }, [stateColor]);

    // Resize handler
    useEffect(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const resize = () => {
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;
        const targetRatio = 16 / 9;
        const winRatio = winWidth / winHeight;

        let w: number, h: number;
        if (winRatio > targetRatio) {
          h = winHeight;
          w = winHeight * targetRatio;
        } else {
          w = winWidth;
          h = winWidth / targetRatio;
        }

        // Tamanho visual do contêiner (CSS) para responsividade
        container.style.width = w + "px";
        container.style.height = h + "px";

        // Tamanho INTERNO do canvas sempre travado em 1920x1080 (Full HD)
        // Isso garante que a gravação saia em alta qualidade mesmo que a janela esteja pequena
        canvas.width = 1920;
        canvas.height = 1080;
        dprRef.current = 1;
      };

      resize();
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }, []);

    // Animation loop
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const draw = () => {
        const dpr = dprRef.current;
        // width e height reais em CSS pixels para facilitar o desenho
        const width = canvas.width / dpr;
        const height = canvas.height / dpr;

        ctx.save();
        ctx.scale(dpr, dpr);

        // Trail effect
        ctx.fillStyle = "rgba(2, 4, 10, 0.25)";
        ctx.fillRect(0, 0, width, height);

        // Grid
        drawGrid(ctx, width, height, stateColorRef.current);

        timeRef.current += 0.02;
        const time = timeRef.current;
        const playing = isPlayingRef.current;
        const centerY = height / 2;
        const amp = playing ? height * 0.15 : 10;
        const zoom = 0.005;
        const diff = diffFreqRef.current;

        // Frequencia 1 (L)
        ctx.save();
        ctx.shadowBlur = playing ? 25 : 5;
        ctx.shadowColor = traceAColorRef.current;
        ctx.beginPath();
        ctx.strokeStyle = playing
          ? traceAColorRef.current
          : "rgba(100, 100, 100, 0.3)";
        ctx.lineWidth = playing ? 3 : 1.5;
        for (let x = 0; x < width; x += 2) {
          const y =
            centerY +
            Math.sin(x * zoom + time * 5) * amp;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();

        // Frequencia 2 (R)
        ctx.save();
        ctx.shadowBlur = playing ? 25 : 5;
        ctx.shadowColor = traceBColorRef.current;
        ctx.beginPath();
        ctx.strokeStyle = playing
          ? traceBColorRef.current
          : "rgba(100, 100, 100, 0.3)";
        ctx.lineWidth = playing ? 3 : 1.5;
        for (let x = 0; x < width; x += 2) {
          const waveFreq = 5 + diff / 10;
          const y =
            centerY +
            Math.sin(x * zoom + time * waveFreq) * amp;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();

        // Overlay HUD if recording
        if (showHudRef.current) {
          // ==============================
          // Frequência 1 (Top Left)
          // ==============================
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          
          // Label
          ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
          ctx.font = "600 12px 'Outfit', system-ui, sans-serif";
          ctx.fillText("LEFT".split("").join(String.fromCharCode(8202)), 40, 40);
          
          // Value
          ctx.fillStyle = traceAColorRef.current;
          ctx.font = "600 28px 'Outfit', monospace";
          ctx.fillText(`${baseFreqRef.current.toFixed(1)} Hz`, 40, 58);

          // ==============================
          // Frequência 2 (Top Right)
          // ==============================
          ctx.textAlign = "right";
          
          // Label
          ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
          ctx.font = "600 12px 'Outfit', system-ui, sans-serif";
          ctx.fillText("RIGHT".split("").join(String.fromCharCode(8202)), width - 40, 40);
          
          // Value
          ctx.fillStyle = traceBColorRef.current;
          ctx.font = "600 28px 'Outfit', monospace";
          ctx.fillText(`${(baseFreqRef.current + diffFreqRef.current).toFixed(1)} Hz`, width - 40, 58);

          // ==============================
          // Binaural Beat (Centro)
          // ==============================
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
          ctx.font = "600 16px 'Outfit', system-ui, sans-serif";
          
          const labelStr = "BINAURAL BEAT".split("").join(String.fromCharCode(8202));
          ctx.fillText(labelStr, width / 2, 45);
          
          ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
          ctx.font = "800 64px 'Outfit', monospace";
          ctx.fillText(`${diffFreqRef.current.toFixed(1)}Hz`, width / 2, 70);

          // ==============================
          // Cronômetro (Bottom Right)
          // ==============================
          let elapsedMs = 0;
          if (recordingStartTimeRef.current) {
            elapsedMs = performance.now() - recordingStartTimeRef.current;
          }
          const timeStr = formatTimeWithTenths(elapsedMs);
          ctx.textAlign = "right";
          ctx.textBaseline = "bottom";
          
          // Label
          ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
          ctx.font = "600 12px 'Outfit', system-ui, sans-serif";
          ctx.fillText("REC TIME".split("").join(String.fromCharCode(8202)), width - 40, height - 70);

          // Value
          ctx.font = "600 32px 'Outfit', monospace";
          ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
          ctx.fillText(timeStr, width - 40, height - 40);

          // ==============================
          // Bottom State Name (Centro)
          // ==============================
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.font = "800 28px 'Outfit', system-ui, sans-serif";
          ctx.fillStyle = stateColorRef.current;
          
          const stateStr = `${brainStateNameRef.current} STATE`.toUpperCase();
          const spacedStr = stateStr.split("").join(String.fromCharCode(8198)); // Six-per-em space for tracking
          ctx.fillText(spacedStr, width / 2, height - 40);

          // Watermark removida definitivamente para evitar manchas no video
        }

        ctx.restore(); // Restore dpr scaling

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

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  stateColor: string
) {
  // Subtle grid
  ctx.strokeStyle = "rgba(0, 255, 255, 0.03)";
  ctx.lineWidth = 1;
  const gridSpacing = width / 16;
  for (let x = 0; x < width; x += gridSpacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  const hSpacing = height / 9;
  for (let y = 0; y < height; y += hSpacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Center cross with state color
  ctx.strokeStyle = `${stateColor}15`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width / 2, 0);
  ctx.lineTo(width / 2, height);
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
}

export default Visualizer;
