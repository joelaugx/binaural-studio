"use client";

import { useCallback, useRef, useState } from "react";


/**
 * Core audio engine hook using the Web Audio API.
 * Handles binaural oscillators (stereo-panned L/R), synthetic masks
 * (ocean, rain), and file-based masks (bonfire, music).
 *
 * Also exposes a MediaStream output for recording.
 */

interface AudioEngineState {
  isPlaying: boolean;
  baseFreq: number;
  diffFreq: number;
  binauralDb: number;
  sound1Db: number;
  sound2Db: number;
  musicDb: number;
  sound1Src: string;
  sound2Src: string;
  musicSrc: string;
}

interface AudioEngineActions {
  init: () => Promise<void>;
  toggle: () => Promise<void>;
  setBaseFreq: (freq: number) => void;
  setDiffFreq: (diff: number) => void;
  setBinauralDb: (db: number) => void;
  setSound1Db: (db: number) => void;
  setSound2Db: (db: number) => void;
  setMusicDb: (db: number) => void;
  setSound1Src: (src: string) => Promise<void>;
  setSound2Src: (src: string) => Promise<void>;
  setMusicSrc: (src: string) => Promise<void>;
  getAudioStream: () => MediaStream | null;
  testBeep: () => void;
  cleanup: () => void;
}

export type AudioEngine = AudioEngineState & AudioEngineActions;

export function useAudioEngine(): AudioEngine {
  const [isPlaying, setIsPlaying] = useState(false);
  const [baseFreq, setBaseFreqState] = useState(200);
  const [diffFreq, setDiffFreqState] = useState(10);
  
  // Controle clínico: 60 dB SPL é calibrado como o nível máximo natural (Ganho Linear 1.0)
  // Fórmula: Linear = 10 ^ ((dB - 60) / 20)
  const [binauralDb, setBinauralDbState] = useState(30);
  const [sound1Db, setSound1DbState] = useState(60);
  const [sound2Db, setSound2DbState] = useState(0);
  const [musicDb, setMusicDbState] = useState(0);
  
  const [sound1Src, setSound1SrcState] = useState("");
  const [sound2Src, setSound2SrcState] = useState("");
  const [musicSrc, setMusicSrcState] = useState("");

  const ctxRef = useRef<AudioContext | null>(null);
  const oscLRef = useRef<OscillatorNode | null>(null);
  const oscRRef = useRef<OscillatorNode | null>(null);
  const binGainRef = useRef<GainNode | null>(null);
  const destNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const isPlayingRef = useRef(false);

  // Helper matemático para converter dB Clínico para Ganho Linear do Web Audio API
  const dbToLinear = useCallback((db: number) => {
    return db <= 0 ? 0 : Math.pow(10, (db - 60) / 20);
  }, []);

  // Keep refs in sync with state for use in stable callbacks
  const binauralDbRef = useRef(binauralDb);
  binauralDbRef.current = binauralDb;
  const sound1DbRef = useRef(sound1Db);
  sound1DbRef.current = sound1Db;
  const sound2DbRef = useRef(sound2Db);
  sound2DbRef.current = sound2Db;
  const musicDbRef = useRef(musicDb);
  musicDbRef.current = musicDb;

  // Sound channel nodes
  const sound1GainRef = useRef<GainNode | null>(null);
  const sound2GainRef = useRef<GainNode | null>(null);
  const musicGainRef = useRef<GainNode | null>(null);
  
  const sound1BufferRef = useRef<AudioBuffer | null>(null);
  const sound2BufferRef = useRef<AudioBuffer | null>(null);
  const musicBufferRef = useRef<AudioBuffer | null>(null);
  
  const sound1SourceRef = useRef<AudioBufferSourceNode | null>(null);
  const sound2SourceRef = useRef<AudioBufferSourceNode | null>(null);
  const musicSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const baseFreqRef = useRef(200);
  const diffFreqRef = useRef(10);

  // ---- INIT ----

  const init = useCallback(async () => {
    if (ctxRef.current) return;

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    // Recording destination
    const dest = ctx.createMediaStreamDestination();
    destNodeRef.current = dest;

    // ---- BINAURAL OSCILLATORS ----
    const binGain = ctx.createGain();
    binGain.gain.setValueAtTime(dbToLinear(binauralDbRef.current), ctx.currentTime);
    binGainRef.current = binGain;

    const oscL = ctx.createOscillator();
    const oscR = ctx.createOscillator();
    oscLRef.current = oscL;
    oscRRef.current = oscR;

    // Utiliza ChannelMergerNode para garantir 100% de isolamento estéreo (zero crosstalk)
    const merger = ctx.createChannelMerger(2);

    oscL.frequency.setValueAtTime(baseFreqRef.current, ctx.currentTime);
    oscR.frequency.setValueAtTime(
      baseFreqRef.current + diffFreqRef.current,
      ctx.currentTime
    );

    // Conecta L no canal 0 (Esquerdo) e R no canal 1 (Direito)
    oscL.connect(merger, 0, 0);
    oscR.connect(merger, 0, 1);
    merger.connect(binGain);
    binGain.connect(ctx.destination);
    binGain.connect(dest);

    oscL.start();
    oscR.start();

    // ---- DYNAMIC SOUND CHANNELS ----
    
    // Setup Sound 1
    const s1Gain = ctx.createGain();
    s1Gain.gain.setValueAtTime(dbToLinear(sound1DbRef.current), ctx.currentTime);
    sound1GainRef.current = s1Gain;
    s1Gain.connect(ctx.destination);
    s1Gain.connect(dest);
    
    // Setup Sound 2
    const s2Gain = ctx.createGain();
    s2Gain.gain.setValueAtTime(dbToLinear(sound2DbRef.current), ctx.currentTime);
    sound2GainRef.current = s2Gain;
    s2Gain.connect(ctx.destination);
    s2Gain.connect(dest);

    // Setup Music
    const mGain = ctx.createGain();
    mGain.gain.setValueAtTime(dbToLinear(musicDbRef.current), ctx.currentTime);
    musicGainRef.current = mGain;
    mGain.connect(ctx.destination);
    mGain.connect(dest);

    // Reinicia os buffers caso o usuário já tenha carregado algo e dado pause/play
    if (isPlayingRef.current) {
      if (sound1BufferRef.current) startSound1();
      if (sound2BufferRef.current) startSound2();
      if (musicBufferRef.current) startMusic();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbToLinear]);

  // ---- TOGGLE ----

  const toggle = useCallback(async () => {
    if (!ctxRef.current) {
      await init();
    }
    const ctx = ctxRef.current!;

    if (!isPlayingRef.current) {
      if (ctx.state === "suspended") await ctx.resume();
      isPlayingRef.current = true;
      setIsPlaying(true);
      
      // Resume sound channels (AudioBufferSourceNode)
      if (sound1BufferRef.current && !sound1SourceRef.current) {
        startSound1();
      }
      if (sound2BufferRef.current && !sound2SourceRef.current) {
        startSound2();
      }
      if (musicBufferRef.current && !musicSourceRef.current) {
        startMusic();
      }
    } else {
      await ctx.suspend();
      isPlayingRef.current = false;
      setIsPlaying(false);
      
      stopSound1();
      stopSound2();
      stopMusic();
    }
  }, [init]);

  // ---- FREQUENCY CONTROLS ----

  const setBaseFreq = useCallback((freq: number) => {
    baseFreqRef.current = freq;
    setBaseFreqState(freq);
    const ctx = ctxRef.current;
    if (ctx && oscLRef.current && oscRRef.current) {
      oscLRef.current.frequency.setTargetAtTime(freq, ctx.currentTime, 0.2);
      oscRRef.current.frequency.setTargetAtTime(
        freq + diffFreqRef.current,
        ctx.currentTime,
        0.2
      );
    }
  }, []);

  const setDiffFreq = useCallback((diff: number) => {
    diffFreqRef.current = diff;
    setDiffFreqState(diff);
    const ctx = ctxRef.current;
    if (ctx && oscRRef.current) {
      oscRRef.current.frequency.setTargetAtTime(
        baseFreqRef.current + diff,
        ctx.currentTime,
        0.2
      );
    }
  }, []);

  // ---- GAIN CONTROLS ----

  const setBinauralDb = useCallback((db: number) => {
    setBinauralDbState(db);
    const ctx = ctxRef.current;
    if (ctx && binGainRef.current) {
      binGainRef.current.gain.setTargetAtTime(dbToLinear(db), ctx.currentTime, 0.1);
    }
  }, [dbToLinear]);

  const setSound1Db = useCallback((db: number) => {
    setSound1DbState(db);
    const ctx = ctxRef.current;
    if (ctx && sound1GainRef.current) {
      sound1GainRef.current.gain.setTargetAtTime(dbToLinear(db), ctx.currentTime, 0.1);
    }
  }, [dbToLinear]);

  const setSound2Db = useCallback((db: number) => {
    setSound2DbState(db);
    const ctx = ctxRef.current;
    if (ctx && sound2GainRef.current) {
      sound2GainRef.current.gain.setTargetAtTime(dbToLinear(db), ctx.currentTime, 0.1);
    }
  }, [dbToLinear]);

  const setMusicDb = useCallback((db: number) => {
    setMusicDbState(db);
    const ctx = ctxRef.current;
    if (ctx && musicGainRef.current) {
      musicGainRef.current.gain.setTargetAtTime(dbToLinear(db), ctx.currentTime, 0.1);
    }
  }, [dbToLinear]);

  // Helper para iniciar os nós de áudio do buffer
  const startSound1 = useCallback(() => {
    if (!ctxRef.current || !sound1BufferRef.current || !sound1GainRef.current) return;
    stopSound1(); // garante que não sobreponha
    const source = ctxRef.current.createBufferSource();
    source.buffer = sound1BufferRef.current;
    source.loop = true;
    source.connect(sound1GainRef.current);
    source.start();
    sound1SourceRef.current = source;
  }, []);

  const stopSound1 = useCallback(() => {
    if (sound1SourceRef.current) {
      sound1SourceRef.current.stop();
      sound1SourceRef.current.disconnect();
      sound1SourceRef.current = null;
    }
  }, []);

  const startSound2 = useCallback(() => {
    if (!ctxRef.current || !sound2BufferRef.current || !sound2GainRef.current) return;
    stopSound2(); // garante que não sobreponha
    const source = ctxRef.current.createBufferSource();
    source.buffer = sound2BufferRef.current;
    source.loop = true;
    source.connect(sound2GainRef.current);
    source.start();
    sound2SourceRef.current = source;
  }, []);

  const stopSound2 = useCallback(() => {
    if (sound2SourceRef.current) {
      sound2SourceRef.current.stop();
      sound2SourceRef.current.disconnect();
      sound2SourceRef.current = null;
    }
  }, []);

  const setSound1Src = useCallback(async (src: string) => {
    setSound1SrcState(src);
    stopSound1();
    if (!src) {
      sound1BufferRef.current = null;
      return;
    }
    
    if (!ctxRef.current) await init();
    const ctx = ctxRef.current!;

    try {
      const res = await fetch(src);
      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      sound1BufferRef.current = audioBuffer;
      
      if (isPlayingRef.current) {
        startSound1();
      }
    } catch (err) {
      console.error("Erro ao decodificar arquivo de áudio:", err);
    }
  }, [init, startSound1, stopSound1]);

  const setSound2Src = useCallback(async (src: string) => {
    setSound2SrcState(src);
    stopSound2();
    if (!src) {
      sound2BufferRef.current = null;
      return;
    }

    if (!ctxRef.current) await init();
    const ctx = ctxRef.current!;

    try {
      const res = await fetch(src);
      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      sound2BufferRef.current = audioBuffer;
      
      if (isPlayingRef.current) {
        startSound2();
      }
    } catch (err) {
      console.error("Erro ao decodificar arquivo de áudio:", err);
    }
  }, [init, startSound2, stopSound2]);

  const startMusic = useCallback(() => {
    if (!ctxRef.current || !musicBufferRef.current || !musicGainRef.current) return;
    stopMusic(); // garante que não sobreponha
    const source = ctxRef.current.createBufferSource();
    source.buffer = musicBufferRef.current;
    source.loop = true;
    source.connect(musicGainRef.current);
    source.start();
    musicSourceRef.current = source;
  }, []);

  const stopMusic = useCallback(() => {
    if (musicSourceRef.current) {
      musicSourceRef.current.stop();
      musicSourceRef.current.disconnect();
      musicSourceRef.current = null;
    }
  }, []);

  const setMusicSrc = useCallback(async (src: string) => {
    setMusicSrcState(src);
    stopMusic();
    if (!src) {
      musicBufferRef.current = null;
      return;
    }

    if (!ctxRef.current) await init();
    const ctx = ctxRef.current!;

    try {
      const res = await fetch(src);
      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      musicBufferRef.current = audioBuffer;
      
      if (isPlayingRef.current) {
        startMusic();
      }
    } catch (err) {
      console.error("Erro ao decodificar arquivo de música:", err);
    }
  }, [init, startMusic, stopMusic]);

  // ---- AUDIO STREAM FOR RECORDER ----

  const getAudioStream = useCallback((): MediaStream | null => {
    return destNodeRef.current?.stream ?? null;
  }, []);

  // ---- TEST BEEP ----

  const testBeep = useCallback(() => {
    const tCtx = new AudioContext();
    const o = tCtx.createOscillator();
    const g = tCtx.createGain();
    o.connect(g);
    g.connect(tCtx.destination);
    g.gain.setValueAtTime(0, tCtx.currentTime);
    g.gain.linearRampToValueAtTime(0.4, tCtx.currentTime + 0.1);
    g.gain.linearRampToValueAtTime(0, tCtx.currentTime + 0.5);
    o.frequency.value = 880;
    o.start();
    o.stop(tCtx.currentTime + 0.6);
  }, []);

  // ---- CLEANUP ----

  const cleanup = useCallback(() => {
    oscLRef.current?.stop();
    oscRRef.current?.stop();
    ctxRef.current?.close();
    ctxRef.current = null;
    stopSound1();
    stopSound2();
    stopMusic();
    sound1BufferRef.current = null;
    sound2BufferRef.current = null;
    musicBufferRef.current = null;
  }, [stopSound1, stopSound2, stopMusic]);

  return {
    isPlaying,
    baseFreq,
    diffFreq,
    binauralDb,
    sound1Db,
    sound2Db,
    musicDb,
    sound1Src,
    sound2Src,
    musicSrc,
    init,
    toggle,
    setBaseFreq,
    setDiffFreq,
    setBinauralDb,
    setSound1Db,
    setSound2Db,
    setMusicDb,
    setSound1Src,
    setSound2Src,
    setMusicSrc,
    getAudioStream,
    testBeep,
    cleanup,
  };
}
