"use client";

import { useEffect } from "react";
import { installDesktopFetchBridge } from "@/lib/desktop";
import { useToast } from "@/hooks/use-toast";

export function DesktopRuntime() {
  const { toast } = useToast();

  useEffect(() => {
    installDesktopFetchBridge();
    const queued = () => toast({
      title: "تم الحفظ محلياً",
      description: "العملية بانتظار المزامنة التلقائية عند توفر الإنترنت.",
    });
    window.addEventListener("ajn-desktop-queued", queued);
    return () => window.removeEventListener("ajn-desktop-queued", queued);
  }, [toast]);

  return null;
}

