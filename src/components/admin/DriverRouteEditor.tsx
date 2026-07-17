import { useState } from "react";
import { ArrowRight, Plus, X } from "lucide-react";
import type { Driver, DriverRoute } from "../../types";
import { apiFetch } from "../../lib/api";
import { isSameRoute, MAX_ROUTE_ENDPOINT_LENGTH } from "../../lib/driverAlliance";

/**
 * Driver Alliance Phase 1 — per-driver working-route editor on the
 * existing Driver Alliance card. Routes are DIRECTIONAL (Turkey → Iraq ≠
 * Iraq → Turkey), duplicates are blocked client-side for immediate
 * feedback and re-validated server-side (sanitizeWorkingRoutes — the
 * authoritative check). Admin-only by construction: the server rejects
 * driver sessions writing workingRoutes regardless of what any UI does.
 */
interface DriverRouteEditorProps {
  driver: Driver;
  onDriverUpdated: (driver: Driver) => void;
  onError: (message: string) => void;
}

/** Common zone suggestions — free-form entry is still allowed. */
const ZONE_SUGGESTIONS = ["Turkey", "Iraq", "Europe", "Jordan", "Saudi Arabia", "Iran", "Syria", "UAE", "Kuwait"];

export default function DriverRouteEditor({ driver, onDriverUpdated, onError }: DriverRouteEditorProps) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const routes = driver.workingRoutes || [];

  const save = async (nextRoutes: DriverRoute[]) => {
    setIsSaving(true);
    try {
      const res = await apiFetch(`/api/drivers/${driver.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workingRoutes: nextRoutes }),
      });
      if (res.ok) {
        onDriverUpdated(await res.json());
      } else {
        let msg = "Failed to save routes.";
        try { msg = (await res.json())?.error || msg; } catch {}
        onError(msg);
      }
    } catch {
      onError("Could not reach the server to save routes.");
    } finally {
      setIsSaving(false);
    }
  };

  const addRoute = () => {
    const f = from.trim().replace(/\s+/g, " ");
    const t = to.trim().replace(/\s+/g, " ");
    if (!f || !t) return;
    if (f.toLowerCase() === t.toLowerCase()) {
      onError("A route's origin and destination cannot be the same.");
      return;
    }
    if (routes.some((r) => isSameRoute(r, { from: f, to: t }))) {
      onError(`Duplicate route: ${f} → ${t}.`);
      return;
    }
    const next: DriverRoute[] = [
      ...routes,
      { id: `route-${Date.now()}-${Math.floor(Math.random() * 1000)}`, from: f, to: t, active: true },
    ];
    setFrom("");
    setTo("");
    save(next);
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
      <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">Working Routes</span>

      {routes.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {routes.map((r) => (
            <span
              key={r.id}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-semibold ${
                r.active
                  ? "bg-sky-50 border-sky-200 text-sky-800"
                  : "bg-slate-50 border-slate-200 text-slate-400 line-through"
              }`}
            >
              <button
                type="button"
                disabled={isSaving}
                title={r.active ? "Deactivate route" : "Activate route"}
                onClick={() => save(routes.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)))}
                className="cursor-pointer bg-transparent border-0 p-0 font-semibold"
              >
                {r.from} <ArrowRight className="w-3 h-3 inline" /> {r.to}
              </button>
              <button
                type="button"
                disabled={isSaving}
                title="Remove route"
                onClick={() => save(routes.filter((x) => x.id !== r.id))}
                className="cursor-pointer bg-transparent border-0 p-0 text-slate-400 hover:text-red-500"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-slate-400 italic">No routes yet — this driver won't match any offers.</p>
      )}

      <div className="flex items-center gap-1.5">
        <input
          type="text"
          list="alliance-zone-suggestions"
          maxLength={MAX_ROUTE_ENDPOINT_LENGTH}
          placeholder="From"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="w-full min-w-0 p-1.5 bg-slate-50 border border-slate-200 focus:border-slate-400 rounded-lg outline-none text-[11px]"
        />
        <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <input
          type="text"
          list="alliance-zone-suggestions"
          maxLength={MAX_ROUTE_ENDPOINT_LENGTH}
          placeholder="To"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRoute(); } }}
          className="w-full min-w-0 p-1.5 bg-slate-50 border border-slate-200 focus:border-slate-400 rounded-lg outline-none text-[11px]"
        />
        <button
          type="button"
          onClick={addRoute}
          disabled={isSaving || !from.trim() || !to.trim()}
          title="Add route"
          className="p-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-lg cursor-pointer shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <datalist id="alliance-zone-suggestions">
          {ZONE_SUGGESTIONS.map((z) => <option key={z} value={z} />)}
        </datalist>
      </div>
    </div>
  );
}
