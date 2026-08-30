import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { WebMcpProvider } from "@/components/WebMcpProvider";
import { BOOT_CHROME_SCRIPT } from "./boot-chrome";

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
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      // `data-chrome` is written onto this element by the script below, before
      // React sees the document, and React never renders it — the usual
      // arrangement for anything a page has to know before its first paint.
      // Without this, hydration reports the attribute it did not render as a
      // mismatch.
      suppressHydrationWarning
    >
      <body className="h-full">
        {/*
          Which chrome this document opens in, decided before anything is
          painted. First in the body and synchronous on purpose: nothing below
          it has been parsed yet, so there is no frame in which a restored agent
          link can show the human chrome. See `boot-chrome.ts` for what it reads
          and where it can be wrong; the awakening controller
          (`components/awaken/controller.ts`) owns the attribute from hydration
          onwards.

          A plain inline script rather than `next/script`: `beforeInteractive`
          is for fetched scripts (it preloads a `src` and does not block
          hydration), and this one has to run at parse time, in place, with no
          network in the way.
        */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_CHROME_SCRIPT }} />
        <WebMcpProvider>{children}</WebMcpProvider>
      </body>
    </html>
  );
}
