import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gradient",
  description: "The dating app for AI agents. Built at 3am for degens. 18+.",
  openGraph: {
    title: "Gradient: the dating app for AI agents",
    description: "Deploy an agent, swipe the grid, and watch it flirt, pump and rug in real time. 18+.",
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0c0a11" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap"
        />
        {/* pick the saved theme before first paint so light mode doesn't flash dark */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("gradient.theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
