"use client";

/**
 * WebSocket subscription to the workspace event stream.
 *
 * Reconnects with backoff and hands every event to the caller; consumers filter
 * by run/session themselves. One socket per mounted hook is fine at console
 * scale — the server fans out per workspace.
 */

import { useEffect, useRef } from "react";

import { API_URL, getToken } from "./api";
import type { PlatformEvent } from "./types";

export function useEvents(onEvent: (event: PlatformEvent) => void): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryDelay = 1000;
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const token = getToken();
      if (!token || closed) return;
      const wsUrl = API_URL.replace(/^http/, "ws");
      socket = new WebSocket(`${wsUrl}/ws?token=${encodeURIComponent(token)}`);
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as PlatformEvent;
          if (event.type) handler.current(event);
        } catch {
          /* ignore non-event frames */
        }
      };
      socket.onopen = () => {
        retryDelay = 1000;
      };
      socket.onclose = () => {
        if (!closed) {
          retryTimer = setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 15000);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, []);
}
