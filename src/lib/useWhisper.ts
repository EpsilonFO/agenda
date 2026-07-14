"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Reconnaissance vocale 100 % locale via Whisper (transformers.js).
 * Le modèle tourne dans le navigateur (WASM/WebGPU) : aucune donnée n'est
 * envoyée à un serveur, aucune clé API. Les poids sont téléchargés une seule
 * fois puis mis en cache par le navigateur.
 */

export type WhisperStatus =
  | "idle"
  | "recording"
  | "loading" // téléchargement / initialisation du modèle
  | "transcribing";

const MODEL =
  process.env.NEXT_PUBLIC_WHISPER_MODEL || "Xenova/whisper-base";
const LANGUAGE = process.env.NEXT_PUBLIC_WHISPER_LANG || "french";

// Pipeline mis en cache au niveau module (chargé une seule fois).
let transcriberPromise: Promise<unknown> | null = null;

function getTranscriber(onProgress?: (pct: number) => void) {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      const { pipeline, env } = await import("@xenova/transformers");
      // Toujours récupérer les modèles depuis le hub distant.
      env.allowLocalModels = false;
      return pipeline("automatic-speech-recognition", MODEL, {
        progress_callback: (p: { status: string; progress?: number }) => {
          if (p.status === "progress" && typeof p.progress === "number") {
            onProgress?.(Math.round(p.progress));
          }
        },
      });
    })();
  }
  return transcriberPromise;
}

/** Décode un blob audio en Float32Array mono ré-échantillonné à 16 kHz. */
async function decodeToPcm16k(blob: Blob): Promise<Float32Array> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate: 16000 });
  try {
    const buf = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(buf);
    return decoded.getChannelData(0);
  } finally {
    ctx.close();
  }
}

export function useWhisper(onResult: (text: string) => void) {
  const [status, setStatus] = useState<WhisperStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof window.MediaRecorder !== "undefined"
    );
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const transcribe = useCallback(async () => {
    const blob = new Blob(chunksRef.current, {
      type: chunksRef.current[0]?.type || "audio/webm",
    });
    chunksRef.current = [];
    if (blob.size === 0) {
      setStatus("idle");
      return;
    }
    try {
      setError(null);
      setProgress(0);
      setStatus("loading");
      const transcriber = (await getTranscriber(setProgress)) as (
        audio: Float32Array,
        opts: Record<string, unknown>
      ) => Promise<{ text: string }>;
      setStatus("transcribing");
      const pcm = await decodeToPcm16k(blob);
      const out = await transcriber(pcm, {
        language: LANGUAGE,
        task: "transcribe",
        chunk_length_s: 30,
      });
      const text = (out.text || "").trim();
      if (text) onResult(text);
    } catch (e) {
      console.error(e);
      setError("Transcription impossible. Réessaie.");
    } finally {
      setStatus("idle");
    }
  }, [onResult]);

  const start = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stopStream();
        transcribe();
      };
      recorder.start();
      recorderRef.current = recorder;
      setStatus("recording");
    } catch {
      setError("Micro inaccessible. Autorise l'accès au microphone.");
      setStatus("idle");
    }
  }, [stopStream, transcribe]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
      recorderRef.current = null;
    }
  }, []);

  const toggle = useCallback(() => {
    if (status === "recording") stop();
    else if (status === "idle") start();
  }, [status, start, stop]);

  // Nettoyage si le composant est démonté en cours d'enregistrement.
  useEffect(() => stopStream, [stopStream]);

  return { status, progress, error, supported, toggle };
}
