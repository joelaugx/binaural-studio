"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Visualizer, { VisualizerHandle } from "@/components/Visualizer";
import { useAudioEngine } from "@/hooks/useAudioEngine";
import { useRecorder } from "@/hooks/useRecorder";
import {
  BRAIN_STATES,
  getBrainStateFromFreq,
  AVAILABLE_SOUNDS,
  AVAILABLE_MUSIC,
  PRESET_DURATIONS,
  formatTime,
} from "@/lib/constants";
import NoSleep from "nosleep.js";

export default function StudioPage() {
  const audio = useAudioEngine();
  const recorder = useRecorder();
  const vizRef = useRef<VisualizerHandle>(null);

  // UI state
  const [traceAColor, setTraceAColor] = useState("#3b82f6");
  const [traceBColor, setTraceBColor] = useState("#10b981");
  const [isRecordingMode, setIsRecordingMode] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mouseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noSleepRef = useRef<any>(null);

  useEffect(() => {
    // Inicializa NoSleep no lado do cliente
    noSleepRef.current = new NoSleep();
  }, []);

  const brainState = getBrainStateFromFreq(audio.diffFreq);

  // Update CSS custom property for state color
  useEffect(() => {
    document.documentElement.style.setProperty("--color-state", brainState.color);
  }, [brainState.color]);

  // ---- TIMER ----
  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimerSeconds((prev) => prev + 0.1);
    }, 100);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetTimer = useCallback(() => {
    stopTimer();
    setTimerSeconds(0);
  }, [stopTimer]);

  // ---- RECORDING SEQUENCE ----
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;

  const startRecordingSequence = useCallback(async () => {
    // Ativar proteção contra descanso de tela IMEDIATAMENTE no clique do usuário
    if (noSleepRef.current) {
      try {
        await noSleepRef.current.enable();
      } catch (e) {
        console.warn("NoSleep failed to enable:", e);
      }
    }

    // 1. Pedir permissão de gravação de arquivo no HD ANTES do delay (gesto síncrono do usuário)
    const canProceed = await recorderRef.current.prepareRecording();
    if (!canProceed) {
      if (noSleepRef.current) noSleepRef.current.disable();
      return; // Aborta se o usuário cancelou a janela Salvar Como
    }

    setIsRecordingMode(true);
    document.body.classList.add("recording-mode");
    resetTimer();

    // Force audio on
    if (!audioRef.current.isPlaying) {
      await audioRef.current.toggle();
    }

    // Countdown 5→1
    for (let i = 5; i > 0; i--) {
      setCountdown(i);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setCountdown(null);

    // Start timer and recording
    startTimer();
    const canvas = vizRef.current?.getCanvas();
    if (canvas) {
      recorderRef.current.startRecording(canvas, audioRef.current.getAudioStream(), 30);
    }
  }, [resetTimer, startTimer]);

  const stopRecordingSequence = useCallback(() => {
    recorderRef.current.stopRecording();
    stopTimer();
    setIsRecordingMode(false);
    if (mouseTimerRef.current) clearTimeout(mouseTimerRef.current);
    document.body.classList.remove("recording-mode");
    
    if (noSleepRef.current) {
      noSleepRef.current.disable();
    }
  }, [stopTimer]);

  const restoreUI = useCallback(() => {
    if (recorderRef.current.isRecording) {
      stopRecordingSequence();
    }
    setIsRecordingMode(false);
    document.body.classList.remove("recording-mode");
    
    if (noSleepRef.current) {
      noSleepRef.current.disable();
    }
  }, [stopRecordingSequence]);

  // ---- KEYBOARD ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "h") restoreUI();
      if (e.key === " " && isRecordingMode) {
        e.preventDefault();
        stopRecordingSequence();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [restoreUI, isRecordingMode, stopRecordingSequence]);

  // ---- MOUSE AUTO-HIDE ----
  const isRecordingModeRef = useRef(isRecordingMode);
  
  useEffect(() => {
    isRecordingModeRef.current = isRecordingMode;
    if (!isRecordingMode) {
      if (mouseTimerRef.current) clearTimeout(mouseTimerRef.current);
      document.body.classList.remove("recording-mode");
    }
  }, [isRecordingMode]);

  useEffect(() => {
    const handler = () => {
      if (isRecordingModeRef.current) {
        document.body.classList.remove("recording-mode");
        if (mouseTimerRef.current) clearTimeout(mouseTimerRef.current);
        mouseTimerRef.current = setTimeout(() => {
          if (isRecordingModeRef.current) {
            document.body.classList.add("recording-mode");
          }
        }, 3000);
      }
    };
    window.addEventListener("mousemove", handler);
    return () => {
      window.removeEventListener("mousemove", handler);
      if (mouseTimerRef.current) clearTimeout(mouseTimerRef.current);
    };
  }, []);

  // ---- PRESET BUTTON ----
  const selectPreset = useCallback(
    (stateName: string) => {
      const state = BRAIN_STATES[stateName];
      if (!state) return;
      const midpoint = (state.range[0] + state.range[1]) / 2;
      audioRef.current.setDiffFreq(parseFloat(midpoint.toFixed(1)));
    },
    []
  );

  // ---- CLEANUP ----
  const cleanupRef = useRef(audio.cleanup);
  cleanupRef.current = audio.cleanup;
  useEffect(() => {
    return () => {
      cleanupRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="relative flex items-center justify-center h-screen w-screen overflow-hidden bg-black">
      {/* ===== CANVAS ===== */}
      <Visualizer
        ref={vizRef}
        isPlaying={audio.isPlaying}
        showHud={isRecordingMode}
        isRecording={recorder.isRecording}
        diffFreq={audio.diffFreq}
        baseFreq={audio.baseFreq}
        brainStateName={brainState.name}
        elapsed={recorder.elapsed}
        traceAColor={traceAColor}
        traceBColor={traceBColor}
        stateColor={brainState.color}
      />

      {/* ===== COUNTDOWN OVERLAY ===== */}
      {countdown !== null && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none"
          key={countdown}
        >
          <span
            className="text-[14rem] font-black text-white animate-fade-in"
            style={{
              textShadow: `0 0 60px ${brainState.color}, 0 0 120px ${brainState.color}`,
            }}
          >
            {countdown}
          </span>
        </div>
      )}

      {/* ===== RECORDING STATE TAG (Removido pois foi movido para o Canvas) ===== */}

      {/* ===== HEADER BAR ===== */}
      {!isRecordingMode && (
        <header className="fixed top-4 left-1/2 -translate-x-1/2 w-[96%] max-w-[1400px] z-20 glass rounded-2xl p-4 px-6 flex justify-between items-center shadow-2xl">
        <h1 className="text-lg font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-400 to-emerald-400 uppercase">
          Binaural Studio
        </h1>

        <div className="flex items-center gap-3">
          {/* Brain State Buttons */}
          <nav className="flex bg-black/40 p-1 rounded-xl border border-white/5">
            {Object.keys(BRAIN_STATES).map((key) => {
              const state = BRAIN_STATES[key];
              const isActive = brainState.name === key;
              return (
                <button
                  key={key}
                  onClick={() => selectPreset(key)}
                  className="btn-state px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all"
                  style={{
                    backgroundColor: isActive ? state.color : "transparent",
                    color: isActive ? "#fff" : "#94a3b8",
                    boxShadow: isActive
                      ? `0 0 20px ${state.color}`
                      : "none",
                    borderColor: isActive
                      ? "rgba(255,255,255,0.5)"
                      : "transparent",
                    border: isActive
                      ? "1px solid rgba(255,255,255,0.5)"
                      : "1px solid transparent",
                  }}
                >
                  {key}
                </button>
              );
            })}
          </nav>

          {/* Audio Toggle */}
          <button
            onClick={audio.toggle}
            title={audio.isPlaying ? "Pausar Áudio" : "Tocar Áudio"}
            className="w-12 h-12 flex items-center justify-center rounded-2xl shadow-[0_0_20px_rgba(37,99,235,0.3)] transition-all hover:scale-105"
            style={{
              backgroundColor: audio.isPlaying ? "#1e3a8a" : "#2563eb",
            }}
          >
            <span className="text-2xl ml-1 leading-none">
              {audio.isPlaying ? "⏸" : "▶"}
            </span>
          </button>

          {/* Record Button */}
          <button
            onClick={
              isRecordingMode ? stopRecordingSequence : startRecordingSequence
            }
            title={isRecordingMode ? "Parar Gravação" : "Iniciar Gravação"}
            className="w-12 h-12 flex items-center justify-center rounded-2xl shadow-[0_0_25px_rgba(220,38,38,0.5)] transition-all animate-pulse-glow hover:scale-105"
            style={{
              backgroundColor: isRecordingMode ? "#7f1d1d" : "#dc2626",
            }}
          >
            <span className="text-3xl leading-none" style={{ color: "#ffffff" }}>
              {isRecordingMode ? "⏹" : "⏺"}
            </span>
          </button>
        </div>
        </header>
      )}

      {/* ===== HUD (Data Bar) ===== */}
      {!isRecordingMode && (
        <div
          className="fixed z-30 glass shadow-2xl flex items-center justify-between top-[120px] left-1/2 -translate-x-1/2 w-[90%] max-w-[1100px] rounded-2xl p-3 px-8"
          style={{
            borderColor: "transparent",
          }}
        >
          {/* Left: State + Timer */}
        <div className="flex items-center gap-6">
          <div className="text-left border-r border-white/10 pr-6">
            <div className="flex items-center gap-3 mb-0.5">
              <span
                className={`w-3 h-3 rounded-full ${
                  recorder.isRecording
                    ? "bg-red-600 animate-rec-blink"
                    : audio.isPlaying
                      ? "bg-green-500"
                      : "bg-slate-600"
                }`}
              />
              <span
                className="text-sm font-black uppercase tracking-[0.2em]"
                style={{
                  color: brainState.color,
                  textShadow: `0 0 10px ${brainState.color}`,
                }}
              >
                {brainState.name} State
              </span>
            </div>
            <div
              className="text-4xl font-black leading-none tracking-tighter text-white"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {formatTime(recorder.isRecording ? recorder.elapsed : timerSeconds)}
            </div>
          </div>

          {/* Timer Controls (hidden in recording mode) */}
          {!isRecordingMode && (
            <div className="ui-hideable flex flex-col gap-0.5">
              <button
                onClick={() =>
                  timerRef.current ? stopTimer() : startTimer()
                }
                className="bg-slate-800 hover:bg-slate-700 px-3 py-1 rounded text-[9px] font-black transition uppercase"
              >
                {timerRef.current ? "Stop" : "Start"}
              </button>
              <button
                onClick={resetTimer}
                className="bg-slate-900 hover:bg-slate-800 px-3 py-1 rounded text-[9px] font-black transition text-slate-500 uppercase"
              >
                Reset
              </button>
            </div>
          )}
        </div>

        {/* Right: Frequencies */}
        <div className="flex items-center gap-8">
          <div className="text-center">
            <p className="text-[9px] text-slate-500 uppercase font-black mb-0.5 tracking-widest">
              Trace A (L)
            </p>
            <p
              className="text-2xl font-black"
              style={{ color: traceAColor, fontFamily: "var(--font-mono)" }}
            >
              {audio.baseFreq.toFixed(1)}Hz
            </p>
          </div>
          <div className="text-center">
            <p className="text-[9px] text-slate-500 uppercase font-black mb-0.5 tracking-widest">
              Trace B (R)
            </p>
            <p
              className="text-2xl font-black"
              style={{ color: traceBColor, fontFamily: "var(--font-mono)" }}
            >
              {(audio.baseFreq + audio.diffFreq).toFixed(1)}Hz
            </p>
          </div>
          <div className="beat-box text-center px-8 py-2.5 rounded-2xl">
            <p className="text-[10px] text-purple-400 font-black uppercase mb-0.5 tracking-widest">
              Binaural Beat
            </p>
            <p
              className="text-4xl font-black text-purple-400 tracking-tighter"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {audio.diffFreq.toFixed(1)}Hz
            </p>
          </div>
        </div>
      </div>
      )}

      {/* ===== CONTROL PANEL (Bottom) ===== */}
      {!isRecordingMode && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[96%] max-w-[1400px] z-20 glass rounded-2xl p-5 px-8 shadow-2xl flex items-start gap-6">
        {/* Col 1: Binaural Controls */}
        <div className="flex-[1.5] flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <label className="text-[10px] text-purple-400 uppercase font-black tracking-widest italic">
              Binaural Dinâmico
            </label>
            <span
              className="text-xs text-purple-300"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {audio.diffFreq.toFixed(1)}Hz
            </span>
          </div>
          <input
            type="range"
            min="0.5"
            max="60"
            step="0.1"
            value={audio.diffFreq}
            onChange={(e) => audio.setDiffFreq(parseFloat(e.target.value))}
            className="w-full accent-purple-500"
          />

          <div className="flex justify-between items-center mt-1">
            <label className="text-[9px] text-slate-400 uppercase font-bold tracking-widest">
              Base Carrier
            </label>
            <span
              className="text-[10px] text-blue-400"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {audio.baseFreq}Hz
            </span>
          </div>
          <input
            type="range"
            min="60"
            max="600"
            step="1"
            value={audio.baseFreq}
            onChange={(e) => audio.setBaseFreq(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>

        {/* Col 2: Volume Controls */}
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <label className="text-[9px] text-slate-400 uppercase font-black tracking-widest">
              Binaural Gain
            </label>
            <span
              className="text-[10px] text-emerald-400"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {audio.binauralDb} dB
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="70"
            step="1"
            value={audio.binauralDb}
            onChange={(e) => audio.setBinauralDb(parseInt(e.target.value))}
            className="w-full"
          />

          {/* Canal de Som 1 */}
          <div className="mt-2 bg-white/5 p-3 rounded-xl border border-white/10">
            <div className="flex justify-between items-center mb-2">
              <label className="text-[9px] text-slate-400 uppercase font-black tracking-widest">
                🎵 Canal 1
              </label>
              <span
                className="text-[10px] text-emerald-400"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {audio.sound1Db} dB
              </span>
            </div>
            <select
              value={audio.sound1Src}
              onChange={(e) => audio.setSound1Src(e.target.value)}
              className="w-full bg-black/40 text-xs text-white p-1.5 rounded mb-2 border border-white/10 focus:outline-none"
            >
              {AVAILABLE_SOUNDS.map((s) => (
                <option key={s.id} value={s.file}>
                  {s.label}
                </option>
              ))}
            </select>
            <input
              type="range"
              min="0"
              max="70"
              step="1"
              value={audio.sound1Db}
              onChange={(e) => audio.setSound1Db(parseInt(e.target.value))}
              className="w-full"
            />
          </div>

          {/* Canal de Som 2 */}
          <div className="bg-white/5 p-3 rounded-xl border border-white/10">
            <div className="flex justify-between items-center mb-2">
              <label className="text-[9px] text-slate-400 uppercase font-black tracking-widest">
                🎵 Canal 2
              </label>
              <span
                className="text-[10px] text-emerald-400"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {audio.sound2Db} dB
              </span>
            </div>
            <select
              value={audio.sound2Src}
              onChange={(e) => audio.setSound2Src(e.target.value)}
              className="w-full bg-black/40 text-xs text-white p-1.5 rounded mb-2 border border-white/10 focus:outline-none"
            >
              {AVAILABLE_SOUNDS.map((s) => (
                <option key={s.id} value={s.file}>
                  {s.label}
                </option>
              ))}
            </select>
            <input
              type="range"
              min="0"
              max="70"
              step="1"
              value={audio.sound2Db}
              onChange={(e) => audio.setSound2Db(parseInt(e.target.value))}
              className="w-full"
            />
          </div>

        </div>

        {/* Col 3: Colors + Record Duration + Test */}
        <div className="flex-[0.8] flex flex-col gap-3">
          <div className="flex gap-4">
            <div className="flex-1 text-center">
              <label className="text-[8px] text-slate-400 uppercase font-black mb-1 block">
                Cor A
              </label>
              <input
                type="color"
                value={traceAColor}
                onChange={(e) => setTraceAColor(e.target.value)}
                className="w-full h-8 rounded"
              />
            </div>
            <div className="flex-1 text-center">
              <label className="text-[8px] text-slate-400 uppercase font-black mb-1 block">
                Cor B
              </label>
              <input
                type="color"
                value={traceBColor}
                onChange={(e) => setTraceBColor(e.target.value)}
                className="w-full h-8 rounded"
              />
            </div>
          </div>

          {/* Record Duration */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[8px] text-slate-400 uppercase font-black tracking-widest">
                Duração (Auto-Stop)
              </label>
              <span className="text-[10px] text-emerald-400" style={{ fontFamily: "var(--font-mono)" }}>
                {recorder.maxDuration === 0
                  ? "∞ MANUAL"
                  : recorder.maxDuration < 3600
                  ? `${Math.floor(recorder.maxDuration / 60)} min`
                  : `${Math.floor(recorder.maxDuration / 3600)}h ${Math.floor(
                      (recorder.maxDuration % 3600) / 60
                    )}m`}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="720"
              step="15"
              value={recorder.maxDuration / 60}
              onChange={(e) => recorder.setMaxDuration(parseInt(e.target.value) * 60)}
              className="w-full"
            />
          </div>

          <button
            onClick={audio.testBeep}
            className="w-full text-[9px] font-black bg-white/5 py-2.5 rounded-xl border border-white/10 text-slate-400 uppercase hover:text-white hover:bg-white/10 transition"
          >
            🔔 Audio Check
          </button>

          {/* Canal de Música 3 */}
          <div className="bg-white/5 p-3 rounded-xl border border-purple-500/30 mt-auto">
            <div className="flex justify-between items-center mb-2">
              <label className="text-[9px] text-purple-300 uppercase font-black tracking-widest">
                🎹 Música (Canal 3)
              </label>
              <span
                className="text-[10px] text-emerald-400"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {audio.musicDb} dB
              </span>
            </div>
            <select
              value={audio.musicSrc}
              onChange={(e) => audio.setMusicSrc(e.target.value)}
              className="w-full bg-black/40 text-xs text-white p-1.5 rounded mb-2 border border-white/10 focus:outline-none"
            >
              {AVAILABLE_MUSIC.map((m) => (
                <option key={m.id} value={m.file}>
                  {m.label}
                </option>
              ))}
            </select>
            <input
              type="range"
              min="0"
              max="70"
              step="1"
              value={audio.musicDb}
              onChange={(e) => audio.setMusicDb(parseInt(e.target.value))}
              className="w-full accent-purple-500"
            />
          </div>
        </div>
        </div>
      )}

      {/* ===== RECORDING CONTROLS (visible only in recording mode) ===== */}
      {isRecordingMode && !countdown && (
        <div className="fixed bottom-8 right-8 flex items-center gap-6 z-[100] opacity-30 hover:opacity-100 transition-all duration-300">
          <button
            onClick={restoreUI}
            title="Abortar Gravação (Retornar sem salvar)"
            className="w-12 h-12 flex items-center justify-center rounded-2xl bg-red-600/90 shadow-[0_0_20px_rgba(239,68,68,0.6)] cursor-pointer transition-transform hover:scale-110 hover:bg-red-500"
          >
            <span className="text-2xl leading-none text-white">⏹</span>
          </button>
          <button
            onClick={stopRecordingSequence}
            title="Encerrar Gravação (Salvar arquivo)"
            className="w-12 h-12 flex items-center justify-center rounded-2xl bg-emerald-600/90 shadow-[0_0_20px_rgba(16,185,129,0.6)] cursor-pointer transition-transform hover:scale-110 hover:bg-emerald-500"
          >
            <span className="text-2xl leading-none text-white font-black">⬇</span>
          </button>
        </div>
      )}
    </main>
  );
}
