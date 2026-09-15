import type { Metadata } from "next";
import { Geist_Mono, Montserrat, Sora } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/contexts/ToastContext";
import Footer from "@/components/Footer";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteTitle = process.env.VERCEL_ENV === 'preview' ? "Preview - My NYCPHA" : "My NYCPHA"

export const metadata: Metadata = {
  title: siteTitle,
  description: "Manage your memberships and registrations",
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', type: 'image/x-icon' }
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon.ico" type="image/x-icon" />
      </head>
      <body
        className={`${montserrat.variable} ${sora.variable} ${geistMono.variable} antialiased bg-gray-50 force-light-mode`}
        style={{ background: '#f9fafb' }}
      >
        <ToastProvider>
          <div className="flex flex-col h-screen">
            <div className="flex-1 overflow-auto">
              {children}
            </div>
            <Footer />
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
