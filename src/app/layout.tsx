import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { WebMcpProvider } from "@/components/WebMcpProvider";

/**
 * Both faces are self-hosted by `next/font`: the files are downloaded at build
 * time and served from this origin, so a running GlassMap makes no request to
 * Google — the same zero-backend rule the rest of the app follows.
 *
 * Inter carries the UI; JetBrains Mono is the data face (tool names, ids,
 * coordinates, counts, timestamps). Each variable resolves to the face plus
 * the metric-matched local fallback `next/font` generates; the system stacks
 * behind them are in `globals.css`, with the rest of the type tokens.
 */
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
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
