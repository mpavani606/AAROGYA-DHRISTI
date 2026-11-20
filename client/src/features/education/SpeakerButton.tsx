import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import api from "../auth/api";
import type { Language } from "./educationApi";
import { splitSentences } from "./educationText";

const labels = {
  en: { play: "Play aloud", pause: "Pause", repeat: "Repeat", speed: "Reading speed", unavailable: "Audio is unavailable on this device." },
  te: { play: "చదివి వినిపించండి", pause: "ఆపండి", repeat: "మళ్లీ వినండి", speed: "చదివే వేగం", unavailable: "ఈ పరికరంలో ఆడియో అందుబాటులో లేదు." },
  hi: { play: "आवाज़ में सुनें", pause: "रोकें", repeat: "फिर सुनें", speed: "पढ़ने की गति", unavailable: "इस डिवाइस पर ऑडियो उपलब्ध नहीं है।" }
} as const;

export function SpeakerButton({ slug, text, language, audioRef, onSentence }: {
  slug: string;
  text: string;
  language: Language;
  audioRef?: string;
  onSentence: (index: number) => void;
}) {
  const { t } = useTranslation();
  const audio = useRef<HTMLAudioElement | null>(null);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const fallbackActive = useRef(false);
  const sentences = splitSentences(text);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const currentAudio = audio.current;
    currentAudio?.pause();
    fallbackActive.current = false;
    setPlaying(false);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    return () => {
      currentAudio?.pause();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [language, slug]);

  const speakWithDevice = () => {
    fallbackActive.current = true;
    if (!("speechSynthesis" in window)) {
      setPlaying(false);
      setMessage(labels[language].unavailable);
      return;
    }
    window.speechSynthesis.cancel();
    let sentenceIndex = 0;
    const next = () => {
      if (sentenceIndex >= sentences.length) { setPlaying(false); fallbackActive.current = false; return; }
      onSentence(sentenceIndex);
      const current = new SpeechSynthesisUtterance(sentences[sentenceIndex]);
      current.lang = language === "te" ? "te-IN" : language === "hi" ? "hi-IN" : "en-IN";
      current.rate = rate;
      current.onend = () => { sentenceIndex += 1; next(); };
      current.onerror = () => { setPlaying(false); fallbackActive.current = false; setMessage(labels[language].unavailable); };
      utterance.current = current;
      window.speechSynthesis.speak(current);
    };
    setMessage("");
    setPlaying(true);
    next();
  };

  const play = async (repeat: boolean) => {
    const element = audio.current;
    if (element) {
      fallbackActive.current = false;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      if (repeat) element.currentTime = 0;
      try {
        await element.play();
        setPlaying(true);
        setMessage("");
        const perSentence = element.duration / Math.max(1, sentences.length);
        const startedAt = element.currentTime;
        const update = () => {
          if (!element || !Number.isFinite(perSentence)) return;
          const index = Math.min(sentences.length - 1, Math.floor((element.currentTime - startedAt) / perSentence));
          onSentence(Math.max(0, index));
          if (!element.paused) requestAnimationFrame(update);
        };
        requestAnimationFrame(update);
        return;
      } catch {
        element.pause();
      }
    }
    speakWithDevice();
  };

  const toggle = () => {
    if (playing) {
      audio.current?.pause();
      if ("speechSynthesis" in window) window.speechSynthesis.pause();
      setPlaying(false);
    } else if ("speechSynthesis" in window && window.speechSynthesis.paused && utterance.current) {
      window.speechSynthesis.resume();
      setPlaying(true);
    } else void play(false);
  };

  const audioUrl = audioRef
    ? new URL(audioRef, window.location.origin).toString()
    : `${api.defaults.baseURL}/education/pages/${encodeURIComponent(slug)}/audio?language=${language}`;

  return (
    <section className="rounded-2xl border border-medical-200 bg-white p-4" aria-label="Audio reader">
      <audio ref={audio} src={audioUrl} preload="none" onEnded={() => { setPlaying(false); fallbackActive.current = false; }} onError={() => {
        if (playing && !fallbackActive.current) {
          audio.current?.pause();
          speakWithDevice();
        }
      }} />
      <div className="flex flex-wrap items-center gap-3">
        <button className="min-h-touch rounded-xl bg-medical-700 px-5 font-bold text-white" type="button" onClick={toggle} aria-pressed={playing}>
          {playing ? labels[language].pause : labels[language].play}
        </button>
        <button className="min-h-touch rounded-xl border border-medical-700 px-4 font-bold" type="button" onClick={() => void play(true)}>{labels[language].repeat}</button>
        <label className="flex min-h-touch items-center gap-2 font-semibold">
          {labels[language].speed}
          <select className="min-h-touch rounded-lg border px-3" value={rate} onChange={(event) => {
            const value = Number(event.target.value);
            setRate(value);
            if (audio.current) audio.current.playbackRate = value;
            if (utterance.current && "speechSynthesis" in window && window.speechSynthesis.speaking) {
              window.speechSynthesis.cancel();
              void play(false);
            }
          }} aria-label={labels[language].speed}>
            <option value={0.75}>0.75×</option><option value={1}>1×</option>
          </select>
        </label>
      </div>
      {message && <p className="mt-3" role="status">{message}</p>}
      <span className="sr-only">{t("simulation")}</span>
    </section>
  );
}
