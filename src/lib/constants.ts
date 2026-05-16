/**
 * Brain state definitions and utility types for the Binaural Studio.
 */

export interface BrainState {
  name: string;
  color: string;
  range: [number, number];
  description: string;
}

export const BRAIN_STATES: Record<string, BrainState> = {
  Delta: {
    name: "Delta",
    color: "#10b981",
    range: [0.1, 4],
    description: "Deep Sleep",
  },
  Theta: {
    name: "Theta",
    color: "#a855f7",
    range: [4, 8],
    description: "Meditation",
  },
  Alpha: {
    name: "Alpha",
    color: "#3b82f6",
    range: [8, 14],
    description: "Relaxation",
  },
  Beta: {
    name: "Beta",
    color: "#f59e0b",
    range: [14, 30],
    description: "Focus",
  },
  Gamma: {
    name: "Gamma",
    color: "#ef4444",
    range: [30, 100],
    description: "Peak Performance",
  },
};

export function getBrainStateFromFreq(freq: number): BrainState {
  for (const key of Object.keys(BRAIN_STATES)) {
    const state = BRAIN_STATES[key];
    if (freq >= state.range[0] && freq < state.range[1]) {
      return state;
    }
  }
  return BRAIN_STATES.Gamma;
}

export const AVAILABLE_SOUNDS = [
  { id: "none", label: "Nenhum", file: "" },
  { id: "distant_sea_humming_ambiance", label: "Distant Sea Humming Ambiance", file: "/audio/mixkit-distant-sea-humming-ambiance-1191.mp3" },
  { id: "heavy_rain_drops", label: "Heavy Rain Drops", file: "/audio/mixkit-heavy-rain-drops-2399.mp3" },
  { id: "rain_and_rainforest", label: "Rain and Rainforest", file: "/audio/457447__innorecords__rain-sound-and-rainforest.mp3" },
  { id: "rain_long_loop", label: "Rain Long Loop", file: "/audio/mixkit-rain-long-loop-2394.mp3" },
  { id: "rain_moderate_a", label: "Rain Moderate A", file: "/audio/401277__inspectorj__rain-moderate-a.mp3" },
  { id: "rain_near_smooth", label: "Rain Near Smooth", file: "/audio/157487__loopbasedmusic__rain_near_smooth.mp3" },
  { id: "rainfall", label: "Rainfall", file: "/audio/7521__abinadimeza__rainfall.mp3" },
  { id: "river_water_flowing", label: "River Water Flowing", file: "/audio/mixkit-river-water-flowing-2454.mp3" },
  { id: "rough_sea_waves_loop", label: "Rough Sea Waves Loop", file: "/audio/mixkit-rough-sea-waves-loop-1194.mp3" },
  { id: "sea_coast_breaking_waves", label: "Sea Coast Breaking Waves", file: "/audio/mixkit-sea-coast-breaking-waves-1206.mp3" },
  { id: "sea_waves_ambience", label: "Sea Waves Ambience", file: "/audio/mixkit-sea-waves-ambience-1189.mp3" },
  { id: "sea_waves_on_a_rocky_shore", label: "Sea Waves On A Rocky Shore", file: "/audio/mixkit-sea-waves-on-a-rocky-shore-1190.mp3" },
  { id: "small_waves_harbor_rocks", label: "Small Waves Harbor Rocks", file: "/audio/mixkit-small-waves-harbor-rocks-1208.mp3" },
  { id: "stormy_sea_ambience", label: "Stormy Sea Ambience", file: "/audio/mixkit-stormy-sea-ambience-1197.mp3" },
  { id: "strong_flowing_waters", label: "Strong Flowing Waters Noise", file: "/audio/mixkit-strong-flowing-waters-noise-2461.mp3" },
  { id: "water_flowing_in_the_river", label: "Water Flowing In The River", file: "/audio/mixkit-water-flowing-in-the-river-2455.mp3" },
  { id: "waterfall_in_the_woods", label: "Waterfall In The Woods", file: "/audio/mixkit-waterfall-in-the-woods-2517.mp3" },
  { id: "windy_sea_loop", label: "Windy Sea Loop", file: "/audio/mixkit-windy-sea-loop-1200.mp3" },
];

export const AVAILABLE_MUSIC = [
  { id: "none", label: "Nenhuma", file: "" },
  { id: "01_bilateral_tranquility", label: "Bilateral Tranquility", file: "/musica/01-Bilateral-Tranquility-Variation-1.mp3" },
  { id: "03_bilateral_harp", label: "Bilateral Harp", file: "/musica/03-Bilateral-Harp.mp3" },
  { id: "04_bilateral_stillness", label: "Bilateral Stillness", file: "/musica/04-Bilateral-Stillness.mp3" },
  { id: "06_transient", label: "Transient", file: "/musica/06-Transient.mp3" },
  { id: "07_bright_ambient", label: "Bright Ambient", file: "/musica/07-Bright-Ambient.mp3" },
  { id: "08_spring_sunrise", label: "Spring Sunrise", file: "/musica/08-Spring-Sunrise.mp3" },
  { id: "39_replenish", label: "Replenish", file: "/musica/39-REPLENISH.mp3" },
  { id: "evening_lights", label: "Evening Lights", file: "/musica/653_full_evening-lights_0152_preview.mp3" },
  { id: "timeless_space", label: "Timeless Space", file: "/musica/Ambient-Meets-Classical-Music-Free-No-Copyright-Music-by-Liborio-Conti-01-Timeless-Space.wav" },
  { id: "soft_breeze", label: "A Soft Breeze", file: "/musica/Ambient-Meets-Classical-Music-Free-No-Copyright-Music-by-Liborio-Conti-02-A-Soft-Breeze.mp3" },
  { id: "bed_of_flowers", label: "Bed Of Flowers", file: "/musica/Ambient-Meets-Classical-Music-Free-No-Copyright-Music-by-Liborio-Conti-04-Bed-Of-Flowers.mp3" },
  { id: "the_distance", label: "The Distance", file: "/musica/Ambient-Meets-Classical-Music-Free-No-Copyright-Music-by-Liborio-Conti-06-The-Distance.mp3" },
  { id: "kiss_of_spring", label: "The Kiss Of Spring", file: "/musica/Ambient-Meets-Classical-Music-Free-No-Copyright-Music-by-Liborio-Conti-07-The-Kiss-Of-Spring.mp3" },
  { id: "beach_serenity", label: "Beach Serenity", file: "/musica/BeachSerenity.mp3" },
  { id: "by_the_fire", label: "By The Fire", file: "/musica/ByTheFire.mp3" },
  { id: "cinelax", label: "Cinelax", file: "/musica/Cinelax.mp3" },
  { id: "deeper_meaning", label: "Deeper Meaning", file: "/musica/DeeperMeaning.mp3" },
  { id: "forestal", label: "Forestal", file: "/musica/Forestal.mp3" },
  { id: "forever", label: "Forever", file: "/musica/Forever.mp3" },
  { id: "frozen_in_time", label: "Frozen in Time", file: "/musica/Frozen-in-Time.mp3" },
];

export const PRESET_DURATIONS = [
  { label: "30min", seconds: 30 * 60 },
  { label: "1h", seconds: 60 * 60 },
  { label: "2h", seconds: 2 * 60 * 60 },
  { label: "3h", seconds: 3 * 60 * 60 },
  { label: "∞", seconds: 0 },
];

export function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const d = Math.floor((totalSeconds * 10) % 10);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${d}`;
}
