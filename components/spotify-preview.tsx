"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, LoaderCircle, X } from "lucide-react";
import type { Song } from "@/lib/contracts";
import {
  spotifyEmbedUrl,
  spotifyIdPattern,
  type SpotifyTrack,
} from "@/lib/spotify-contracts";
const trackCache = new Map<string, SpotifyTrack | null>();
export function SpotifyPreview({
  song,
  onClose,
  id,
}: {
  song: Song;
  onClose: () => void;
  id: string;
}) {
  const [track, setTrack] = useState<SpotifyTrack | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [frameFailed, setFrameFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const key = JSON.stringify(song);
    async function load() {
      setLoading(true);
      setTrack(null);
      setMessage("");
      setFrameFailed(false);
      try {
        let match = trackCache.get(key);
        if (!trackCache.has(key)) {
          const response = await fetch(
            `/api/spotify?${new URLSearchParams(song)}`,
            {
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(12000),
              ]),
            },
          );
          const body = await response.json().catch(() => null);
          if (!response.ok)
            throw new Error(
              body?.error?.message ||
                "Spotify preview is unavailable right now. Try opening the song on Spotify.",
            );
          match = body?.track;
          if (
            match !== null &&
            (!match ||
              typeof match.id !== "string" ||
              !spotifyIdPattern.test(match.id))
          )
            throw new Error("Spotify preview is unavailable for this song.");
          if (controller.signal.aborted) return;
          if (trackCache.size >= 100)
            trackCache.delete(trackCache.keys().next().value!);
          trackCache.set(key, match ?? null);
        }
        if (!controller.signal.aborted) {
          setTrack(match ?? null);
          if (!match)
            setMessage(
              "No exact Spotify match found. Try searching for this song instead.",
            );
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setMessage(
            error instanceof Error && error.name !== "TimeoutError"
              ? error.message
              : "Spotify is taking too long. Try opening the song on Spotify.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [song]);
  const spotifyUrl = track
    ? `https://open.spotify.com/track/${track.id}`
    : `https://open.spotify.com/search/${encodeURIComponent(`${song.title} ${song.artist}`)}`;
  return (
    <div
      className="preview-panel"
      id={id}
      role="region"
      aria-label={`Spotify preview for ${song.title}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="preview-top">
        <span>Spotify preview</span>
        <button
          type="button"
          className="preview-close"
          aria-label="Close Spotify preview"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      {loading ? (
        <p className="preview-status" role="status">
          <LoaderCircle size={16} className="spin" /> Finding this track on
          Spotify…
        </p>
      ) : track && !frameFailed ? (
        <iframe
          key={track.id}
          className="spotify-frame"
          src={spotifyEmbedUrl(track.id)}
          title={`Spotify player: ${song.title} by ${song.artist}`}
          width="100%"
          height="152"
          loading="lazy"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          onError={() => setFrameFailed(true)}
        />
      ) : (
        <p className="preview-status" role="status">
          {frameFailed
            ? "The Spotify player could not load. Try opening the song on Spotify."
            : message}
        </p>
      )}
      <div className="preview-foot">
        <p>
          Playback availability depends on Spotify, your region, and sign-in.
          Opening the player connects to Spotify.
        </p>
        <a href={spotifyUrl} target="_blank" rel="noopener noreferrer">
          Open in Spotify <ArrowUpRight size={14} />
        </a>
      </div>
    </div>
  );
}
