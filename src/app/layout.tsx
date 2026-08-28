import type { Metadata } from "next";
import "./globals.css";
import { WebMcpProvider } from "@/components/WebMcpProvider";

export const metadata: Metadata = {
  title: "GlassMap",
  description: "An agent-native web map: WebMCP turns the map canvas into a semantic surface.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <WebMcpProvider>{children}</WebMcpProvider>
      </body>
    </html>
  );
}
