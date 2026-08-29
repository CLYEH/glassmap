import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { WebMcpProvider } from "@/components/WebMcpProvider";

/**
 * Both faces are self-hosted by `next/font`: the files are downloaded at build
 * time and served from this origin, so a running GlassMap makes no request to
 * Google — the same zero-backend rule the rest of the app follows. The fallback
 * stacks are what shows if a font file ever fails to arrive.
 *
 * Inter carries the UI; JetBrains Mono is the data face (tool names, ids,
 * coordinates, counts, timestamps).
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
  fallback: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
  fallback: ["SF Mono", "ui-monospace", "Menlo", "monospace"],
});

export const metadata: Metadata = {
  title: "GlassMap",
  description: "An agent-native web map: WebMCP turns the map canvas into a semantic surface.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="h-full">
        <WebMcpProvider>{children}</WebMcpProvider>
      </body>
    </html>
  );
}
