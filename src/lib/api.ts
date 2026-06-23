/**
 * Safe API client for both internal Cloud Run workspace environment and external
 * custom domains (such as Hostinger, Vercel, or custom landing pages).
 * Automatically handles CORS obstacles by detecting common proxy/routing modes
 * and reporting a clear error if the real server can't be reached — this used
 * to fall back to direct client-side Firestore access, which has been removed
 * for security reasons (see fetchFromFirestoreDirectly below for why).
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

type RouteMode = "local" | "pre" | "dev" | "firestore";
let cachedBackendMode: RouteMode | null = null;
let resolutionPromise: Promise<RouteMode> | null = null;

async function resolveRouteMode(): Promise<RouteMode> {
  if (cachedBackendMode) return cachedBackendMode;
  if (resolutionPromise) return resolutionPromise;

  resolutionPromise = (async () => {
    // Probe candidates in parallel to quickly find the fastest responsive backend.
    // If none respond with valid JSON in 1.4 seconds, fallback immediately to direct client-side Firestore SDK queries.
    const candidates: { mode: RouteMode; url: string }[] = [
      { mode: "local", url: "/api/chat/unread" },
      { mode: "pre", url: "https://ais-pre-4skg7zsw6jgfuo4mrmf6c5-118370257232.europe-west1.run.app/api/chat/unread" },
      { mode: "dev", url: "https://ais-dev-4skg7zsw6jgfuo4mrmf6c5-118370257232.europe-west1.run.app/api/chat/unread" },
    ];

    const timeoutPromise = (ms: number) => new Promise<null>(resolve => setTimeout(() => resolve(null), ms));

    const testCandidate = async (candidate: { mode: RouteMode; url: string }): Promise<RouteMode | null> => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200); // 1.2 second grace period for active API backends

        const res = await fetch(candidate.url, {
          method: "GET",
          signal: controller.signal,
          credentials: "include"
        });

        clearTimeout(timeoutId);

        const contentType = res.headers.get("content-type") || "";
        if (res.ok && contentType.includes("application/json")) {
          return candidate.mode;
        }
      } catch (e) {
        // failed or timed out
      }
      return null;
    };

    try {
      const results = await Promise.race([
        Promise.all(candidates.map(c => testCandidate(c))),
        timeoutPromise(1300).then(() => [])
      ]);

      const successfulMode = (results || []).find((m): m is RouteMode => m !== null);
      if (successfulMode) {
        console.log(`[SWR API Router] Handshake completed successfully. Active route: ${successfulMode}`);
        cachedBackendMode = successfulMode;
        return successfulMode;
      }
    } catch (e) {
      console.warn("[SWR API Router] Handshake failure, choosing safe direct Firestore:", e);
    }

    console.log("[SWR API Router] Handshake with APIs timed out or returned HTML. Selecting secure client-side direct Firestore fallback.");
    cachedBackendMode = "firestore";
    return "firestore";
  })();

  return resolutionPromise;
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

    // Ensure we run in browser context before checking overrides
    if (typeof window !== "undefined") {
      const storageOverride = safeGetItem("etir_backend_url");
      if (storageOverride && storageOverride.trim()) {
        let cleanOverride = storageOverride.trim();
        try {
          const urlObj = new URL(cleanOverride);
          cleanOverride = urlObj.origin;
        } catch (err) {
          cleanOverride = cleanOverride.replace(/\/$/, "");
          if (!cleanOverride.startsWith("http://") && !cleanOverride.startsWith("https://")) {
            cleanOverride = "https://" + cleanOverride;
          }
        }
        
        if (cleanOverride && !window.location.origin.includes(cleanOverride)) {
          try {
            const targetUrl = `${cleanOverride}${url}`;
            // Force include developer credentials to authorize against active dev proxies
            const fetchOptions = { ...updatedInit, credentials: "include" as const };
            const res = await fetch(targetUrl, fetchOptions);
            
            const contentType = res.headers.get("content-type") || "";
            // If the request was successful and returned JSON, return it
            if (res.ok && !contentType.includes("text/html")) {
              return res;
            } else {
              console.warn(`Bridge response at ${targetUrl} is non-JSON or proxy blocked (Content-Type: ${contentType}). Querying Firestore directly client-side...`);
              return await fetchFromFirestoreDirectly(url, updatedInit);
            }
          } catch (e) {
            console.warn("Dynamic workspace bridge connect failed. Router falling back to client-side Firestore direct connection:", e);
            return await fetchFromFirestoreDirectly(url, updatedInit);
          }
        }
      }
    }

    // 1. Check if VITE_API_URL environment variable is provided
    const customApiUrl = (import.meta as any).env?.VITE_API_URL;
    if (customApiUrl) {
      return fetch(`${customApiUrl.replace(/\/$/, "")}${url}`, updatedInit);
    }
    
    if (typeof window !== "undefined") {
      const hostname = window.location.hostname;
      // 2. Identify if we are running under a custom production domain
      const isCustomDomain = 
        (!hostname.includes("localhost") && !hostname.includes("127.0.0.1") && !hostname.includes("run.app"));
        
      if (isCustomDomain) {
        const mode = await resolveRouteMode();
        if (mode === "firestore") {
          return await fetchFromFirestoreDirectly(url, updatedInit);
        } else if (mode === "local") {
          return await fetch(url, updatedInit);
        } else if (mode === "pre") {
          const base = "https://ais-pre-4skg7zsw6jgfuo4mrmf6c5-118370257232.europe-west1.run.app";
          return await fetch(`${base}${url}`, { ...updatedInit, credentials: "include" as const });
        } else if (mode === "dev") {
          const base = "https://ais-dev-4skg7zsw6jgfuo4mrmf6c5-118370257232.europe-west1.run.app";
          return await fetch(`${base}${url}`, { ...updatedInit, credentials: "include" as const });
        }
      }
    }
    
    return fetch(url, updatedInit);
  }
  
  return fetch(url, init);
}

export function getSavedBackendUrl(): string {
  if (typeof window === "undefined") return "";
  return safeGetItem("etir_backend_url") || "";
}

export function setSavedBackendUrl(url: string): void {
  if (typeof window === "undefined") return;
  const clean = (url || "").trim();
  if (!clean) {
    safeRemoveItem("etir_backend_url");
  } else {
    safeSetItem("etir_backend_url", clean);
  }
}

export function isCustomDomainActive(): boolean {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname;
  return (!hostname.includes("localhost") && !hostname.includes("127.0.0.1") && !hostname.includes("run.app"));
}

/**
 * Perform direct client-side Firestore operations to resolve standard logistics endpoints,
 * completely bypassing cookie-protection proxy barriers on custom external domains.
 */
async function fetchFromFirestoreDirectly(url: string, init?: RequestInit): Promise<Response> {
  // REMOVED (security fix): this function used to re-implement nearly
  // every API endpoint directly against client-side Firestore as a
  // fallback for when the real server was unreachable. That required
  // firestore.rules to allow public read/write on everything, which is
  // exactly how this app's data (including plaintext passwords) ended up
  // readable by anyone on the internet with no login at all — see
  // firestore.rules for the fix. It also contained a copy of the
  // server's old hardcoded master admin passwords, shipped to every
  // browser in the JS bundle.
  //
  // Now that firestore.rules only allows the server's own dedicated
  // account to read/write, this fallback could never work even if left
  // in place — every call would simply get a permission-denied error
  // from Firestore. Rather than leave that broken (and still
  // security-sensitive) code in place, this just returns a clear error
  // so the UI can show "couldn't reach the server" instead of silently
  // trying and failing against Firestore directly.
  console.error(`[api] Server unreachable for ${init?.method || "GET"} ${url}, and the client-side Firestore fallback has been removed for security reasons. Check your connection and that the server is running.`);
  return createMockResponse(
    { error: "Could not reach the server. Please check your connection and try again." },
    503
  );
}

function createMockResponse(data: any, status = 200): Response {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  return new Response(blob, {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: {
      "Content-Type": "application/json"
    }
  });
}
