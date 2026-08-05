import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { auth } from "@/auth";
import { Navbar } from "@/components/navbar";
import "./globals.css";

// Latin + Cyrillic self-hosted; CJK + kaomoji come from the Noto faces
// loaded via <link> below and chained after Inter in globals.css.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext", "cyrillic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "mochidonut",
  description: "A little corner of the internet.",
};

// Chat's composer is `position: fixed; bottom-0`. By default mobile browsers
// shrink only the *visual* viewport when the on-screen keyboard opens, leaving
// the layout viewport full-height — so the fixed composer stays anchored to the
// (now off-screen) bottom and the browser over-scrolls to reveal it, shoving the
// message bar to the top of the screen and hiding the thread (seen on Firefox/
// Chrome Android). `resizes-content` shrinks the layout viewport to the space
// above the keyboard, so `bottom-0` recomputes there and the composer simply
// sits above the keyboard. iOS Safari ignores this hint (its own behavior, which
// already works after the ≥16px zoom fix), so this is Android-safe and inert
// elsewhere.
export const viewport: Viewport = {
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const currentUser = session?.user?.name ?? null;

  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col bg-page">
        <Navbar currentUser={currentUser} />
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
