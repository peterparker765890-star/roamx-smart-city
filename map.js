/* ==========================================
   ROAMX — LIVE NAVIGATION ENGINE
   TomTom Orbis + MapLibre GL
========================================== */

const TOMTOM_KEY = "qW1DnHeAfDf4JyBXEDU3NkcE4XU3xQjv";
const TOMTOM_BASE = "https://api.tomtom.com";

const $ = id => document.getElementById(id);

const elements = {
    destination: $("destination"),
    searchBtn: $("searchBtn"),
    searchResults: $("searchResults"),
    originText: $("originText"),
    destinationText: $("destinationText"),
    routeBtn: $("routeBtn"),
    distance: $("distance"),
    duration: $("duration"),
    locateBtn: $("locateBtn"),
    locationStatus: $("locationStatus"),
    locationText: $("locationText"),
    message: $("message"),
    trafficBtn: $("trafficBtn")
};

let map = null;
let userPosition = null;
let destinationPosition = null;
let userMarker = null;
let destinationMarker = null;
let trafficEnabled = false;
let searching = false;
let routing = false;

const ROUTE_SOURCE = "roamx-route";
const ROUTE_LAYER = "roamx-route-line";
const TRAFFIC_SOURCE = "roamx-traffic";
const TRAFFIC_LAYER = "roamx-traffic-layer";

const DEFAULT_CENTER = [76.9558, 11.0168];

/* ==========================================
   HELPERS
========================================== */

function setMessage(message, type = "normal") {
    if (!elements.message) return;

    elements.message.textContent = message;
    elements.message.dataset.type = type;
}

function setLocationStatus(title, description) {
    if (elements.locationStatus)
        elements.locationStatus.textContent = title;

    if (elements.locationText)
        elements.locationText.textContent = description;
}

function formatDistance(meters) {
    if (!Number.isFinite(meters)) return "--";

    return meters >= 1000
        ? `${(meters / 1000).toFixed(1)} km`
        : `${Math.round(meters)} m`;
}

function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return "--";

    const minutes = Math.round(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;

    if (hours === 0) return `${minutes} min`;

    return remaining
        ? `${hours} hr ${remaining} min`
        : `${hours} hr`;
}

async function fetchJSON(url) {
    const response = await fetch(url);

    if (!response.ok) {
        let message = `API error ${response.status}`;

        try {
            const data = await response.json();
            message =
                data?.detailedError?.message ||
                data?.error?.description ||
                data?.message ||
                message;
        } catch (_) {}

        throw new Error(message);
    }

    return response.json();
}

/* ==========================================
   MAP INITIALIZATION
========================================== */

function initializeMap() {
    if (typeof maplibregl === "undefined") {
        setMessage("MapLibre failed to load.", "error");
        return;
    }

    map = new maplibregl.Map({
        container: "map",

        style: {
            version: 8,

            sources: {
                "tomtom-base": {
                    type: "raster",

                    tiles: [
                        `${TOMTOM_BASE}/maps/orbis/display/raster/tile/{z}/{x}/{y}?apiVersion=2&style=street-dark&key=${TOMTOM_KEY}`
                    ],

                    tileSize: 256,
                    attribution: "© TomTom"
                }
            },

            layers: [{
                id: "tomtom-base-layer",
                type: "raster",
                source: "tomtom-base"
            }]
        },

        center: DEFAULT_CENTER,
        zoom: 12,
        minZoom: 3,
        maxZoom: 20,
        attributionControl: false
    });

    map.addControl(
        new maplibregl.NavigationControl(),
        "top-right"
    );

    map.addControl(
        new maplibregl.AttributionControl({
            compact: true
        }),
        "bottom-right"
    );

    map.on("load", () => {
        addRouteLayer();
        setMessage("ROAMX map connected.", "success");
        locateUser();
    });

    map.on("error", event => {
        console.error("Map error:", event.error || event);
    });
}

/* ==========================================
   ROUTE LAYER
========================================== */

function addRouteLayer() {
    if (map.getSource(ROUTE_SOURCE)) return;

    map.addSource(ROUTE_SOURCE, {
        type: "geojson",
        data: {
            type: "FeatureCollection",
            features: []
        }
    });

    map.addLayer({
        id: "roamx-route-outline",
        type: "line",
        source: ROUTE_SOURCE,
        layout: {
            "line-join": "round",
            "line-cap": "round"
        },
        paint: {
            "line-color": "#080b18",
            "line-width": 9,
            "line-opacity": 0.85
        }
    });

    map.addLayer({
        id: ROUTE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: {
            "line-join": "round",
            "line-cap": "round"
        },
        paint: {
            "line-color": "#27d9ed",
            "line-width": 5
        }
    });
}

function clearRoute() {
    if (map?.getSource(ROUTE_SOURCE)) {
        map.getSource(ROUTE_SOURCE).setData({
            type: "FeatureCollection",
            features: []
        });
    }

    if (elements.distance)
        elements.distance.textContent = "--";

    if (elements.duration)
        elements.duration.textContent = "--";
}

/* ==========================================
   CURRENT LOCATION
========================================== */

function locateUser() {
    if (!navigator.geolocation) {
        setLocationStatus(
            "Location unavailable",
            "Browser does not support GPS."
        );

        setMessage("Geolocation is not supported.", "error");
        return;
    }

    setLocationStatus(
        "Connecting location...",
        "Waiting for GPS permission"
    );

    setMessage("Requesting current location...");

    navigator.geolocation.getCurrentPosition(
        position => {
            userPosition = [
                position.coords.longitude,
                position.coords.latitude
            ];

            updateUserMarker();

            map.flyTo({
                center: userPosition,
                zoom: 15,
                essential: true
            });

            setLocationStatus(
                "Location connected",
                "Your current position is available"
            );

            if (elements.originText)
                elements.originText.textContent =
                    "Your current location";

            setMessage("Location connected successfully.", "success");

            updateRouteButton();
        },

        error => {
            let message = "Unable to access your location.";

            if (error.code === 1)
                message = "Permission denied. Allow location in browser settings.";

            if (error.code === 2)
                message = "Your current location is unavailable.";

            if (error.code === 3)
                message = "Location request timed out. Try again.";

            setLocationStatus("Location not connected", message);
            setMessage(message, "error");

            console.error(error);
        },

        {
            enableHighAccuracy: true,
            timeout: 20000,
            maximumAge: 10000
        }
    );
}

function updateUserMarker() {
    if (!map || !userPosition) return;

    if (userMarker) {
        userMarker.setLngLat(userPosition);
        return;
    }

    const marker = document.createElement("div");

    marker.style.cssText = `
        width:18px;
        height:18px;
        border-radius:50%;
        background:#27d9ed;
        border:4px solid white;
        box-shadow:0 0 18px #27d9ed;
    `;

    userMarker = new maplibregl.Marker({
        element: marker
    })
        .setLngLat(userPosition)
        .addTo(map);
}

/* ==========================================
   DESTINATION SEARCH
========================================== */

async function searchDestination() {
    const query = elements.destination?.value.trim();

    if (!query) {
        setMessage("Enter a destination first.", "error");
        elements.destination?.focus();
        return;
    }

    if (searching) return;

    searching = true;

    elements.searchBtn.disabled = true;
    elements.searchBtn.textContent = "SEARCHING...";

    elements.searchResults.innerHTML = "";
    elements.searchResults.style.display = "none";

    setMessage("Searching destinations...");

    try {
        const url = new URL(
            `${TOMTOM_BASE}/maps/orbis/places/geocode`
        );

        url.searchParams.set("key", TOMTOM_KEY);
        url.searchParams.set("query", query);
        url.searchParams.set("maxResults", "6");
        url.searchParams.set("countryCodes", "IN");

        const data = await fetchJSON(url.toString());
        const results = data.results || [];

        if (!results.length) {
            setMessage("No destinations found.", "error");
            return;
        }

        displaySearchResults(results);

        setMessage(
            `${results.length} destination result(s) found.`,
            "success"
        );

    } catch (error) {
        console.error(error);

        setMessage(
            "Search failed: " + error.message,
            "error"
        );

    } finally {
        searching = false;

        elements.searchBtn.disabled = false;
        elements.searchBtn.textContent = "SEARCH DESTINATION →";
    }
}

/* ==========================================
   SEARCH RESULTS
========================================== */

function displaySearchResults(results) {
    const container = elements.searchResults;

    if (!container) return;

    container.innerHTML = "";

    results.forEach(result => {
        const coordinates = result.position?.coordinates;

        if (!coordinates || coordinates.length < 2) return;

        const [longitude, latitude] = coordinates;

        if (
            !Number.isFinite(longitude) ||
            !Number.isFinite(latitude)
        ) return;

        const title =
            result.poi?.name ||
            result.address?.freeformAddress ||
            result.address?.municipality ||
            "Unknown destination";

        const description =
            result.address?.freeformAddress ||
            result.type ||
            "Location result";

        const button = document.createElement("button");

        button.type = "button";
        button.className = "result-item";

        const heading = document.createElement("strong");
        heading.textContent = title;

        const detail = document.createElement("small");
        detail.textContent = description;

        button.appendChild(heading);
        button.appendChild(detail);

        button.addEventListener("click", () => {
            selectDestination(
                [longitude, latitude],
                title
            );
        });

        container.appendChild(button);
    });

    // FIX: MAKE RESULTS VISIBLE.
    container.style.display =
        container.children.length > 0 ? "block" : "none";

    if (!container.children.length) {
        setMessage("No usable destination results.", "error");
    }
}

/* ==========================================
   SELECT DESTINATION
========================================== */

function selectDestination(coordinates, name) {
    destinationPosition = coordinates;

    elements.destination.value = name;

    if (elements.destinationText)
        elements.destinationText.textContent = name;

    elements.searchResults.innerHTML = "";
    elements.searchResults.style.display = "none";

    if (destinationMarker)
        destinationMarker.remove();

    const marker = document.createElement("div");

    marker.style.cssText = `
        width:18px;
        height:18px;
        border-radius:50%;
        background:#8657ff;
        border:3px solid white;
        box-shadow:0 0 18px #8657ff;
    `;

    destinationMarker = new maplibregl.Marker({
        element: marker
    })
        .setLngLat(destinationPosition)
        .addTo(map);

    map.flyTo({
        center: destinationPosition,
        zoom: 14,
        essential: true
    });

    clearRoute();
    updateRouteButton();

    setMessage("Destination selected. Calculate your route.", "success");
}

/* ==========================================
   ROUTE BUTTON
========================================== */

function updateRouteButton() {
    if (!elements.routeBtn) return;

    elements.routeBtn.disabled =
        !(userPosition && destinationPosition);
}

/* ==========================================
   CALCULATE ROUTE
========================================== */

async function calculateRoute() {
    if (!userPosition) {
        setMessage("Connect your location first.", "error");
        locateUser();
        return;
    }

    if (!destinationPosition) {
        setMessage("Select a destination first.", "error");
        return;
    }

    if (routing) return;

    routing = true;

    elements.routeBtn.disabled = true;
    elements.routeBtn.textContent = "CALCULATING...";

    setMessage("Calculating route with live traffic...");

    try {
        const origin =
            `${userPosition[1]},${userPosition[0]}`;

        const destination =
            `${destinationPosition[1]},${destinationPosition[0]}`;

        const url = new URL(
            `${TOMTOM_BASE}/maps/orbis/routing/calculateRoute/${origin}:${destination}/json`
        );

        url.searchParams.set("key", TOMTOM_KEY);
        url.searchParams.set("apiVersion", "2");
        url.searchParams.set("routeType", "fast");
        url.searchParams.set("traffic", "live");
        url.searchParams.set("travelMode", "car");
        url.searchParams.set("maxAlternatives", "2");

        const data = await fetchJSON(url.toString());

        if (!data.routes?.length)
            throw new Error("No route returned.");

        displayRoutes(data.routes);

        const route = data.routes[0];
        const summary = route.summary || {};

        elements.distance.textContent =
            formatDistance(summary.lengthInMeters);

        elements.duration.textContent =
            formatDuration(summary.travelTimeInSeconds);

        setMessage(
            "Your route has been calculated successfully.",
            "success"
        );

    } catch (error) {
        console.error(error);

        setMessage(
            "Route calculation failed: " + error.message,
            "error"
        );

    } finally {
        routing = false;

        elements.routeBtn.textContent = "CALCULATE ROUTE";
        updateRouteButton();
    }
}

/* ==========================================
   DISPLAY ROUTE
========================================== */

function displayRoutes(routes) {
    const features = [];

    routes.forEach((route, index) => {
        const coordinates = [];

        (route.legs || []).forEach(leg => {
            (leg.points || []).forEach(point => {
                if (
                    Number.isFinite(point.longitude) &&
                    Number.isFinite(point.latitude)
                ) {
                    coordinates.push([
                        point.longitude,
                        point.latitude
                    ]);
                }
            });
        });

        if (coordinates.length < 2) return;

        features.push({
            type: "Feature",
            properties: {
                routeIndex: index
            },
            geometry: {
                type: "LineString",
                coordinates
            }
        });
    });

    if (!features.length)
        throw new Error("Route geometry is unavailable.");

    map.getSource(ROUTE_SOURCE).setData({
        type: "FeatureCollection",
        features
    });

    const bounds = new maplibregl.LngLatBounds();

    features[0].geometry.coordinates.forEach(point => {
        bounds.extend(point);
    });

    map.fitBounds(bounds, {
        padding: 70,
        maxZoom: 16,
        duration: 1200
    });
}

/* ==========================================
   TRAFFIC OVERLAY
========================================== */

function toggleTraffic() {
    if (!map || !map.isStyleLoaded()) {
        setMessage("Map is still loading.", "error");
        return;
    }

    if (!trafficEnabled) {
        try {
            enableTrafficLayer();

            trafficEnabled = true;

            elements.trafficBtn.textContent = "TRAFFIC: ON";
            elements.trafficBtn.classList.add("active");

            setMessage("Traffic overlay enabled.", "success");

        } catch (error) {
            console.error(error);
            setMessage(error.message, "error");
        }

    } else {
        disableTrafficLayer();

        trafficEnabled = false;

        elements.trafficBtn.textContent = "TRAFFIC: OFF";
        elements.trafficBtn.classList.remove("active");

        setMessage("Traffic overlay disabled.");
    }
}

function enableTrafficLayer() {
    if (!map.getSource(TRAFFIC_SOURCE)) {
        map.addSource(TRAFFIC_SOURCE, {
            type: "raster",

            tiles: [
                `${TOMTOM_BASE}/maps/orbis/traffic/flow/raster/tile/{z}/{x}/{y}?apiVersion=2&style=dark&tileSize=256&key=${TOMTOM_KEY}`
            ],

            tileSize: 256,
            attribution: "© TomTom Traffic"
        });
    }

    if (!map.getLayer(TRAFFIC_LAYER)) {
        map.addLayer({
            id: TRAFFIC_LAYER,
            type: "raster",
            source: TRAFFIC_SOURCE,

            paint: {
                "raster-opacity": 0.85
            }
        });
    }
}

function disableTrafficLayer() {
    if (map.getLayer(TRAFFIC_LAYER))
        map.removeLayer(TRAFFIC_LAYER);

    if (map.getSource(TRAFFIC_SOURCE))
        map.removeSource(TRAFFIC_SOURCE);
}

/* ==========================================
   EVENT LISTENERS
========================================== */

elements.searchBtn?.addEventListener(
    "click",
    searchDestination
);

elements.destination?.addEventListener(
    "keydown",
    event => {
        if (event.key === "Enter") {
            event.preventDefault();
            searchDestination();
        }
    }
);

elements.routeBtn?.addEventListener(
    "click",
    calculateRoute
);

elements.locateBtn?.addEventListener(
    "click",
    locateUser
);

elements.trafficBtn?.addEventListener(
    "click",
    toggleTraffic
);

/* ==========================================
   START ROAMX
========================================== */

initializeMap();