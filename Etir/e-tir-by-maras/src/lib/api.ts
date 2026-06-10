/**
 * Safe API client for both internal Cloud Run workspace environment and external
 * custom domains (such as Hostinger, Vercel, or custom landing pages).
 * Avoids monkeypatching window.fetch to prevent iframe security sandbox exceptions.
 */
export async function apiFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  let url = typeof input === "string" ? input : input.toString();
  
  if (url.startsWith("/api/")) {
    let updatedInit = init ? { ...init } : {};
    const originalMethod = updatedInit.method ? updatedInit.method.toUpperCase() : "GET";
    
    if (originalMethod === "PUT" || originalMethod === "DELETE") {
      updatedInit = {
        ...updatedInit,
        method: "POST"
      };
      
      let plainHeaders: Record<string, string> = {
        "X-HTTP-Method-Override": originalMethod
      };
      
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((val, key) => {
            plainHeaders[key] = val;
          });
        } else if (Array.isArray(init.headers)) {
          for (const [key, val] of init.headers) {
            plainHeaders[key] = val;
          }
        } else {
          plainHeaders = {
            ...init.headers,
            ...plainHeaders
          };
        }
      }
      updatedInit.headers = plainHeaders;
    }

    // 1. Check if VITE_API_URL environment variable is provided
    const customApiUrl = (import.meta as any).env?.VITE_API_URL;
    if (customApiUrl) {
      return fetch(`${customApiUrl.replace(/\/$/, "")}${url}`, updatedInit);
    }
    
    if (typeof window !== "undefined") {
      const hostname = window.location.hostname;
      // 2. Identify if we are running under a custom production domain (e.g. etir.app)
      const isCustomDomain = 
        hostname.includes("etir.app") || 
        (!hostname.includes("localhost") && !hostname.includes("127.0.0.1") && !hostname.includes("run.app"));
        
      if (isCustomDomain) {
        // 1. Primary: Query the current host's relative endpoint (production backend server!)
        let shouldTryFallback = false;
        let localResponse: Response | null = null;
        try {
          localResponse = await fetch(url, updatedInit);
          const contentType = localResponse.headers.get("content-type") || "";
          
          // If relative backend is active and responded with valid JSON, return it
          if (localResponse.ok && contentType.includes("application/json")) {
            return localResponse;
          }
          
          // If we receive index.html (static page preview) instead of JSON, or if the status is not ok (e.g. 404, 405), try fallback.
          if (!localResponse.ok || contentType.includes("text/html") || localResponse.status === 404 || localResponse.status === 405) {
            console.warn(`Local endpoint returned status ${localResponse.status} (${contentType}). Trying central sandbox fallback...`);
            shouldTryFallback = true;
          }
        } catch (localErr) {
          console.warn("Local same-origin fetch failed, falling back to workspace bridge:", localErr);
          shouldTryFallback = true;
        }

        if (shouldTryFallback) {
          // 2. Sandbox Fallback Chain: Central Cloud Run sandboxes (active in staging/dev preview)
          const fallbacks = [
            "https://ais-pre-4skg7zsw6jgfuo4mrmf6c5-118370257232.europe-west1.run.app",
            "https://ais-dev-4skg7zsw6jgfuo4mrmf6c5-118370257232.europe-west1.run.app"
          ];
  
          let lastError: any = null;
          for (const base of fallbacks) {
            try {
              console.log(`Connecting custom domain api request to sandbox fallback: ${base}${url}`);
              
              const res = await fetch(`${base}${url}`, updatedInit);
              
              // Check that we didn't get an HTML index fallback from another domain hosting static files
              const contentType = res.headers.get("content-type") || "";
              if (contentType.includes("text/html")) {
                console.warn(`Sandbox central backend ${base} returned HTML index, skipping fallback.`);
                continue;
              }
              
              return res;
            } catch (e: any) {
              console.warn(`Fallback fetch failed for backend base ${base}:`, e);
              lastError = e;
            }
          }
  
          if (lastError) {
            throw lastError;
          }
        } else if (localResponse) {
          return localResponse;
        }
      }
    }
    
    return fetch(url, updatedInit);
  }
  
  return fetch(url, init);
}
