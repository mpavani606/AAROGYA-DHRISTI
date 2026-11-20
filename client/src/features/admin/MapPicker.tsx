import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export default function MapPicker({ lat, lng, onChange }: { lat?: number; lng?: number; onChange: (lat: number, lng: number) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const marker = useRef<L.Marker>();
  useEffect(() => {
    if (!element.current) return;
    const map = L.map(element.current).setView([lat ?? 17.73, lng ?? 82.96], 8);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(map);
    const update = (event: L.LeafletMouseEvent) => {
      marker.current?.remove();
      marker.current = L.marker(event.latlng).addTo(map);
      onChange(event.latlng.lat, event.latlng.lng);
    };
    map.on("click", update);
    return () => { map.off("click", update); map.remove(); };
  }, [onChange]);
  return <div ref={element} className="h-56 w-full rounded-xl border" aria-label="Hospital map picker" />;
}
