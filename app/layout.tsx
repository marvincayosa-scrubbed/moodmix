import type { Metadata } from "next";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "MoodMix — Your mood, your music",
  description:
    "Every feeling deserves a soundtrack. Turn your mood into a personal playlist with MoodMix.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
