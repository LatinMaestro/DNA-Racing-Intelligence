import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "DNA Racing Intelligence",
    template: "%s | DNA Racing Intelligence",
  },
  description: "Private DNA Racing decision support for one vault owner.",
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const document = (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
  const publishableKey =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";

  return publishableKey === "" ? (
    document
  ) : (
    <ClerkProvider publishableKey={publishableKey}>{document}</ClerkProvider>
  );
}
