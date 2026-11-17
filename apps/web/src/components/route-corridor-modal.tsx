"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";

interface RouteStop {
  id?: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  orderIndex: number;
  isMandatory: boolean;
}

interface RouteCorridorModalProps {
  routeId: string;
  routeName: string;
  onClose: () => void;
  onSaved: () => void;
}

export function RouteCorridorModal({
  routeId,
  routeName,
  onClose,
  onSaved,
}: RouteCorridorModalProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const polylineLayerRef = useRef<any>(null);
  const corridorLayerRef = useRef<any>(null);
  const stopsLayerGroupRef = useRef<any>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Rejimlar: 'view', 'draw_line', 'add_stop'
  const [mode, setMode] = useState<"view" | "draw_line" | "add_stop">("view");
  const [corridorWidth, setCorridorWidth] = useState<number>(150);
  const [coords, setCoords] = useState<Array<[number, number]>>([]); // [[lat, lon], ...]
  const [stops, setStops] = useState<RouteStop[]>([]);

  // Yangi bekat ma'lumotlari kiritish
  const [newStopName, setNewStopName] = useState("");
  const [newStopRadius, setNewStopRadius] = useState(100);

  // 1. Leaflet kutubxonasini yuklash
  useEffect(() => {
    let isMounted = true;

    async function initLeaflet() {
      if (typeof window === "undefined") return;

      // Leaflet CSS ni yuklash
      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css";
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }

      // Leaflet JS ni yuklash
      if (!(window as any).L) {
        await new Promise<void>((resolve) => {
          const script = document.createElement("script");
          script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
          script.onload = () => resolve();
          document.head.appendChild(script);
        });
      }

      if (!isMounted || !mapContainerRef.current) return;

      const L = (window as any).L;

      // Xaritani yaratish
      const map = L.map(mapContainerRef.current, {
        center: [41.311081, 69.240562], // Toshkent
        zoom: 12,
      });

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      stopsLayerGroupRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;

      // Xaritada bosganda hodisa
      map.on("click", (e: any) => {
        handleMapClick(e.latlng.lat, e.latlng.lng);
      });

      // Mavjud koridor va bekatlarni yuklash
      await fetchCorridorData();
      setLoading(false);
    }

    initLeaflet();

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [routeId]);

  // 2. Serverdan marshrut koridorini olish
  async function fetchCorridorData() {
    try {
      const isRemote = window.location.host.includes("bmbrutto.uz");
      const apiBase = isRemote ? "" : "https://uyushma.bmbrutto.uz";
      const res = await fetch(`${apiBase}/api/v1/routes/${routeId}/corridor`);
      if (!res.ok) throw new Error("Koridor ma'lumotlarini yuklab bo'lmadi");
      const data = await res.json();

      setCorridorWidth(data.corridorWidthMeters || 150);

      // Polyline koordinatalarini tartiblash
      const rawPoly = data.corridorPolyline;
      let parsedCoords: Array<[number, number]> = [];

      if (Array.isArray(rawPoly)) {
        parsedCoords = rawPoly
          .map((pt: any): [number, number] | null => {
            if (Array.isArray(pt) && pt.length >= 2) {
              const p0 = Number(pt[0]);
              const p1 = Number(pt[1]);
              if (p0 > 50 && p1 < 50) return [p1, p0];
              return [p0, p1];
            }
            return null;
          })
          .filter((pt): pt is [number, number] => pt !== null && pt[0] !== 0);
      }

      setCoords(parsedCoords);
      setStops(data.stops || []);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Xatolik yuz berdi");
    }
  }

  // 3. Xaritani koordinatalar o'zgarganda qayta chizish
  useEffect(() => {
    const L = (window as any).L;
    const map = mapInstanceRef.current;
    if (!L || !map) return;

    // Eski qatlamlarni tozalash
    if (polylineLayerRef.current) {
      map.removeLayer(polylineLayerRef.current);
      polylineLayerRef.current = null;
    }
    if (corridorLayerRef.current) {
      map.removeLayer(corridorLayerRef.current);
      corridorLayerRef.current = null;
    }

    if (coords.length > 0) {
      // 1. Asosiy chiziq (Polyline)
      polylineLayerRef.current = L.polyline(coords, {
        color: "#38bdf8", // Sky blue
        weight: 5,
        opacity: 0.9,
      }).addTo(map);

      // 2. Bufer koridor (yarim-shaffof keng chiziq)
      corridorLayerRef.current = L.polyline(coords, {
        color: "#0284c7",
        weight: Math.max(12, Math.round(corridorWidth / 8)), // visual width proportional to meters
        opacity: 0.25,
      }).addTo(map);

      // Xaritani poliliniyaga moslashtirish
      if (coords.length >= 2) {
        map.fitBounds(polylineLayerRef.current.getBounds(), { padding: [40, 40] });
      } else {
        map.setView(coords[0], 14);
      }
    }

    // Bekatlarni yangilash
    if (stopsLayerGroupRef.current) {
      stopsLayerGroupRef.current.clearLayers();
      stops.forEach((s, idx) => {
        // Bekat aylanasi (Geofence radiusi)
        const circle = L.circle([s.latitude, s.longitude], {
          color: "#f59e0b",
          fillColor: "#fbbf24",
          fillOpacity: 0.2,
          radius: s.radiusMeters || 100,
        });

        // Bekat markeri
        const marker = L.circleMarker([s.latitude, s.longitude], {
          color: "#ffffff",
          fillColor: "#d97706",
          fillOpacity: 1.0,
          weight: 2,
          radius: 8,
        }).bindPopup(`<b>${idx + 1}. ${s.name}</b><br>Geofence radiusi: ${s.radiusMeters}m`);

        stopsLayerGroupRef.current.addLayer(circle);
        stopsLayerGroupRef.current.addLayer(marker);
      });
    }
  }, [coords, corridorWidth, stops]);

  // 4. Xarita bosilganda koordinata qo'shish
  function handleMapClick(lat: number, lon: number) {
    if (mode === "draw_line") {
      setCoords((prev) => [...prev, [lat, lon]]);
    } else if (mode === "add_stop") {
      const stopName = newStopName.trim() || `Bekat #${stops.length + 1}`;
      const newStop: RouteStop = {
        name: stopName,
        latitude: lat,
        longitude: lon,
        radiusMeters: newStopRadius,
        orderIndex: stops.length,
        isMandatory: true,
      };
      setStops((prev) => [...prev, newStop]);
      setNewStopName("");
      setMode("view");
      setNotice(`"${stopName}" bekat xaritaga qo'shildi!`);
    }
  }

  // 5. GPX / KML fayl yuklash va parslash
  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsedPoints: Array<[number, number]> = [];

        if (file.name.endsWith(".gpx")) {
          // GPX parslash (<trkpt lat="..." lon="...">)
          const parser = new DOMParser();
          const xml = parser.parseFromString(text, "text/xml");
          const trkpts = xml.getElementsByTagName("trkpt");
          for (let i = 0; i < trkpts.length; i++) {
            const lat = parseFloat(trkpts[i].getAttribute("lat") || "0");
            const lon = parseFloat(trkpts[i].getAttribute("lon") || "0");
            if (lat && lon) parsedPoints.push([lat, lon]);
          }
        } else if (file.name.endsWith(".kml")) {
          // KML parslash (<coordinates>lon,lat,alt lon,lat,alt</coordinates>)
          const match = text.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
          if (match && match[1]) {
            const rawCoords = match[1].trim().split(/\s+/);
            rawCoords.forEach((pair) => {
              const parts = pair.split(",");
              if (parts.length >= 2) {
                const lon = parseFloat(parts[0]);
                const lat = parseFloat(parts[1]);
                if (lat && lon) parsedPoints.push([lat, lon]);
              }
            });
          }
        }

        if (parsedPoints.length > 0) {
          setCoords(parsedPoints);
          setNotice(`${file.name} faylidan ${parsedPoints.length} ta nuqta muvaffaqiyatli yuklandi!`);
        } else {
          setError("Fayldan koordinatalarni o'qib bo'lmadi. GPX yoki KML formati to'g'riligini tekshiring.");
        }
      } catch (err) {
        setError("Faylni o'qishda xatolik yuz berdi.");
      }
    };
    reader.readAsText(file);
  }

  // 6. Oxirgi nuqtani bekor qilish (Undo)
  function handleUndo() {
    setCoords((prev) => prev.slice(0, -1));
  }

  // 7. Barchasini tozalash
  function handleClear() {
    if (confirm("Haqiqatan ham barcha nuqtalarni tozalamoqchimisiz?")) {
      setCoords([]);
      setStops([]);
    }
  }

  // 8. Serverga saqlash
  async function handleSave() {
    if (coords.length < 2) {
      setError("Marshrut koridori kamida 2 ta nuqtadan iborat bo'lishi kerak.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const isRemote = window.location.host.includes("bmbrutto.uz");
      const apiBase = isRemote ? "" : "https://uyushma.bmbrutto.uz";

      // Koordinatalarni GeoJSON LineString formatida saqlaymiz: [[lon, lat], ...]
      const geojsonCoords = coords.map(([lat, lon]) => [lon, lat]);

      const res = await fetch(`${apiBase}/api/v1/routes/${routeId}/corridor`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          corridorPolyline: geojsonCoords,
          corridorWidthMeters: corridorWidth,
        }),
      });

      if (!res.ok) throw new Error("Koridorni saqlashda server xatosi");

      // Bekatlarni saqlash
      for (const stop of stops) {
        if (!stop.id) {
          await fetch(`${apiBase}/api/v1/routes/${routeId}/stops`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(stop),
          });
        }
      }

      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Saqlashda xatolik");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="relative w-full max-w-6xl h-[90vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden text-slate-100">
        
        {/* Modal Sarlavhasi */}
        <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-950/80">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🗺️</span>
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide">
                Marshrut Koridori & Geofence Tahrirchisi
              </h2>
              <p className="text-xs text-sky-400 font-medium">
                {routeName} &bull; Koridor buferi: {corridorWidth} metr
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving || coords.length < 2}
              className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-bold px-4 py-2 text-xs transition shadow-lg shadow-sky-500/20"
            >
              {saving ? "Saqlanmoqda..." : "💾 Saqlash va Faollashtirish"}
            </button>
            <button
              onClick={onClose}
              className="rounded-xl p-2 text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              ✕
            </button>
          </div>
        </header>

        {/* Xabarlar */}
        {error && (
          <div className="bg-rose-950/80 border-b border-rose-800 text-rose-300 text-xs px-6 py-2.5 flex justify-between">
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)}>✕</button>
          </div>
        )}
        {notice && (
          <div className="bg-emerald-950/80 border-b border-emerald-800 text-emerald-300 text-xs px-6 py-2.5 flex justify-between">
            <span>✅ {notice}</span>
            <button onClick={() => setNotice(null)}>✕</button>
          </div>
        )}

        {/* Boshqaruv vositalari paneli (Toolbar) */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 bg-slate-900/90 border-b border-slate-800 text-xs">
          
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode(mode === "draw_line" ? "view" : "draw_line")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold transition ${
                mode === "draw_line"
                  ? "bg-sky-500 text-slate-950 shadow"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              ✏️ {mode === "draw_line" ? "Chizish rejimida (Xaritani bosing)" : "Poliliniya chizish"}
            </button>

            <button
              type="button"
              onClick={() => setMode(mode === "add_stop" ? "view" : "add_stop")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold transition ${
                mode === "add_stop"
                  ? "bg-amber-500 text-slate-950 shadow"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              🚏 {mode === "add_stop" ? "Bekat joyini tanlang" : "Bekat qo'shish"}
            </button>

            {coords.length > 0 && (
              <button
                type="button"
                onClick={handleUndo}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-xl font-medium transition"
              >
                ↩ Bekor qilish
              </button>
            )}

            <button
              type="button"
              onClick={handleClear}
              className="bg-slate-800 hover:bg-rose-950 hover:text-rose-400 text-slate-400 px-3 py-1.5 rounded-xl font-medium transition"
            >
              🗑 Tozalash
            </button>
          </div>

          {/* Koridor Kengligi Slayderi (100m - 500m) */}
          <div className="flex items-center gap-3 bg-slate-950 px-4 py-1.5 rounded-xl border border-slate-800">
            <span className="text-slate-400 font-medium">Koridor buferi:</span>
            <input
              type="range"
              min="100"
              max="500"
              step="25"
              value={corridorWidth}
              onChange={(e) => setCorridorWidth(Number(e.target.value))}
              className="w-32 accent-sky-500 cursor-pointer"
            />
            <span className="font-bold text-sky-400 min-w-[50px]">{corridorWidth} m</span>
          </div>

          {/* GPX / KML Import */}
          <div className="flex items-center gap-2">
            <label className="cursor-pointer inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-xl font-semibold border border-slate-700 transition">
              <span>📥 GPX / KML yuklash</span>
              <input
                type="file"
                accept=".gpx,.kml"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Asosiy Xarita va Yon Panel */}
        <div className="relative flex-1 flex overflow-hidden">
          
          {/* Xarita */}
          <div ref={mapContainerRef} className="flex-1 w-full h-full bg-slate-950 z-0" />

          {/* O'ng Yon Panel (Bekatlar va Statistikalar) */}
          <div className="w-80 border-l border-slate-800 bg-slate-950/90 flex flex-col p-4 overflow-y-auto">
            
            <h3 className="font-bold text-sm text-white mb-2 flex items-center justify-between">
              <span>🚏 Marshrut Bekatlari</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono">
                {stops.length} ta
              </span>
            </h3>

            {mode === "add_stop" && (
              <div className="mb-4 p-3 rounded-xl bg-amber-950/40 border border-amber-800/60 space-y-2">
                <span className="text-xs font-bold text-amber-300">Yangi bekat ma'lumotlari:</span>
                <input
                  type="text"
                  placeholder="Bekat nomi (masalan: Chorsu bozori)"
                  value={newStopName}
                  onChange={(e) => setNewStopName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-xs rounded-lg px-2.5 py-1.5 text-white"
                />
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Radius: {newStopRadius}m</span>
                  <input
                    type="range"
                    min="50"
                    max="200"
                    step="10"
                    value={newStopRadius}
                    onChange={(e) => setNewStopRadius(Number(e.target.value))}
                    className="w-24 accent-amber-500"
                  />
                </div>
                <p className="text-[11px] text-amber-400/80">Xaritada bekat joyini bosing.</p>
              </div>
            )}

            <div className="flex-1 space-y-2 overflow-y-auto">
              {stops.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500">
                  Hozircha bekatlar kiritilmagan.<br />
                  "Bekat qo'shish" tugmasini bosing.
                </div>
              ) : (
                stops.map((stop, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-white">
                        {idx + 1}. {stop.name}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Geofence radiusi: {stop.radiusMeters}m
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStops((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-slate-500 hover:text-rose-400 p-1"
                      title="O'chirish"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Nuqtalar statistikasi */}
            <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex justify-between">
              <span>Koridor nuqtalari soni:</span>
              <span className="font-bold text-sky-400">{coords.length} ta</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
