import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist_Mono, Inter, Space_Grotesk } from "next/font/google";
import { ConvexClientProvider } from "@/components/providers/convex-client-provider";
import { appEnv } from "@/lib/env";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SmartPuck Workspace",
  description: "Upload meeting captures from SmartPuck, organize them into folders, and chat with the session context.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full font-sans text-foreground" suppressHydrationWarning>
        {appEnv.hasClerk ? (
          <ClerkProvider>
            <ConvexClientProvider>{children}</ConvexClientProvider>
          </ClerkProvider>
        ) : (
          <ConvexClientProvider>{children}</ConvexClientProvider>
        )}
      </body>
    </html>
  );
}
