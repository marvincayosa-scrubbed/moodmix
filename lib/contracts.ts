export type Song = { title: string; artist: string };
export type Usage = {
  remaining: number;
  limit: number;
  resetAt: string | null;
};
export type Playlist = { title: string; description: string; songs: Song[] };
export function parseInput(value: unknown): { mood: string; count: number } {
  if (!value || typeof value !== "object")
    throw new Error("Enter a mood and select a playlist length.");
  const { mood, count } = value as Record<string, unknown>;
  if (typeof mood !== "string" || !mood.trim() || mood.length > 500)
    throw new Error("Describe your mood in 1–500 characters.");
  if (typeof count !== "number" || ![10, 15, 20].includes(count))
    throw new Error("Choose 10, 15, or 20 songs.");
  return { mood: mood.trim(), count };
}
export function parsePlaylist(value: unknown, count: number): Playlist {
  if (!value || typeof value !== "object") throw new Error("Invalid playlist");
  const p = value as Record<string, unknown>;
  const valid = (v: unknown, max: number): v is string =>
    typeof v === "string" && v.trim().length > 0 && v.length <= max;
  if (
    !valid(p.title, 160) ||
    !valid(p.description, 600) ||
    !Array.isArray(p.songs) ||
    p.songs.length !== count
  )
    throw new Error("Incomplete playlist");
  const songs: Song[] = p.songs.map((s: unknown) => {
    if (!s || typeof s !== "object") throw new Error("Invalid song");
    const { title, artist } = s as Record<string, unknown>;
    if (!valid(title, 200) || !valid(artist, 200))
      throw new Error("Invalid song");
    return { title: title.trim(), artist: artist.trim() };
  });
  const keys = songs.map((s) =>
    `${s.title}|${s.artist}`
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}|]/gu, ""),
  );
  if (new Set(keys).size !== count) throw new Error("Duplicate songs");
  return { title: p.title.trim(), description: p.description.trim(), songs };
}
export function playlistText(p: Playlist) {
  return `${p.title}\n${p.description}\n\n${p.songs.map((s, i) => `${i + 1}. ${s.title} — ${s.artist}`).join("\n")}`;
}
export function playlistCsv(p: Playlist) {
  const cell = (s: string) =>
    `"${(/^[\s]*[=+\-@\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""')}"`;
  return (
    "Position,Title,Artist\r\n" +
    p.songs
      .map((s, i) => `${i + 1},${cell(s.title)},${cell(s.artist)}`)
      .join("\r\n")
  );
}
