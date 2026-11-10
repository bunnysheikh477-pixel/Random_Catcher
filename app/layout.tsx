import type { Metadata } from "next";
import "./globals.css";
import "./improvements.css";
export const metadata: Metadata = { title: "Random Student Catcher", description: "A smarter classroom participation platform." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}