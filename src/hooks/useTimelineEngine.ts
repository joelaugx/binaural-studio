"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TimelineScript, interpolateFrequency } from "@/lib/timelineSchema";

/**
 * Timeline engine hook.
 * Manages playback of a frequency timeline script, computing
 * interpolated binaural Hz values frame-by-frame.
 *
 * Uses performance.now() as the master clock to avoid
 * requestAnimationFrame/setInterval drift.
 */

interface TimelineEngineState {
  isRunning: boolean;
  currentTime: number;        // seconds into the timeline
  currentHz: number;           // interpolated binaural frequency
  currentLabel: string;        // active stage label
  progress: number;            // 0..1 progress through total duration
  totalDuration: number;       // total seconds
}

interface TimelineEngineActions {
  loadTimeline: (script: TimelineScript) => void;
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  reset: () => void;
  unload: () => void;
}

export type TimelineEngine = TimelineEngineState & TimelineEngineActions;

export function useTimelineEngine(
  onFrequencyChange?: (hz: number) => void,
  onCarrierChange?: (hz: number) => void
): TimelineEngine {
  const [isRunning, setIsRunning] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentHz, setCurrentHz] = useState(0);
  const [currentLabel, setCurrentLabel] = useState("");
  const [totalDuration, setTotalDuration] = useState(0);

  const scriptRef = useRef<TimelineScript | null>(null);
  const isRunningRef = useRef(false);
  const startWallTimeRef = useRef(0);
  const pausedAtRef = useRef(0);      // seconds into timeline when paused
  const animFrameRef = useRef(0);

  // Stable refs for callbacks
  const onFreqChangeRef = useRef(onFrequencyChange);
  onFreqChangeRef.current = onFrequencyChange;
  const onCarrierChangeRef = useRef(onCarrierChange);
  onCarrierChangeRef.current = onCarrierChange;

  // ---- LOAD ----
  const loadTimeline = useCallback((script: TimelineScript) => {
    // Stop any running playback
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    isRunningRef.current = false;
    setIsRunning(false);

    scriptRef.current = script;
    pausedAtRef.current = 0;
    setTotalDuration(script.track_metadata.total_duration_seconds);
    setCurrentTime(0);

    // Set initial frequency
    const initial = interpolateFrequency(script.timeline, 0);
    setCurrentHz(initial.hz);
    setCurrentLabel(initial.label);

    // Apply carrier frequency
    if (onCarrierChangeRef.current) {
      onCarrierChangeRef.current(script.audio_settings.carrier_frequency_hz);
    }
    if (onFreqChangeRef.current) {
      onFreqChangeRef.current(initial.hz);
    }
  }, []);

  // ---- ANIMATION LOOP ----
  const tick = useCallback(() => {
    if (!isRunningRef.current || !scriptRef.current) return;

    const elapsed = (performance.now() - startWallTimeRef.current) / 1000;
    const timeInTimeline = pausedAtRef.current + elapsed;
    const duration = scriptRef.current.track_metadata.total_duration_seconds;

    // Clamp to duration
    const clampedTime = Math.min(timeInTimeline, duration);

    const result = interpolateFrequency(scriptRef.current.timeline, clampedTime);

    setCurrentTime(clampedTime);
    setCurrentHz(result.hz);
    setCurrentLabel(result.label);

    // Push frequency to audio engine
    if (onFreqChangeRef.current) {
      onFreqChangeRef.current(result.hz);
    }

    // Auto-stop at end
    if (clampedTime >= duration) {
      isRunningRef.current = false;
      setIsRunning(false);
      pausedAtRef.current = duration;
      return;
    }

    animFrameRef.current = requestAnimationFrame(tick);
  }, []);

  // ---- PLAY ----
  const play = useCallback(() => {
    if (!scriptRef.current || isRunningRef.current) return;

    startWallTimeRef.current = performance.now();
    isRunningRef.current = true;
    setIsRunning(true);
    animFrameRef.current = requestAnimationFrame(tick);
  }, [tick]);

  // ---- PAUSE ----
  const pause = useCallback(() => {
    if (!isRunningRef.current) return;

    const elapsed = (performance.now() - startWallTimeRef.current) / 1000;
    pausedAtRef.current = pausedAtRef.current + elapsed;
    isRunningRef.current = false;
    setIsRunning(false);

    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
  }, []);

  // ---- SEEK ----
  const seek = useCallback((seconds: number) => {
    if (!scriptRef.current) return;

    const duration = scriptRef.current.track_metadata.total_duration_seconds;
    const clamped = Math.max(0, Math.min(seconds, duration));
    pausedAtRef.current = clamped;

    if (isRunningRef.current) {
      startWallTimeRef.current = performance.now();
    }

    const result = interpolateFrequency(scriptRef.current.timeline, clamped);
    setCurrentTime(clamped);
    setCurrentHz(result.hz);
    setCurrentLabel(result.label);

    if (onFreqChangeRef.current) {
      onFreqChangeRef.current(result.hz);
    }
  }, []);

  // ---- RESET ----
  const reset = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    isRunningRef.current = false;
    setIsRunning(false);
    pausedAtRef.current = 0;
    setCurrentTime(0);

    if (scriptRef.current) {
      const initial = interpolateFrequency(scriptRef.current.timeline, 0);
      setCurrentHz(initial.hz);
      setCurrentLabel(initial.label);
      if (onFreqChangeRef.current) {
        onFreqChangeRef.current(initial.hz);
      }
    }
  }, []);

  // ---- UNLOAD ----
  const unload = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    isRunningRef.current = false;
    setIsRunning(false);
    scriptRef.current = null;
    pausedAtRef.current = 0;
    setCurrentTime(0);
    setCurrentHz(0);
    setCurrentLabel("");
    setTotalDuration(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  const progress = totalDuration > 0 ? currentTime / totalDuration : 0;

  return {
    isRunning,
    currentTime,
    currentHz,
    currentLabel,
    progress,
    totalDuration,
    loadTimeline,
    play,
    pause,
    seek,
    reset,
    unload,
  };
}
