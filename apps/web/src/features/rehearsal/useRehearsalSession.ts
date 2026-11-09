import type { ClientMessage } from "@bandsync/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RehearsalSocket, type SocketSnapshot } from "../../lib/realtime/RehearsalSocket";

export function rehearsalSocketUrl(bandId: string, sessionId: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/bands/${bandId}/rehearsals/${sessionId}/ws`;
}

export function useRehearsalSession(bandId: string, sessionId: string) {
  const socketRef = useRef<RehearsalSocket | null>(null);
  const [snap, setSnap] = useState<SocketSnapshot | null>(null);

  useEffect(() => {
    const socket = new RehearsalSocket(rehearsalSocketUrl(bandId, sessionId));
    socketRef.current = socket;
    const unsub = socket.subscribe(setSnap);
    socket.connect();
    const onVisible = () => {
      // Returning from background: refresh clock samples quickly; the socket reconnects by itself if dropped.
      if (document.visibilityState === "visible") socket.resync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      unsub();
      socket.close();
      socketRef.current = null;
    };
  }, [bandId, sessionId]);

  const send = useCallback((msg: ClientMessage) => socketRef.current?.send(msg) ?? false, []);
  const resync = useCallback(() => socketRef.current?.resync(), []);
  const getOffsetMs = useCallback(() => socketRef.current?.offsetMs() ?? 0, []);

  return useMemo(() => ({ snap, send, resync, getOffsetMs }), [snap, send, resync, getOffsetMs]);
}
