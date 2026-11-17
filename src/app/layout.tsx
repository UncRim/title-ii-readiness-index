import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { DirectionProvider } from "@/components/foundations/direction/direction";
import "@/styles/globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "ADA Title II Readiness — public scanner",
  description:
    "Upload public IPEDS and .gov lists, run a stratified accessibility scan with live progress, and download aggregate results.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-background-primary-default text-text-primary">
        <DirectionProvider locale="en-US">
          <a
            href="#main-content"
            className="fixed start-4 top-4 z-[100] -translate-y-24 rounded-lg bg-button-primary px-4 py-2 text-body-medium text-text-white opacity-0 shadow-lg transition-transform duration-200 focus-visible:translate-y-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2"
          >
            Skip to main content
          </a>
          <main id="main-content" className="min-h-full">
            {children}
          </main>
        </DirectionProvider>
      </body>
    </html>
  );
}
