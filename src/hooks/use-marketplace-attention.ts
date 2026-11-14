import { useEffect, useRef, useState } from "react";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";
import { getSerametAccessToken } from "@/lib/access-token";

// Keep the user-enabled audio context across page navigation, never across identities.
let sharedAudio: {
  key: string;
  context: AudioContext;
  enabled: boolean;
  lastSound: number;
} | null = null;

export function useMarketplaceAttention() {
  const { activeTenantId, branchId, currentUser, hasPermission } = useAppContext();
  const [orders, setOrders] = useState<{ id: string; reference: string }[]>([]);
  const [ordersScope, setOrdersScope] = useState("");
  const [sound, setSound] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const enabled = hasPermission(permissions.integrationsOrdersManage);
  const key = `seramet-marketplace-sound:${activeTenantId}:${branchId}:${currentUser.id}`;
  const enableSound = async () => {
    if (sound) {
      if (sharedAudio?.key === key) sharedAudio.enabled = false;
      setSound(false);
      return;
    }
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      sharedAudio = {
        key,
        context: audio.current,
        enabled: true,
        lastSound: sharedAudio?.key === key ? sharedAudio.lastSound : 0,
      };
      setSound(true);
    } catch {
      setSound(false);
    }
  };
  useEffect(() => {
    if (sharedAudio && (sharedAudio.key !== key || !enabled)) {
      void sharedAudio.context.close();
      sharedAudio = null;
    }
    audio.current = sharedAudio?.context ?? null;
    setSound(sharedAudio?.enabled ?? false);
    setOrders([]);
    setUnavailable(false);
  }, [key, enabled]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false,
      busy = false;
    const controller = new AbortController();
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const token = getSerametAccessToken();
        const response = await fetch(
          `/api/seramet/integrations/marketplace/attention?branchId=${encodeURIComponent(branchId)}`,
          {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
            headers: {
              ...(token ? { authorization: `Bearer ${token}` } : {}),
              "x-seramet-tenant-id": activeTenantId,
              "x-seramet-user-id": currentUser.id,
              "x-seramet-branch-id": branchId,
            },
          },
        );
        if (!response.ok) throw new Error("Order alerts unavailable");
        const payload = (await response.json()) as { orders: { id: string; reference: string }[] };
        if (cancelled) return;
        setOrders(payload.orders);
        setOrdersScope(key);
        setUnavailable(false);
        if (
          payload.orders.length &&
          sound &&
          audio.current?.state === "running" &&
          sharedAudio?.key === key &&
          Date.now() - sharedAudio.lastSound >= 30_000
        ) {
          const context = audio.current;
          const oscillator = context.createOscillator(),
            gain = context.createGain();
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.frequency.value = 740;
          gain.gain.setValueAtTime(0.08, context.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.4);
          oscillator.start();
          oscillator.stop(context.currentTime + 0.4);
          oscillator.onended = () => {
            oscillator.disconnect();
            gain.disconnect();
          };
          sharedAudio.lastSound = Date.now();
        }
      } catch {
        if (!cancelled) setUnavailable(true);
      } finally {
        busy = false;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [activeTenantId, branchId, currentUser.id, enabled, sound, key]);
  return {
    orders: enabled && ordersScope === key ? orders : [],
    sound,
    enableSound,
    enabled,
    unavailable,
  };
}
