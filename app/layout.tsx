import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk, Geist_Mono } from "next/font/google";
import { Toaster } from "react-hot-toast";
import "./globals.css";
import { AppHeader } from "@/components/common/app-header";
import { DevelopmentToolbar } from "@/components/common/development-toolbar";

// Display: a soft, optical, dreamy serif — characterful without being loud
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
  style: ["normal", "italic"],
});

// Body: a warm, clean grotesque (deliberately not Inter/Geist/Space Grotesk)
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sleep Stories — Calming Sleep Video Studio",
  description:
    "Turn a script into long, calming 'fall asleep to' videos: no-gap scene breakdown and dark cinematic imagery.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${fraunces.variable} ${hanken.variable} ${geistMono.variable} font-sans antialiased min-h-screen`}
      >
        {/* Fixed nocturnal atmosphere */}
        <div className="nocturne-bg" aria-hidden />
        <div className="nocturne-aurora" aria-hidden />
        <div className="nocturne-stars" aria-hidden />
        <div className="nocturne-grain" aria-hidden />

        <AppHeader />
        <main className="relative">{children}</main>
        <DevelopmentToolbar />
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: "rgba(15, 19, 34, 0.92)",
              color: "#e7e9f5",
              border: "1px solid #232a40",
              backdropFilter: "blur(12px)",
              borderRadius: "0.75rem",
            },
          }}
        />
      </body>
    </html>
  );
}
