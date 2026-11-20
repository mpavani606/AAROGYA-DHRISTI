import { useCallback, useEffect, useRef, useState } from "react";
import api from "../auth/api";
import type { AssistantContext } from "./assistantContext";
import type { Language } from "../education/educationApi";

export type ChatMessage = { role: "user" | "assistant"; content: string; sources?: string[] };
export type AssistantStatus = "idle" | "connecting" | "listening" | "speaking" | "error";
type RealtimeEvent = { type: string; [key: string]: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function jsonString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function useRealtimeAssistant(language: Language, context: AssistantContext) {
  const [status, setStatus] = useState<AssistantStatus>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const peer = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const microphone = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const handledCalls = useRef(new Set<string>());
  const reconnectAttempts = useRef(0);
  const stopped = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  const appendMessage = useCallback((message: ChatMessage) => {
    setMessages((current) => [...current, message]);
  }, []);

  const appendAssistantDelta = useCallback((delta: string) => {
    if (!delta) return;
    setMessages((current) => {
      const last = current.at(-1);
      if (last?.role === "assistant" && !last.sources) {
        return [...current.slice(0, -1), { ...last, content: last.content + delta }];
      }
      return [...current, { role: "assistant", content: delta }];
    });
  }, []);

  const endVoice = useCallback(() => {
    stopped.current = true;
    if (channel.current) channel.current.onmessage = null;
    if (peer.current) peer.current.onconnectionstatechange = null;
    channel.current?.close();
    channel.current = null;
    peer.current?.close();
    peer.current = null;
    microphone.current?.getTracks().forEach((track) => track.stop());
    microphone.current = null;
    if (remoteAudio.current) {
      remoteAudio.current.pause();
      remoteAudio.current.srcObject = null;
    }
    void audioContext.current?.close();
    audioContext.current = null;
    analyser.current = null;
    setAudioLevel(0);
    setMuted(false);
    if (statusRef.current !== "error") setStatus("idle");
  }, []);

  const reconnect = useCallback(async () => {
    if (stopped.current || reconnectAttempts.current >= 1) {
      setError("Voice connection ended. Tap Start voice to reconnect.");
      setStatus("error");
      return;
    }
    reconnectAttempts.current += 1;
    endVoice();
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    await startVoiceRef.current();
  }, [endVoice]);

  const handleFunctionCall = useCallback(async (callId: string, name: string, rawArguments: string) => {
    if (!callId || handledCalls.current.has(callId)) return;
    handledCalls.current.add(callId);
    if (name !== "search_medical_knowledge") return;
    let args: unknown;
    try { args = JSON.parse(rawArguments) as unknown; } catch { args = null; }
    const query = isRecord(args) ? jsonString(args.query).slice(0, 1000) : "";
    const requestedLanguage = isRecord(args) && (args.language === "en" || args.language === "te" || args.language === "hi") ? args.language : language;
    if (!query.trim()) return;
    try {
      const { data } = await api.post<{ passages: Array<{ text: string; sourceSlug: string; score: number }>; response?: string }>("/ai/tool/search_medical_knowledge", {
        query, language: requestedLanguage, mode: context.mode
      });
      const output = data.passages.length
        ? { passages: data.passages.map(({ text, sourceSlug }) => ({ text, sourceSlug })) }
        : { passages: [], response: data.response ?? "No reviewed knowledge is available. Say you do not know and refer the user to a doctor or ASHA." };
      if (channel.current?.readyState === "open") {
        channel.current.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) } }));
        channel.current.send(JSON.stringify({ type: "response.create" }));
      }
    } catch {
      if (channel.current?.readyState === "open") {
        channel.current.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify({ passages: [], response: "Knowledge search is temporarily unavailable. Say you do not know and refer the user to a doctor or ASHA." }) } }));
        channel.current.send(JSON.stringify({ type: "response.create" }));
      }
    }
  }, [context.mode, language]);

  const onServerEvent = useCallback((event: RealtimeEvent) => {
    if (event.type === "conversation.item.input_audio_transcription.completed") {
      const transcript = jsonString(event.transcript);
      if (transcript) appendMessage({ role: "user", content: transcript });
    } else if (event.type === "response.output_audio_transcript.delta" || event.type === "response.text.delta") {
      appendAssistantDelta(jsonString(event.delta));
    } else if (event.type === "response.output_audio_transcript.done" || event.type === "response.text.done") {
      setStatus("listening");
    } else if (event.type === "response.done") {
      setStatus("listening");
    } else if (event.type === "response.function_call_arguments.done") {
      void handleFunctionCall(jsonString(event.call_id), jsonString(event.name), jsonString(event.arguments));
    } else if (event.type === "response.output_item.done" && isRecord(event.item) && event.item.type === "function_call") {
      void handleFunctionCall(jsonString(event.item.call_id), jsonString(event.item.name), jsonString(event.item.arguments));
    } else if (event.type === "error") {
      setError("Voice assistant event failed. Try reconnecting or use text.");
      setStatus("error");
    }
  }, [appendAssistantDelta, appendMessage, handleFunctionCall]);

  const startVoiceRef = useRef<() => Promise<void>>(async () => undefined);
  const startVoice = useCallback(async () => {
    if (peer.current) return;
    setError("");
    setStatus("connecting");
    stopped.current = false;
    handledCalls.current.clear();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access is not available in this browser.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      microphone.current = stream;
      const { data } = await api.post<{ clientSecret: string; expiresAt: number }>("/ai/realtime/session", {
        lang: language, mode: context.mode, field: context.field
      });
      if (!data.clientSecret || typeof data.expiresAt !== "number") throw new Error("The secure voice session could not be opened.");
      const connection = new RTCPeerConnection();
      peer.current = connection;
      stream.getAudioTracks().forEach((track) => connection.addTrack(track, stream));
      const dataChannel = connection.createDataChannel("oai-events");
      channel.current = dataChannel;
      dataChannel.onmessage = (message) => {
        try {
          const parsed = JSON.parse(String(message.data)) as unknown;
          if (isRecord(parsed) && typeof parsed.type === "string") onServerEvent(parsed as RealtimeEvent);
        } catch { setError("A voice event could not be read."); }
      };
      connection.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream || !remoteAudio.current) return;
        remoteAudio.current.srcObject = remoteStream;
        void remoteAudio.current.play().catch(() => setError("Tap the audio control to hear the assistant response."));
        try {
          const contextAudio = new AudioContext();
          const source = contextAudio.createMediaStreamSource(remoteStream);
          const node = contextAudio.createAnalyser();
          node.fftSize = 256;
          source.connect(node);
          audioContext.current = contextAudio;
          analyser.current = node;
        } catch { setAudioLevel(0); }
      };
      connection.onconnectionstatechange = () => {
        if (connection.connectionState === "connected") {
          reconnectAttempts.current = 0;
          setStatus("listening");
        } else if (connection.connectionState === "failed" || connection.connectionState === "disconnected") {
          void reconnect();
        }
      };
      dataChannel.onopen = () => setStatus("listening");
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      const response = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.clientSecret}`, "Content-Type": "application/sdp" },
        body: offer.sdp
      });
      if (!response.ok) throw new Error("Voice connection could not be established. Try the text assistant.");
      await connection.setRemoteDescription({ type: "answer", sdp: await response.text() });
    } catch (caught) {
      endVoice();
      setStatus("error");
      const name = isRecord(caught) ? caught.name : "";
      setError(name === "NotAllowedError" || name === "SecurityError"
        ? "Microphone permission was denied. Allow microphone access or use text."
        : caught instanceof Error ? caught.message : "Voice assistant is unavailable. Use text instead.");
    }
  }, [context.field, context.mode, endVoice, language, onServerEvent, reconnect]);
  startVoiceRef.current = startVoice;

  const sendText = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message) return;
    appendMessage({ role: "user", content: message });
    setError("");
    try {
      const history = messages.slice(-10).map(({ role, content }) => ({ role, content }));
      const { data } = await api.post<{ answer: string; sources: string[] }>("/ai/chat", {
        message, lang: language, mode: context.mode, field: context.field, history
      });
      appendMessage({ role: "assistant", content: data.answer, sources: data.sources });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The assistant could not answer. Please try again.");
    }
  }, [appendMessage, context.field, context.mode, language, messages]);

  const clearConversation = useCallback(() => {
    setMessages([]);
    handledCalls.current.clear();
    setError("");
    setStatus("idle");
    setMuted(false);
    setAudioLevel(0);
  }, []);

  const toggleMute = useCallback(() => {
    const nextMuted = !muted;
    microphone.current?.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
    setMuted(nextMuted);
  }, [muted]);

  useEffect(() => {
    let frame = 0;
    const updateLevel = () => {
      const node = analyser.current;
      if (node) {
        const values = new Uint8Array(node.frequencyBinCount);
        node.getByteFrequencyData(values);
        const sum = values.reduce((total, value) => total + value, 0);
        const level = values.length ? Math.min(1, sum / values.length / 128) : 0;
        setAudioLevel(level);
        if (level > 0.045) setStatus("speaking");
        else if (peer.current?.connectionState === "connected" && statusRef.current === "speaking") setStatus("listening");
      }
      frame = requestAnimationFrame(updateLevel);
    };
    frame = requestAnimationFrame(updateLevel);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => () => endVoice(), [endVoice]);

  return { status, messages, muted, error, audioLevel, remoteAudio, startVoice, endVoice, sendText, toggleMute, clearConversation };
}
