import React from "react";
import { Navbar } from "./Navbar";
import { MobileNav } from "./MobileNav";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground font-sans">
      <Navbar />
      <main className="flex-1 pb-16 md:pb-0">
        {children}
      </main>
      <MobileNav />
      <footer className="border-t border-border/40 py-6 text-center text-sm text-muted-foreground mt-auto" dir="rtl">
        <div className="container mx-auto px-4 flex flex-col items-center gap-3">
          <p className="text-center text-[#858585c2] text-xs md:text-sm">© حقوق الملكية والتطوير: ENG — HUSSEIN ALI HAMMED</p>
        </div>
      </footer>
    </div>
  );
}