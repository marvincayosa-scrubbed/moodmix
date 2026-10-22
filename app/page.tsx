"use client";
import { useEffect, useRef, useState } from "react";
import {
  Music2,
  Sparkles,
  RefreshCw,
  Copy,
  Download,
  ChevronDown,
  Check,
  AlertCircle,
  LoaderCircle,
  ArrowUpRight,
  Headphones,
  Disc3,
  X,
} from "lucide-react";
import {
  parsePlaylist,
  playlistCsv,
  playlistText,
  type Playlist,
  type Usage,
} from "@/lib/contracts";
const examples = [
  "Late-night drive",
  "Slow Sunday morning",
  "Main character energy",
];
const artworkCache = new Map<string, string | null>();
function Artwork({
  src,
  large = false,
}: {
  src?: string | null;
  large?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <div className={`artwork ${large ? "cover" : ""}`} aria-hidden="true">
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        <Disc3 size={large ? 44 : 21} strokeWidth={1.3} />
      )}
    </div>
  );
}
function Skeleton() {
  return (
    <section
      className="results skeleton"
      aria-label="Generating playlist"
      aria-busy="true"
    >
      <div className="playlist-head">
        <div className="cover bone" />
        <div className="skeleton-meta">
          <div className="bone short" />
          <div className="bone wide" />
          <div className="bone medium" />
        </div>
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <div className="song-row" key={i}>
          <span className="number">{String(i + 1).padStart(2, "0")}</span>
          <div className="artwork bone" />
          <div className="song-info">
            <div className="bone medium" />
            <div className="bone short" />
          </div>
        </div>
      ))}
    </section>
  );
}
export default function Home() {
  const [mood, setMood] = useState("");
  const [count, setCount] = useState(15);
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageReady, setUsageReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [artwork, setArtwork] = useState<Record<string, string | null>>({});
  const [exportsOpen, setExportsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const active = useRef(false);
  const results = useRef<HTMLElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const usageVersion = useRef(0);
  const refreshUsage = async () => {
    const version = ++usageVersion.current;
    try {
      const response = await fetch("/api/usage", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      const body = await response.json();
      if (version !== usageVersion.current) return;
      if (!response.ok)
        throw new Error(
          body.error?.message || "Usage tracking is unavailable.",
        );
      setUsage(body.usage);
      setUsageReady(true);
      setError("");
    } catch (e) {
      if (version === usageVersion.current) {
        setUsageReady(false);
        setError(
          e instanceof Error ? e.message : "Usage tracking is unavailable.",
        );
      }
    }
  };
  useEffect(() => {
    void refreshUsage();
    const timer = setInterval(() => setClock(Date.now()), 30000);
    return () => {
      clearInterval(timer);
      usageVersion.current++;
    };
  }, []);
  useEffect(() => {
    if (usage?.resetAt && Date.parse(usage.resetAt) <= clock && !active.current)
      void refreshUsage();
  }, [clock, usage?.resetAt]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!exportsOpen) return;
    const close = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) setExportsOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setExportsOpen(false);
        menu.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [exportsOpen]);
  useEffect(() => {
    if (!playlist) return;
    const controller = new AbortController();
    let index = 0;
    setArtwork({});
    const worker = async () => {
      while (index < playlist.songs.length && !controller.signal.aborted) {
        const song = playlist.songs[index++];
        const key = JSON.stringify(song);
        let src = artworkCache.get(key);
        if (!artworkCache.has(key)) {
          try {
            const response = await fetch(
              `/api/artwork?${new URLSearchParams(song)}`,
              { signal: controller.signal },
            );
            src = response.ok ? (await response.json()).artwork : null;
          } catch {
            src = null;
          }
          if (controller.signal.aborted) return;
          artworkCache.set(key, src ?? null);
        }
        if (!controller.signal.aborted)
          setArtwork((previous) => ({ ...previous, [key]: src ?? null }));
      }
    };
    void Promise.all([worker(), worker(), worker()]);
    return () => controller.abort();
  }, [playlist]);
  const limitReached = usage?.remaining === 0;
  const resetLabel = usage?.resetAt
    ? new Date(usage.resetAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  async function submit() {
    if (active.current || limitReached || !usageReady) return;
    if (!mood.trim()) {
      setError("Tell us a little about your mood first.");
      textarea.current?.focus();
      return;
    }
    active.current = true;
    usageVersion.current++;
    setBusy(true);
    setError("");
    setNotice("");
    setExportsOpen(false);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mood, count }),
        signal: AbortSignal.timeout(58000),
      });
      const body = await response.json();
      if (body.usage) setUsage(body.usage);
      if (!response.ok)
        throw new Error(
          body.error?.message || "Could not create your playlist.",
        );
      setPlaylist(parsePlaylist(body, count));
      setCopied(false);
      setTimeout(
        () =>
          results.current?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? "instant"
              : "smooth",
            block: "start",
          }),
        80,
      );
    } catch (e) {
      setError(
        e instanceof Error && e.name !== "TimeoutError"
          ? e.message
          : "The request was interrupted. It may have used one generation. Check usage before trying again.",
      );
    } finally {
      active.current = false;
      setBusy(false);
      // Read authoritative usage after errors too; never retry generation automatically.
      const version = ++usageVersion.current;
      try {
        const r = await fetch("/api/usage", { cache: "no-store" });
        const b = await r.json();
        if (version === usageVersion.current) {
          if (r.ok) {
            setUsage(b.usage);
            setUsageReady(true);
          } else setUsageReady(false);
        }
      } catch {
        if (version === usageVersion.current) setUsageReady(false);
      }
    }
  }
  async function copy() {
    if (!playlist) return;
    try {
      await navigator.clipboard.writeText(playlistText(playlist));
      setCopied(true);
      setNotice("Playlist copied.");
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setNotice("Clipboard unavailable. Export a TXT file instead.");
    }
  }
  function download(format: "txt" | "csv") {
    if (!playlist) return;
    const blob = new Blob(
      [
        format === "csv"
          ? "\uFEFF" + playlistCsv(playlist)
          : playlistText(playlist),
      ],
      {
        type:
          format === "csv"
            ? "text/csv;charset=utf-8"
            : "text/plain;charset=utf-8",
      },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${
      playlist.title
        .replace(/[^a-z0-9]+/gi, "-")
        .toLowerCase()
        .slice(0, 80) || "moodmix"
    }.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportsOpen(false);
    setNotice(`${format.toUpperCase()} export started.`);
  }
  return (
    <main className="app-shell">
      <header className="site-header">
        <a href="/" className="brand" aria-label="MoodMix home">
          <span className="brand-icon">
            <Music2 size={21} />
          </span>
          <span>
            MoodMix<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="header-note">Your mood, your music.</span>
      </header>
      <section className="intro">
        <div className="eyebrow">A LITTLE FEELING. A NEW DISCOVERY.</div>
        <h1>Every feeling deserves a soundtrack.</h1>
        <p>Tell us what’s on your mind. We’ll find the music to match.</p>
      </section>
      <section className="generator" aria-labelledby="generator-heading">
        <div className="section-top">
          <h2 id="generator-heading">Set the mood</h2>
          <span className="metadata">01 / DISCOVER</span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="mood" className="sr-only">
            Describe your mood
          </label>
          <div className="textarea-wrap">
            <textarea
              ref={textarea}
              id="mood"
              maxLength={500}
              value={mood}
              onChange={(e) => setMood(e.target.value)}
              disabled={busy}
              aria-describedby="mood-help"
              placeholder="A rainy evening, an open window, and nowhere I need to be…"
            />
            <span className="char-count">{mood.length}/500</span>
          </div>
          <div className="examples">
            <span id="mood-help">Try a feeling</span>
            {examples.map((example) => (
              <button
                className={`prompt ${mood === example ? "selected" : ""}`}
                type="button"
                disabled={busy}
                key={example}
                onClick={() => {
                  setMood(example);
                  textarea.current?.focus();
                }}
              >
                {example}
                <ArrowUpRight size={13} />
              </button>
            ))}
          </div>
          <div className="generator-bottom">
            <fieldset disabled={busy}>
              <legend>Playlist length</legend>
              <div className="segments">
                {[10, 15, 20].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={count === n}
                    className={count === n ? "chosen" : ""}
                    onClick={() => setCount(n)}
                  >
                    {n}
                    <span> songs</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="generate-group">
              <span className="usage">
                {usage
                  ? `${usage.remaining} of 5 generations remaining`
                  : usageReady
                    ? ""
                    : "Usage not available"}
              </span>
              <button
                type="submit"
                className="primary"
                disabled={busy || limitReached || !usageReady}
              >
                {busy ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <Sparkles size={17} />
                )}{" "}
                {busy ? "Generating..." : "Generate playlist"}
              </button>
            </div>
          </div>
          <div className="quota-note">
            Five generations per rolling 24 hours. Accepted attempts count, even
            if generation fails.
          </div>
        </form>
        {limitReached && (
          <div className="message">
            <AlertCircle size={16} />
            <span>
              Your next generation becomes available {resetLabel}. Your playlist
              is still yours to explore and export.
            </span>
          </div>
        )}
        {error && (
          <div className="message error" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
            {!usageReady && (
              <button
                className="text-button"
                onClick={() => void refreshUsage()}
              >
                Check connection
              </button>
            )}
          </div>
        )}
      </section>
      <div className="results-label">
        <span>
          {busy
            ? "FINDING YOUR SOUND"
            : playlist
              ? "YOUR SOUNDTRACK"
              : "UP NEXT"}
        </span>
        <span>
          {playlist && !busy
            ? `${playlist.songs.length} TRACKS · CURATED FOR YOUR MOOD`
            : "MADE FOR THIS MOMENT"}
        </span>
      </div>
      {busy ? (
        <Skeleton />
      ) : playlist ? (
        <section
          ref={results}
          className="results reveal"
          aria-labelledby="playlist-title"
        >
          <div className="playlist-head">
            <Artwork src={artwork[JSON.stringify(playlist.songs[0])]} large />
            <div className="playlist-meta">
              <span className="eyebrow">MOODMIX / PERSONAL PLAYLIST</span>
              <h2 id="playlist-title">{playlist.title}</h2>
              <p>{playlist.description}</p>
              <span className="metadata">
                {playlist.songs.length} songs <span className="dot">·</span> One
                feeling
              </span>
            </div>
          </div>
          <div className="toolbar">
            <span className="toolbar-label">
              <Headphones size={15} /> Find your next favorite
            </span>
            <div className="actions">
              <button onClick={() => void copy()}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
                <span>{copied ? "Copied" : "Copy"}</span>
              </button>
              <div className="export-wrap" ref={menu}>
                <button
                  aria-expanded={exportsOpen}
                  aria-controls="export-options"
                  onClick={() => setExportsOpen(!exportsOpen)}
                >
                  <Download size={16} /> Export <ChevronDown size={14} />
                </button>
                {exportsOpen && (
                  <div id="export-options" className="export-menu">
                    <button onClick={() => download("txt")}>
                      Download TXT
                    </button>
                    <button onClick={() => download("csv")}>
                      Download CSV
                    </button>
                  </div>
                )}
              </div>
              <button
                aria-label="Regenerate"
                disabled={limitReached || !usageReady || busy}
                onClick={() => void submit()}
              >
                <RefreshCw size={16} />
                <span>Regenerate</span>
              </button>
            </div>
          </div>
          <div className="track-heading">
            <span>#</span>
            <span>TRACK / ARTIST</span>
            <span>LISTEN</span>
          </div>
          <ol className="song-list">
            {playlist.songs.map((song, i) => (
              <li key={JSON.stringify(song)} className="song-row">
                <span className="number">{String(i + 1).padStart(2, "0")}</span>
                <Artwork src={artwork[JSON.stringify(song)]} />
                <div className="song-info">
                  <span className="song-title" title={song.title}>
                    {song.title}
                  </span>
                  <span className="artist" title={song.artist}>
                    {song.artist}
                  </span>
                </div>
                <a
                  className="spotify-link"
                  href={`https://open.spotify.com/search/${encodeURIComponent(`${song.title} ${song.artist}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Search Spotify for ${song.title} by ${song.artist}`}
                >
                  <span>Spotify</span>
                  <ArrowUpRight size={17} />
                </a>
              </li>
            ))}
          </ol>
          <p className="result-note">
            AI recommendations, made to explore. Songs aren’t independently
            verified on Spotify. Artwork via iTunes, when available.
          </p>
        </section>
      ) : (
        <section className="empty-state">
          <span className="empty-icon">
            <Headphones size={28} strokeWidth={1.3} />
          </span>
          <h2>Your next favorite song starts here.</h2>
          <p>
            A few words about your world right now.
            <br />A playlist that feels a little more like you.
          </p>
          <div className="empty-steps">
            <span>Describe</span>
            <span className="step-line" />
            <span>Discover</span>
            <span className="step-line" />
            <span>Make it yours</span>
          </div>
        </section>
      )}
      <footer>
        <span>
          <Music2 size={14} /> Made for the way you feel.
        </span>
        <span>No account. Just music.</span>
        <p>
          Anonymous usage limits are shared by network. Changing networks may
          change your quota.
        </p>
      </footer>
      <div
        className={`toast ${notice ? "visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        {notice && (
          <>
            <Check size={16} />
            <span>{notice}</span>
            <button
              onClick={() => setNotice("")}
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </main>
  );
}
