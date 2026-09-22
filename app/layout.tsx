import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import PWAHandler from "./components/PWAHandler";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#3F3F46",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "VIJAYA LAKSHMI INDUSTRIES - POS",
  description: "VIJAYA LAKSHMI INDUSTRIES Billing, Inventory & Digital Invoices",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "VIJAYA LAKSHMI INDUSTRIES",
  },
  icons: {
    icon: "/logo.jpeg",
    apple: "/logo.jpeg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} h-full antialiased`}
    >
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="VIJAYA LAKSHMI INDUSTRIES" />
        <link rel="apple-touch-icon" href="/logo.jpeg" />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <PWAHandler />
      </body>
    </html>
  );
}
