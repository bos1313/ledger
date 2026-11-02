"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Listens to /api/v1/events and re-renders the Server Components on the page
 * when a balance changes. router.refresh() keeps client state (form inputs, scroll).
 */
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const events = new EventSource("/api/v1/events");
    let timer: ReturnType<typeof setTimeout> | undefined;
    events.addEventListener("balance", () => {
      // A cross-currency transfer and a deposit may arrive close together: refresh once.
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 150);
    });
    return () => {
      clearTimeout(timer);
      events.close();
    };
  }, [router]);
  return null;
}
