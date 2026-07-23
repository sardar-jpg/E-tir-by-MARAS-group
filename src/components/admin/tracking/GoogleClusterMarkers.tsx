import { useEffect, useMemo, useState } from "react";
import { AdvancedMarker, useMap } from "@vis.gl/react-google-maps";
import { Truck } from "lucide-react";
import type { Shipment } from "../../../types";
import type { TrackingState } from "../../../lib/trackingPositions";
import { clusterMarkers } from "../../../lib/markerClustering";
import { stateColors } from "./trackingMarkerStyles";

/**
 * Google Maps marker clustering for the tracking Operations Center.
 *
 * @vis.gl/react-google-maps ships no clusterer, so we reuse the same pure
 * clusterMarkers() the Vector Radar uses — here on real lat/lng values with a
 * zoom-dependent degree radius, so markers group tighter as you zoom in and
 * expand as you zoom out. Nothing is fabricated: cluster bubbles sit at the
 * average of their members' REAL coordinates, and only markers with a valid
 * drawable position are ever passed in (Location Unavailable shipments are
 * excluded upstream and never clustered).
 *
 * The selected shipment is always rendered as its own highlighted marker,
 * never folded into a count bubble, so it stays identifiable. Clicking a
 * single marker selects the shipment (syncing the list, map focus and detail
 * drawer via onSelect); clicking a cluster zooms the map in on it.
 */
export interface GoogleTrackMarker {
  shipment: Shipment;
  lat: number;
  lng: number;
  state: TrackingState;
}

export default function GoogleClusterMarkers({
  markers,
  selectedId,
  onSelect,
}: {
  markers: GoogleTrackMarker[];
  selectedId?: string;
  onSelect: (s: Shipment) => void;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState<number>(map?.getZoom() ?? 6);

  // Track the live zoom so the cluster radius re-tightens as the operator
  // zooms in. (Camera changes don't re-render this component on their own.)
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("zoom_changed", () => {
      setZoom(map.getZoom() ?? 6);
    });
    return () => listener.remove();
  }, [map]);

  // The selected shipment is pulled OUT of clustering so it always shows as an
  // individual, highlighted marker.
  const selectedMarker = useMemo(
    () => markers.find(m => m.shipment.id === selectedId) || null,
    [markers, selectedId]
  );

  const clusters = useMemo(() => {
    const clusterable = markers.filter(m => m.shipment.id !== selectedId);
    // Degree radius shrinks with zoom: generous when zoomed out, tight when in.
    const radiusDeg = 80 / Math.pow(2, Math.max(zoom, 1));
    return clusterMarkers(
      clusterable.map(m => ({ x: m.lng, y: m.lat, marker: m })),
      radiusDeg
    );
  }, [markers, selectedId, zoom]);

  function renderSingle(m: GoogleTrackMarker, isSelected: boolean) {
    const colors = stateColors(m.state);
    return (
      <AdvancedMarker
        key={m.shipment.id}
        position={{ lat: m.lat, lng: m.lng }}
        title={`Shipment #${m.shipment.shipmentNumber}`}
        onClick={() => onSelect(m.shipment)}
      >
        <div className={`flex flex-col items-center justify-center gap-0.5 cursor-pointer transform transition-all hover:scale-110 active:scale-95 ${isSelected ? "scale-110 z-20" : "z-10"}`}>
          {/* Order-number pill (light, per Operations Center design) */}
          <span className={`shadow-md font-bold font-mono text-[10px]/tight px-2 py-0.5 rounded-md whitespace-nowrap border ${isSelected ? "bg-orange-600 border-orange-700 text-white" : "bg-white border-slate-300 text-slate-800"}`}>
            {m.shipment.shipmentNumber}
          </span>
          {/* State-coloured circular marker */}
          <div
            style={{ width: "34px", height: "34px" }}
            className={`w-[34px] h-[34px] rounded-full flex items-center justify-center border-[3px] shadow-lg transition-transform ${isSelected ? "bg-orange-600 border-white" : colors.bg}`}
          >
            <Truck className="w-4 h-4 text-white" />
          </div>
        </div>
      </AdvancedMarker>
    );
  }

  return (
    <>
      {clusters.map(cluster => {
        if (cluster.count === 1) {
          return renderSingle(cluster.items[0].marker, false);
        }
        const key = `gcluster-${cluster.items[0].marker.shipment.id}-${cluster.count}`;
        return (
          <AdvancedMarker
            key={key}
            position={{ lat: cluster.y, lng: cluster.x }}
            title={`${cluster.count} shipments`}
            onClick={() => {
              if (!map) return;
              const next = Math.min((map.getZoom() ?? zoom) + 2, 16);
              map.setZoom(next);
              map.panTo({ lat: cluster.y, lng: cluster.x });
            }}
          >
            <div className="flex items-center justify-center cursor-pointer transform transition-all hover:scale-110 active:scale-95 z-10">
              <div
                style={{ width: "40px", height: "40px" }}
                className="w-10 h-10 rounded-full flex items-center justify-center border-[3px] border-white bg-slate-800 text-white font-mono font-black text-sm shadow-xl ring-2 ring-slate-300"
              >
                {cluster.count}
              </div>
            </div>
          </AdvancedMarker>
        );
      })}

      {/* Selected shipment: always its own highlighted marker (never clustered). */}
      {selectedMarker && renderSingle(selectedMarker, true)}
    </>
  );
}
