/**
 * Safe API client. Talks to this app's own Express server at /api/* on
 * whatever origin the app is currently served from, attaching the signed
 * session token as a standard Authorization header.
 *
 * This file previously contained two pieces of Google AI Studio
 * development/preview scaffolding that had no business being in a
 * production app and have been removed for security reasons:
 *
 * 1. A client-side "backend URL override" (etir_backend_url in
 *    localStorage, surfaced as an "Active Sandbox API Link" button in the
 *    UI). Any user — or anyone who could get a user to set this value,
 *    e.g. via a malicious script — could redirect every API call,
 *    including the user's real session token and login credentials, to
 *    an arbitrary attacker-controlled URL, since requests were sent with
 *    `credentials: "include"`. This was a genuine data-exfiltration
 *    vector reachable by any user of the app, not just admins.
 *
 * 2. Custom-domain routing logic that probed Google's internal AI Studio
 *    dev/preview URLs (ais-pre-*, ais-dev-*) whenever the app was
 *    accessed via any domain other than localhost or *.run.app. This
 *    would have caused real problems the moment a real custom domain
 *    (e.g. etir.app) is pointed at this app: every API call from a real
 *    user would have attempted to route through unrelated Google AI
 *    Studio sandbox environments instead of this app's own server.
 *
 * See fetchFromFirestoreDirectly below for a related, already-fixed
 * issue from the same root cause (AI Studio's own dev-preview fallback
 * logic being left in the shipped app).
 */

// Safe, iframe-resilient localStorage fallback storage helper
const memoryStorage: Record<string, string> = {};

export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn(`[Iframe Storage] Read blocked for key "${key}", using virtual memory fallback`);
    return memoryStorage[key] || null;
  }
}

export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn(`[Iframe Storage] Write blocked for key "${key}", saving to virtual memory`);
    memoryStorage[key] = value;
  }
}

export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    console.warn(`[Iframe Storage] Purge blocked for key "${key}", deleting from virtual memory`);
    delete memoryStorage[key];
  }
}

function getSessionToken(): string | null {
  try {
    const stored = safeGetItem("etir_session");
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed?.token || null;
  } catch {
    return null;
  }
}

export async function apiFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  let url = typeof input === "string" ? input : input.toString();

  if (url.startsWith("/api/")) {
    let updatedInit = init ? { ...init } : {};

    // Attach the signed session token (if we have one) as a standard
    // Authorization header. Endpoints that don't require auth simply
    // ignore it; endpoints that do require it will reject the request
    // with 401 if this is missing or invalid.
    const token = getSessionToken();
    if (token) {
      const existingHeaders = updatedInit.headers;
      const headerObj: Record<string, string> =
        existingHeaders instanceof Headers
          ? Object.fromEntries(existingHeaders.entries())
          : Array.isArray(existingHeaders)
            ? Object.fromEntries(existingHeaders)
            : { ...(existingHeaders as Record<string, string> | undefined) };
      headerObj["Authorization"] = `Bearer ${token}`;
      updatedInit.headers = headerObj;
    }

    const originalMethod = updatedInit.method ? updatedInit.method.toUpperCase() : "GET";

    if (originalMethod === "PUT" || originalMethod === "DELETE") {
      updatedInit = {
        ...updatedInit,
        method: "POST"
      };

      let plainHeaders: Record<string, string> = {
        "X-HTTP-Method-Override": originalMethod
      };

      // Rebuild from updatedInit.headers (which already has Authorization
      // attached above), not the original init.headers — otherwise the
      // token attached just above would be silently dropped on every
      // PUT/DELETE request.
      const headersToCopy = updatedInit.headers;
      if (headersToCopy) {
        if (headersToCopy instanceof Headers) {
          headersToCopy.forEach((val, key) => {
            plainHeaders[key] = val;
          });
        } else if (Array.isArray(headersToCopy)) {
          for (const [key, val] of headersToCopy) {
            plainHeaders[key] = val;
          }
        } else {
          plainHeaders = {
            ...headersToCopy,
            ...plainHeaders
          };
        }
      }
      updatedInit.headers = plainHeaders;
    }

    // Allow a build-time API base URL override via environment variable.
    // This is set at build time by whoever deploys the app, not by any
    // user at runtime, so it does not carry the same risk as the
    // removed client-side override mechanism described above.
    const customApiUrl = (import.meta as any).env?.VITE_API_URL;
    if (customApiUrl) {
      return fetch(`${customApiUrl.replace(/\/$/, "")}${url}`, updatedInit);
    }

    return fetch(url, updatedInit);
  }

  return fetch(url, init);
}
