/* ==================================
   ROAMX MAP ENGINE
   TomTom Orbis + MapLibre GL
================================== */

// Replace this placeholder with your full TomTom API key.
const TOMTOM_KEY = "YOUR_FULL_TOMTOM_API_KEY";

const $ = (id) => document.getElementById(id);

let userPosition = null;
let destinationPosition = null;
let destinationMarker = null;
let userMarker = null;
let trafficEnabled = false;

const DEFAULT_CENTER = [76.9558, 11.0168];

const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    sources: {
      tomtom: {
        type: "raster",
        tiles: [
          `https://a.api.tomtom.com/maps/orbis/display/raster/tile/{z}/{x}/{y}?apiVersion=2&style=street-dark&key=${TOMTOM_KEY}`,
          `https://b.api.tomtom.com/maps/orbis/display/raster/tile/{z}/{x}/{y}?apiVersion=2&style=street-dark&key=${TOMTOM_KEY}`,
          `https://c.api.tomtom.com/maps/orbis/display/raster/tile/{z}/{x}/{y}?apiVersion=2&style=street-dark&key=${TOMTOM_KEY}`,
          `https://d.api.tomtom.com/maps/orbis/display/raster/tile/{z}/{x}/{y}?apiVersion=2&style=street-dark&key=${TOMTOM_KEY}`
        ],
        tileSize: 256,
        attribution: "© TomTom"
      }
    },
    layers: [{
      id: "tomtom-base",
      type: "raster",
      source: "tomtom"
    }]
  },
  center: DEFAULT_CENTER,
  zoom: 5,
  attributionControl: true
});

map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.ScaleControl(), "bottom-right");

function showMessage(message) {
  $("message").textContent = message;
}

function validateKey() {
  if (
    !TOMTOM_KEY ||
    TOMTOM_KEY === "YOUR_FULL_TOMTOM_API_KEY"
  ) {
    showMessage("Add your TomTom API key in map.js to activate live services.");
    return false;
  }

  return true;
}

map.on("load", () => {
  showMessage("ROAMX map successfully initialized.");
});

// ==================================
// CURRENT LOCATION
// ==================================

function locateUser() {
  if (!navigator.geolocation) {
    showMessage("Your browser does not support location services.");
    return;
  }

  showMessage("Requesting your current location...");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;

      userPosition = [longitude, latitude];

      if (userMarker) userMarker.remove();

      userMarker = new maplibregl.Marker({
        color: "#27d9ed"
      })
        .setLngLat(userPosition)
        .setPopup(
          new maplibregl.Popup().setText("Your current location")
        )
        .addTo(map);

      map.flyTo({
        center: userPosition,
        zoom: 15,
        essential: true
      });

      $("locationStatus").textContent = "Location connected";
      $("locationText").textContent =
        `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

      $("originText").textContent = "Current location detected";

      $("routeBtn").disabled = !destinationPosition;

      showMessage("Your location has been detected successfully.");
    },
    (error) => {
      const messages = {
        1: "Location permission denied. Allow location access in your browser.",
        2: "Your current location is unavailable.",
        3: "Location request timed out. Please try again."
      };

      showMessage(messages[error.code] || "Unable to detect location.");
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000
    }
  );
}

$("locateBtn").addEventListener("click", locateUser);

// ==================================
// DESTINATION SEARCH
// ==================================

async function searchDestination() {
  const query = $("destination").value.trim();

  if (!query) {
    showMessage("Enter a destination first.");
    return;
  }

  if (!validateKey()) return;

  showMessage("Searching for your destination...");

  try {
    const params = new URLSearchParams({
      query,
      maxResults: "6",
      geopoliticalView: "IN"
    });

    if (userPosition) {
      params.set("position", userPosition.join(","));
    }

    const response = await fetch(
      `https://api.tomtom.com/maps/orbis/places/geocode?${params}`,
      {
        headers: {
          "TomTom-Api-Version": "2",
          "TomTom-Api-Key": TOMTOM_KEY,
          "Attributes": "results"
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Search failed (${response.status}).`);
    }

    const data = await response.json();
    const results = data.results || [];

    const container = $("searchResults");
    container.innerHTML = "";
    container.style.display = "block";

    if (!results.length) {
      container.textContent = "No matching destinations found.";
      return;
    }

    results.forEach((result) => {
      const button = document.createElement("button");
      button.className = "result-item";

      const title = document.createElement("strong");
      title.textContent = result.address?.freeformAddress || query;

      const subtitle = document.createElement("small");
      subtitle.textContent =
        result.address?.municipality ||
        result.address?.country ||
        "Location result";

      button.append(title, subtitle);

      button.addEventListener("click", () => {
        selectDestination(result);
      });

      container.appendChild(button);
    });

    showMessage(`${results.length} destinations found.`);
  } catch (error) {
    showMessage(error.message || "Destination search failed.");
  }
}

$("searchBtn").addEventListener("click", searchDestination);

$("destination").addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchDestination();
});

// ==================================
// SELECT DESTINATION
// ==================================

function selectDestination(result) {
  const position = result.position;

  if (!position) {
    showMessage("Destination coordinates are unavailable.");
    return;
  }

  destinationPosition = [
    position.lon,
    position.lat
  ];

  if (destinationMarker) destinationMarker.remove();

  destinationMarker = new maplibregl.Marker({
    color: "#8657ff"
  })
    .setLngLat(destinationPosition)
    .setPopup(
      new maplibregl.Popup().setText("Selected destination")
    )
    .addTo(map);

  $("destinationText").textContent =
    result.address?.freeformAddress || "Selected destination";

  $("searchResults").style.display = "none";
  $("routeBtn").disabled = !userPosition;

  map.flyTo({
    center: destinationPosition,
    zoom: 14
  });

  showMessage(
    userPosition
      ? "Destination selected. Calculate your route."
      : "Destination selected. Detect your location to calculate a route."
  );
}

// ==================================
// ROUTE CALCULATION
// ==================================

async function calculateRoute() {
  if (!validateKey()) return;

  if (!userPosition || !destinationPosition) {
    showMessage("Select your starting location and destination.");
    return;
  }

  $("routeBtn").disabled = true;
  showMessage("Calculating the fastest route using live traffic...");

  try {
    const response = await fetch(
      "https://api.tomtom.com/maps/orbis/routing/routes/calculate?apiVersion=3",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "TomTom-Api-Key": TOMTOM_KEY,
          "TomTom-Api-Version": "3"
        },
        body: JSON.stringify({
          origin: {
            type: "Point",
            coordinates: userPosition
          },
          destination: {
            type: "Point",
            coordinates: destinationPosition
          },
          legs: [
            {
              routeType: "fast"
            }
          ],
          traffic: "live"
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Route calculation failed (${response.status}).`);
    }

    const data = await response.json();
    const route = data.routes?.[0];

    if (!route?.path?.coordinates?.length) {
      throw new Error("No route geometry was returned.");
    }

    const coordinates = route.path.coordinates;

    if (map.getLayer("route-line")) {
      map.removeLayer("route-line");
    }

    if (map.getSource("route-source")) {
      map.removeSource("route-source");
    }

    map.addSource("route-source", {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates
        }
      }
    });

    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route-source",
      paint: {
        "line-color": "#27d9ed",
        "line-width": 5,
        "line-opacity": 0.95
      }
    });

    const bounds = coordinates.reduce(
      (bounds, coordinate) => bounds.extend(coordinate),
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
    );

    map.fitBounds(bounds, {
      padding: 75,
      maxZoom: 15,
      duration: 1000
    });

    const summary = route.summary || {};

    $("distance").textContent =
      `${(summary.lengthInMeters / 1000).toFixed(1)} km`;

    $("duration").textContent =
      `${Math.round(summary.travelTimeInSeconds / 60)} min`;

    showMessage("Your route is ready. Journey information uses live traffic.");

  } catch (error) {
    showMessage(error.message || "Unable to calculate route.");
  } finally {
    $("routeBtn").disabled = false;
  }
}

$("routeBtn").addEventListener("click", calculateRoute);

// ==================================
// LIVE TRAFFIC OVERLAY
// ==================================

$("trafficBtn").addEventListener("click", () => {
  if (!validateKey()) return;

  if (!map.isStyleLoaded()) {
    showMessage("Map is still loading. Try again shortly.");
    return;
  }

  if (!map.getSource("traffic-source")) {
    map.addSource("traffic-source", {
      type: "raster",
      tiles: [
        `https://a.api.tomtom.com/maps/orbis/traffic/flow/raster/tile/{z}/{x}/{y}?apiVersion=2&style=dark&key=${TOMTOM_KEY}`,
        `https://b.api.tomtom.com/maps/orbis/traffic/flow/raster/tile/{z}/{x}/{y}?apiVersion=2&style=dark&key=${TOMTOM_KEY}`
      ],
      tileSize: 256,
      attribution: "© TomTom Traffic"
    });

    map.addLayer({
      id: "traffic-layer",
      type: "raster",
      source: "traffic-source",
      paint: {
        "raster-opacity": 0.9
      }
    });
  }

  trafficEnabled = !trafficEnabled;

  map.setLayoutProperty(
    "traffic-layer",
    "visibility",
    trafficEnabled ? "visible" : "none"
  );

  $("trafficBtn").textContent =
    trafficEnabled ? "TRAFFIC: ON" : "TRAFFIC: OFF";

  showMessage(
    trafficEnabled
      ? "Live traffic flow overlay enabled."
      : "Traffic overlay disabled."
  );
});