import { MapCoordinate } from "@/services/mockData";

export interface MapMarker extends MapCoordinate {
  relation: "self" | "friend";
}

const MARKER_COLORS: Record<MapMarker["relation"], string> = {
  self: "#22d3ee",
  friend: "#d946ef",
};

/**
 * Usernames and custom drink names are free-form user input and end up
 * inside the popup markup, so they must be escaped: someone could otherwise
 * name themselves `<img src=x onerror=...>` and run script inside the map
 * document.
 */
function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Builds a self-contained Leaflet map document.
 *
 * Rendered identically on web (iframe) and native (react-native-webview), so
 * the map looks and behaves the same everywhere and there's only one place
 * to change its styling.
 *
 * Tiles: CARTO "Dark Matter" — OpenStreetMap data, already dark-styled, no
 * API key required. Attribution for both OSM and CARTO is mandatory under
 * their terms and is rendered by Leaflet itself (bottom right).
 */
export function buildMapHtml(markers: MapMarker[], userLocation: { latitude: number; longitude: number } | null): string {
  // Center on the user, else the newest marker, else Munich as a neutral
  // fallback so an empty map still shows something sensible.
  const center = userLocation
    ? [userLocation.latitude, userLocation.longitude]
    : markers.length > 0
    ? [markers[0].latitude, markers[0].longitude]
    : [48.1351, 11.582];

  // JSON.stringify guards against quotes/newlines in usernames or drink
  // names breaking out of the script context.
  const markerData = JSON.stringify(
    markers.map((m) => ({
      lat: m.latitude,
      lng: m.longitude,
      color: MARKER_COLORS[m.relation],
      username: escapeHtml(m.relation === "self" ? "Du" : m.username),
      drink: escapeHtml(m.drinkName),
      time: new Date(m.timestamp).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
      isSelf: m.relation === "self",
    }))
  );

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { height: 100%; margin: 0; padding: 0; background: #020617; }
  .leaflet-container { background: #020617; font-family: -apple-system, Segoe UI, Roboto, sans-serif; }
  .leaflet-control-attribution {
    background: rgba(2,6,23,0.8) !important;
    color: #64748b !important;
    font-size: 9px !important;
  }
  .leaflet-control-attribution a { color: #22d3ee !important; }
  .leaflet-popup-content-wrapper {
    background: #0f172a; color: #fff; border: 1px solid rgba(255,255,255,0.1);
    border-radius: 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  }
  .leaflet-popup-tip { background: #0f172a; }
  .td-popup-name { font-weight: 900; font-size: 12px; margin-bottom: 2px; }
  .td-popup-drink { font-size: 11px; color: #cbd5e1; }
  .td-popup-time { font-size: 9px; color: #64748b; margin-top: 4px; }
  .td-pin {
    width: 18px; height: 18px; border-radius: 50%;
    border: 2px solid #020617; box-shadow: 0 0 0 2px currentColor, 0 0 12px currentColor;
  }
</style>
</head>
<body>
<div id="map"></div>
<script>
  var map = L.map('map', { zoomControl: false, attributionControl: true })
    .setView([${center[0]}, ${center[1]}], 14);

  L.control.zoom({ position: 'topright' }).addTo(map);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);

  var markers = ${markerData};
  var bounds = [];

  markers.forEach(function (m) {
    var icon = L.divIcon({
      className: '',
      html: '<div class="td-pin" style="background:' + m.color + '; color:' + m.color + '"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });

    L.marker([m.lat, m.lng], { icon: icon })
      .addTo(map)
      .bindPopup(
        '<div class="td-popup-name" style="color:' + m.color + '">' + m.username + '</div>' +
        '<div class="td-popup-drink">' + m.drink + '</div>' +
        '<div class="td-popup-time">' + m.time + ' Uhr</div>'
      );

    bounds.push([m.lat, m.lng]);
  });

  // Fit all pins into view when there is more than one, so you don't have to
  // hunt for friends who are further away.
  if (bounds.length > 1) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }
</script>
</body>
</html>`;
}
