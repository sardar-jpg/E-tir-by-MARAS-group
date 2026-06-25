import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { apiFetch } from "../lib/api";

/**
 * Requests push notification permission and registers this device's
 * token with our server, so the server can actually send pushes to it.
 *
 * Does nothing at all on web (Capacitor.isNativePlatform() is false in
 * a regular browser tab) - push notifications only make sense inside
 * the native app, where there's a real APNs-backed device token to
 * register in the first place.
 */
export function usePushNotifications(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (!Capacitor.isNativePlatform()) return;

    let registrationListener: any;
    let errorListener: any;

    (async () => {
      try {
        const permStatus = await PushNotifications.checkPermissions();
        let granted = permStatus.receive === "granted";
        if (!granted && permStatus.receive !== "denied") {
          const requested = await PushNotifications.requestPermissions();
          granted = requested.receive === "granted";
        }
        if (!granted) return;

        registrationListener = await PushNotifications.addListener("registration", async (token) => {
          try {
            await apiFetch("/api/push-tokens", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: token.value, platform: "ios" })
            });
          } catch (err) {
            console.warn("Failed to register push token with server:", err);
          }
        });

        errorListener = await PushNotifications.addListener("registrationError", (err) => {
          console.warn("Push registration error:", err);
        });

        await PushNotifications.register();
      } catch (err) {
        console.warn("Push notification setup failed:", err);
      }
    })();

    return () => {
      registrationListener?.remove?.();
      errorListener?.remove?.();
    };
  }, [enabled]);
}
