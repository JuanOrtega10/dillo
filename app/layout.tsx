import type React from "react"
import type { Metadata } from "next"
import { Rye, Outfit } from "next/font/google"
import "./globals.css"

const rye = Rye({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-brand",
})

const outfit = Outfit({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-ui",
})

export const metadata: Metadata = {
  title: "Dillo - AI English Learning Companion",
  description: "Your AI-native companion for English classes — focused on pronunciation.",
    generator: 'v0.app'
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body
        className={`font-ui ${rye.variable} ${outfit.variable}`}
        style={
          {
            "--font-brand": rye.style.fontFamily,
            "--font-ui": outfit.style.fontFamily,
          } as React.CSSProperties
        }
      >
        {children}
      </body>
    </html>
  )
}
