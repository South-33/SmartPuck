import type { Metadata } from "next";
import {
  ClerkProvider,
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
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
  const content = <ConvexClientProvider>{children}</ConvexClientProvider>;

  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans text-foreground">
        {appEnv.hasClerk ? (
          <ClerkProvider>
            <div className="pointer-events-none fixed inset-x-0 top-0 z-50 px-4 py-4 sm:px-6 xl:px-8">
              <div className="pointer-events-auto mx-auto flex w-full max-w-[1680px] items-center justify-end gap-2 rounded-full border border-white/80 bg-white/82 px-3 py-2 shadow-[0_20px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
                <Show when="signed-out">
                  <SignInButton mode="modal">
                    <button className="rounded-full border border-sp-line bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50">
                      Sign in
                    </button>
                  </SignInButton>
                  <SignUpButton mode="modal">
                    <button className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white">
                      Sign up
                    </button>
                  </SignUpButton>
                </Show>
                <Show when="signed-in">
                  <UserButton />
                </Show>
              </div>
            </div>
            {content}
          </ClerkProvider>
        ) : (
          content
        )}
      </body>
    </html>
  );
}
