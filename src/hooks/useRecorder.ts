"use client";

import { useCallback, useRef, useState } from "react";
import { injectDurationPlaceholder, patchDurationValue } from "@/lib/fixWebmDuration";

/**
 * A/V recorder hook.
 * Captures a canvas stream + audio stream and muxes them into a single
 * downloadable .webm file (VP9 + Opus — YouTube-ready, stereo).
 */

interface RecorderState {
  isRecording: boolean;
  elapsed: number; // seconds
  maxDuration: number; // seconds (0 = infinite)
}

interface RecorderActions {
  prepareRecording: () => Promise<boolean>;
  startRecording: (
    canvas: HTMLCanvasElement,
    audioStream: MediaStream | null,
    fps?: number
  ) => void;
  stopRecording: () => void;
  setMaxDuration: (seconds: number) => void;
}

export type Recorder = RecorderState & RecorderActions;

export function useRecorder(): Recorder {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [maxDuration, setMaxDuration] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const lastBlobUrlRef = useRef<string | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const maxDurationRef = useRef(0);
  const fileStreamRef = useRef<any>(null);
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const wakeLockRef = useRef<any>(null);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const fileWriteFailedRef = useRef(false); // flag de fallback
  const isFirstChunkRef = useRef(true); // flag para injetar Duration placeholder

  const cleanupTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const stopRecording = useCallback(() => {
    cleanupTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(console.warn);
      wakeLockRef.current = null;
    }
    
    setIsRecording(false);
  }, [cleanupTimer]);

  const prepareRecording = useCallback(async (): Promise<boolean> => {
    try {
      if ("showSaveFilePicker" in window) {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: `binaural-studio-${Date.now()}.webm`,
          types: [
            {
              description: "WebM Video",
              accept: { "video/webm": [".webm"] },
            },
          ],
        });
        fileHandleRef.current = handle;
        fileStreamRef.current = await handle.createWritable();
        fileWriteFailedRef.current = false;
      }
      return true;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log("Gravação abortada: usuário fechou a janela de salvar.");
      } else {
        console.warn("Falha ao criar arquivo de gravação:", err);
      }
      return false;
    }
  }, []);

  const startRecording = useCallback(
    (
      canvas: HTMLCanvasElement,
      audioStream: MediaStream | null,
      fps: number = 30
    ) => {

      chunksRef.current = [];
      startTimeRef.current = Date.now();
      setElapsed(0);
      writeQueueRef.current = Promise.resolve();
      fileWriteFailedRef.current = false;
      isFirstChunkRef.current = true;

      // Limpar memória do vídeo anterior
      if (lastBlobUrlRef.current) {
        URL.revokeObjectURL(lastBlobUrlRef.current);
        lastBlobUrlRef.current = null;
      }

      // Prevenir descanso de tela (fire-and-forget)
      if ("wakeLock" in navigator) {
        (navigator as any).wakeLock.request("screen").then((lock: any) => {
          wakeLockRef.current = lock;
        }).catch((err: any) => {
          console.warn("Falha ao bloquear descanso de tela:", err);
        });
      }

      // Capture canvas video stream
      const videoStream = canvas.captureStream(fps);

      // Merge audio tracks if available
      const combined = new MediaStream();
      videoStream.getVideoTracks().forEach((t) => combined.addTrack(t));
      if (audioStream) {
        audioStream.getAudioTracks().forEach((t) => combined.addTrack(t));
      }

      // Choose best available codec
      const mimeType = MediaRecorder.isTypeSupported(
        "video/webm; codecs=vp9,opus"
      )
        ? "video/webm; codecs=vp9,opus"
        : MediaRecorder.isTypeSupported("video/webm; codecs=vp8,opus")
          ? "video/webm; codecs=vp8,opus"
          : "video/webm";

      const recorder = new MediaRecorder(combined, {
        mimeType,
        videoBitsPerSecond: 8_000_000, // 8 Mbps for crisp 1080p source
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          // Se a escrita em arquivo já falhou antes, vai direto pro blob em memória
          if (fileWriteFailedRef.current || !fileStreamRef.current) {
            chunksRef.current.push(e.data);
            return;
          }

          // Tenta escrever no arquivo do HD
          writeQueueRef.current = writeQueueRef.current
            .then(async () => {
              if (!fileStreamRef.current || fileWriteFailedRef.current) return;

              // Primeiro chunk: injetar Duration placeholder no header EBML
              // (CapCut 8.6+ exige Duration para reconhecer o áudio)
              let dataToWrite: Blob = e.data;
              if (isFirstChunkRef.current) {
                isFirstChunkRef.current = false;
                try {
                  dataToWrite = await injectDurationPlaceholder(e.data);
                } catch (err) {
                  console.warn("Falha ao injetar Duration placeholder:", err);
                }
              }

              return fileStreamRef.current.write(dataToWrite);
            })
            .catch((writeErr) => {
              console.error("Erro escrevendo chunk no disco — mudando para modo memória:", writeErr);
              // FALLBACK: marca como falho e coleta este chunk em memória
              fileWriteFailedRef.current = true;
              chunksRef.current.push(e.data);
            });
        }
      };

      recorder.onstop = async () => {
        // Caso 1: Arquivo no HD funcionou normalmente
        if (fileStreamRef.current && !fileWriteFailedRef.current) {
          try {
            await writeQueueRef.current;
            await fileStreamRef.current.close();
          } catch (closeErr) {
            console.error("Erro fechando arquivo:", closeErr);
          }
          fileStreamRef.current = null;

          // Corrigir Duration no header EBML (CapCut 8.6+ exige este campo)
          // Fase 2: sobrescrever o placeholder Duration=0 com o valor real
          if (fileHandleRef.current) {
            const durationMs = Date.now() - startTimeRef.current;
            await patchDurationValue(fileHandleRef.current, durationMs);
            fileHandleRef.current = null;
          }
          return;
        }

        // Caso 2: Falhou no HD ou nunca teve HD — usa Blob em memória
        // Fechar o stream do HD se existir (mesmo que com erro)
        if (fileStreamRef.current) {
          try {
            await fileStreamRef.current.abort();
          } catch (_) { /* ignore */ }
          fileStreamRef.current = null;
        }

        if (chunksRef.current.length === 0) {
          console.warn("Nenhum chunk gravado — arquivo vazio.");
          return;
        }

        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        lastBlobUrlRef.current = url;
        
        const a = document.createElement("a");
        const now = new Date();
        const timestamp = `${now.getFullYear()}-${String(
          now.getMonth() + 1
        ).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(
          now.getHours()
        ).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
        const filename = `binaural-studio-${timestamp}.webm`;

        a.style.display = "none";
        a.href = url;
        a.download = filename;
        
        document.body.appendChild(a);
        
        setTimeout(() => {
          a.click();
          setTimeout(() => {
            if (document.body.contains(a)) {
              document.body.removeChild(a);
            }
          }, 2000);
        }, 100);

        chunksRef.current = [];
      };

      recorder.start(1000); // collect chunks every 1s
      recorderRef.current = recorder;
      setIsRecording(true);

      // Elapsed timer — wall clock (immune to setInterval throttling)
      elapsedTimerRef.current = setInterval(() => {
        const realElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setElapsed(realElapsed);

        // Auto-stop at max duration
        if (
          maxDurationRef.current > 0 &&
          realElapsed >= maxDurationRef.current
        ) {
          stopRecording();
        }
      }, 1000);
    },
    [stopRecording]
  );

  const handleSetMaxDuration = useCallback((seconds: number) => {
    maxDurationRef.current = seconds;
    setMaxDuration(seconds);
  }, []);

  return {
    isRecording,
    elapsed,
    maxDuration,
    prepareRecording,
    startRecording,
    stopRecording,
    setMaxDuration: handleSetMaxDuration,
  };
}
