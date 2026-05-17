/**
 * Timeline Schema — Types and validation for frequency timeline scripts.
 * 
 * Each JSON file in /public/timelines/ follows this schema to define
 * a programmed frequency journey (e.g., sleep cycles, focus sessions).
 */

// ---- TYPES ----

export interface TrackMetadata {
  id: string;
  name: string;
  total_duration_seconds: number;
  description: string;
}

export interface AudioSettings {
  carrier_frequency_hz: number;
  wave_type: "sine" | "square" | "triangle";
  technique: "binaural_beat" | "isochronic" | "monaural";
}

export interface TimelineKeyframe {
  time_second: number;
  target_binaural_hz: number;
  interpolation: "linear" | "smooth" | "step";
  stage_label: string;
}

export interface TimelineScript {
  track_metadata: TrackMetadata;
  audio_settings: AudioSettings;
  timeline: TimelineKeyframe[];
}

// ---- VALIDATION ----

export function validateTimeline(data: unknown): TimelineScript | null {
  try {
    const obj = data as Record<string, unknown>;

    // Validate top-level structure
    if (!obj.track_metadata || !obj.audio_settings || !obj.timeline) {
      console.warn("Timeline validation failed: missing top-level keys");
      return null;
    }

    const meta = obj.track_metadata as Record<string, unknown>;
    if (!meta.id || !meta.name || typeof meta.total_duration_seconds !== "number") {
      console.warn("Timeline validation failed: invalid track_metadata");
      return null;
    }

    const audio = obj.audio_settings as Record<string, unknown>;
    if (typeof audio.carrier_frequency_hz !== "number") {
      console.warn("Timeline validation failed: invalid audio_settings");
      return null;
    }

    const timeline = obj.timeline as unknown[];
    if (!Array.isArray(timeline) || timeline.length < 2) {
      console.warn("Timeline validation failed: timeline must have at least 2 keyframes");
      return null;
    }

    // Validate each keyframe
    for (let i = 0; i < timeline.length; i++) {
      const kf = timeline[i] as Record<string, unknown>;
      if (
        typeof kf.time_second !== "number" ||
        typeof kf.target_binaural_hz !== "number" ||
        !["linear", "smooth", "step"].includes(kf.interpolation as string)
      ) {
        console.warn(`Timeline validation failed: invalid keyframe at index ${i}`);
        return null;
      }
    }

    // Sort by time_second (safety)
    (obj.timeline as TimelineKeyframe[]).sort((a, b) => a.time_second - b.time_second);

    return obj as unknown as TimelineScript;
  } catch (err) {
    console.error("Timeline validation error:", err);
    return null;
  }
}

// ---- INTERPOLATION MATH ----

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Given a timeline and a time in seconds, compute the interpolated
 * binaural frequency at that moment.
 */
export function interpolateFrequency(
  timeline: TimelineKeyframe[],
  timeSeconds: number
): { hz: number; label: string } {
  if (timeline.length === 0) return { hz: 0, label: "" };

  // Before first keyframe
  if (timeSeconds <= timeline[0].time_second) {
    return { hz: timeline[0].target_binaural_hz, label: timeline[0].stage_label };
  }

  // After last keyframe
  const last = timeline[timeline.length - 1];
  if (timeSeconds >= last.time_second) {
    return { hz: last.target_binaural_hz, label: last.stage_label };
  }

  // Find surrounding keyframes
  let prevIdx = 0;
  for (let i = 0; i < timeline.length - 1; i++) {
    if (timeline[i + 1].time_second > timeSeconds) {
      prevIdx = i;
      break;
    }
  }

  const prev = timeline[prevIdx];
  const next = timeline[prevIdx + 1];
  const segmentDuration = next.time_second - prev.time_second;
  const progress = segmentDuration > 0
    ? (timeSeconds - prev.time_second) / segmentDuration
    : 0;

  let hz: number;
  switch (next.interpolation) {
    case "linear":
      hz = lerp(prev.target_binaural_hz, next.target_binaural_hz, progress);
      break;
    case "smooth":
      hz = lerp(prev.target_binaural_hz, next.target_binaural_hz, easeInOutCubic(progress));
      break;
    case "step":
      hz = prev.target_binaural_hz;
      break;
    default:
      hz = lerp(prev.target_binaural_hz, next.target_binaural_hz, progress);
  }

  // Label: use the label of whichever keyframe we're closer to
  const label = progress < 0.5 ? prev.stage_label : next.stage_label;

  return { hz: Math.max(0.1, hz), label };
}
