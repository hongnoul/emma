"use client";
// ElevenLabs Conversational AI voice layer for the Rarepath patient app.
//
// Flow: mic button → GET {API_BASE}/v1/voice/signed-url (key stays on the
// backend) → WebSocket session via @elevenlabs/react. Transcripts stream
// into the existing chat bubbles through onMessage; client tools let the
// agent drive the UI (switch tabs). Emmatics answers come from the server
// tool /v1/voice/tools/emmatics-brief, which only speaks evidence that
// passed the patient-audience trust gate.
import { useCallback, useState } from "react";
import {
  ConversationProvider,
  useConversation,
} from "@elevenlabs/react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export interface VoiceMsg {
  from: "ai" | "me";
  text: string;
  src?: string;
}

export interface CheckinDraft {
  symptoms?: string[];
  effects?: string[];
  severity?: number;
  doses?: number;
}

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  return <ConversationProvider>{children}</ConversationProvider>;
}

export function useVoiceSession({
  onTranscript,
  onSwitchTab,
  onFillCheckin,
}: {
  onTranscript: (m: VoiceMsg) => void;
  onSwitchTab?: (tab: string) => void;
  onFillCheckin?: (draft: CheckinDraft) => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conversation = useConversation({
    onMessage: ({ message, role }) => {
      onTranscript({
        from: role === "user" ? "me" : "ai",
        text: message,
        src: role === "user" ? undefined : "Rarepath Voice · ElevenLabs",
      });
    },
    onError: (e: unknown) => {
      setError(typeof e === "string" ? e : "Voice connection error");
    },
    clientTools: {
      switch_tab: ({ tab }: { tab?: unknown }) => {
        if (typeof tab === "string" && onSwitchTab) onSwitchTab(tab);
        return "ok";
      },
      // Pre-fill the weekly check-in form from conversation. The agent is
      // prompt-bound to only call this after the patient described symptoms
      // and to tell them to review before submitting. Consent gating stays
      // in the UI: the form is only reachable when consent === "given",
      // and nothing is submitted by voice.
      fill_checkin: (params: Record<string, unknown>) => {
        if (!onFillCheckin) return "check-in not available on this screen";
        const strArr = (v: unknown) =>
          Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;
        const num = (v: unknown, lo: number, hi: number) =>
          typeof v === "number" && Number.isFinite(v)
            ? Math.min(hi, Math.max(lo, Math.round(v)))
            : undefined;
        onFillCheckin({
          symptoms: strArr(params.symptoms),
          effects: strArr(params.side_effects),
          severity: num(params.severity, 0, 10),
          doses: num(params.doses_taken, 0, 7),
        });
        if (onSwitchTab) onSwitchTab("research");
        return "check-in form pre-filled; patient must review and submit";
      },
    },
  });

  const { status, isSpeaking, startSession, endSession, getOutputByteFrequencyData } = conversation;
  const active = status === "connected";

  const start = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      // Mic permission first so the session doesn't fail mid-handshake.
      await navigator.mediaDevices.getUserMedia({ audio: true });
      // WebRTC transport: native mic capture + playback, most reliable
      // across browsers. Falls back to websocket if the token route 404s
      // (older deployed backend).
      const tok = await fetch(`${API_BASE}/v1/voice/token`, {
        signal: AbortSignal.timeout(10000),
      });
      if (tok.ok) {
        const { token } = await tok.json();
        startSession({ conversationToken: token, connectionType: "webrtc" });
        return;
      }
      const res = await fetch(`${API_BASE}/v1/voice/signed-url`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `voice auth failed (${res.status})`);
      }
      const { signed_url } = await res.json();
      startSession({ signedUrl: signed_url, connectionType: "websocket" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }, [startSession]);

  const stop = useCallback(() => {
    endSession();
  }, [endSession]);

  return {
    active,
    connecting,
    isSpeaking,
    error,
    start,
    stop,
    status,
    // Live output-audio spectrum (AnalyserNode byte frequency data) for
    // driving the lip-synced avatar. Safe to call every animation frame.
    getOutputByteFrequencyData,
  };
}

// Mic toggle used in the ChatTab composer row.
export function VoiceButton({
  active,
  connecting,
  isSpeaking,
  onStart,
  onStop,
}: {
  active: boolean;
  connecting: boolean;
  isSpeaking: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  return (
    <button
      type="button"
      onClick={active ? onStop : onStart}
      disabled={connecting}
      title={active ? "End voice session" : "Talk to Rarepath"}
      className={`grid size-8 shrink-0 place-items-center rounded-full text-[13px] transition ${
        active
          ? isSpeaking
            ? "animate-pulse bg-primary text-primary-foreground"
            : "bg-foreground text-background"
          : connecting
            ? "bg-foreground/20 text-foreground/40"
            : "glass-soft text-foreground/65"
      }`}
    >
      {active ? "■" : connecting ? "…" : "🎙"}
    </button>
  );
}
