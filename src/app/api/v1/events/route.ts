import { apiError } from "@/server/api";
import { getSession } from "@/server/auth";
import { subscribe } from "@/server/events";

/**
 * Server-Sent Events: GET /api/v1/events
 * Sends `event: balance` whenever one of the signed-in user's balances changes
 * (Stripe deposit booked by the webhook, or a transfer from another tab/device).
 * The event carries no data: the client re-renders and reads fresh numbers from the DB.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // serverless hosts cut long requests; EventSource reconnects by itself

const HEARTBEAT_MS = 25_000; // keeps proxies from closing an idle connection

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return apiError(401, "UNAUTHENTICATED", "Login required");

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup(); // stream already closed
        }
      };
      send("retry: 3000\n\n"); // reconnect delay for EventSource

      let unsubscribe: () => void;
      try {
        unsubscribe = await subscribe(session.userId, () => send("event: balance\ndata: {}\n\n"));
      } catch (e) {
        console.error("[events] LISTEN failed", e);
        controller.error(e); // client reconnects after `retry`
        return;
      }
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      if (req.signal.aborted) cleanup();
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no", // nginx: don't buffer the stream
    },
  });
}
