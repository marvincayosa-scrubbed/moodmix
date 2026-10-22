"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, LoaderCircle, X } from "lucide-react";
import type { Song } from "@/lib/contracts";
import { isAudioPreview, type AudioPreview as Preview } from "@/lib/artwork";
const previewCache = new Map<string, Preview | null>();
export function AudioPreview({
  song,
  onClose,
  id,
}: {
  song: Song;
  onClose: () => void;
  id: string;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    const key = JSON.stringify(song);
    async function load() {
      setLoading(true);
      setPreview(null);
      setMessage("");
      setFailed(false);
      try {
        let match = previewCache.get(key);
        if (!previewCache.has(key)) {
          const response = await fetch(
            `/api/preview?${new URLSearchParams(song)}`,
            {
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(8000),
              ]),
            },
          );
          const body = await response.json().catch(() => null);
          if (!response.ok)
            throw new Error(
              body?.error?.message ||
                "Audio preview is unavailable right now. Try opening the song on Spotify.",
            );
          match = body?.preview;
          if (match !== null && !isAudioPreview(match))
            throw new Error("Audio preview is unavailable for this song.");
          if (controller.signal.aborted) return;
          if (previewCache.size >= 100)
            previewCache.delete(previewCache.keys().next().value!);
          previewCache.set(key, match ?? null);
        }
        if (!controller.signal.aborted) {
          setPreview(match ?? null);
          if (!match)
            setMessage(
              "No audio preview is available for this song. You can still find it on Spotify.",
            );
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setMessage(
            error instanceof Error && error.name !== "TimeoutError"
              ? error.message
              : "Audio preview is taking too long. Try opening the song on Spotify.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [song]);
  useEffect(() => {
    const player = audio.current;
    return () => {
      if (player) {
        player.pause();
        player.removeAttribute("src");
        player.load();
      }
    };
  }, [preview?.url, failed]);
  const spotifyUrl = `https://open.spotify.com/search/${encodeURIComponent(`${song.title} ${song.artist}`)}`;
  return (
    <div
      className="preview-panel"
      id={id}
      role="region"
      aria-label={`Audio preview for ${song.title}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="preview-top">
        <span>Preview via iTunes</span>
        <button
          type="button"
          className="preview-close"
          aria-label="Close audio preview"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      {loading ? (
        <p className="preview-status" role="status">
          <LoaderCircle size={16} className="spin" /> Finding an audio preview…
        </p>
      ) : preview && !failed ? (
        <audio
          ref={audio}
          className="audio-player"
          src={preview.url}
          controls
          controlsList="nodownload"
          preload="none"
          aria-label={`Preview ${song.title} by ${song.artist}`}
          onError={() => setFailed(true)}
        />
      ) : (
        <p className="preview-status" role="status">
          {failed
            ? "This audio preview could not play. Try opening the song on Spotify."
            : message}
        </p>
      )}
      <div className="preview-foot">
        <p>
          Song previews provided courtesy of iTunes. Availability and duration
          vary.
        </p>
        <div className="preview-links">
          {preview && (
            <a
              href={preview.storeUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              View in iTunes <ArrowUpRight size={14} />
            </a>
          )}
          <a href={spotifyUrl} target="_blank" rel="noopener noreferrer">
            Find on Spotify <ArrowUpRight size={14} />
          </a>
        </div>
      </div>
    </div>
  );
}
