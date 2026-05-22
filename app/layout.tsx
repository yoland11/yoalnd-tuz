import type { Metadata } from "next";
import "@/index.css";

export const metadata: Metadata = {
  title: "مجموعة علي جان",
  description: "منصة مجموعة علي جان للخدمات والمتجر والتتبع",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
