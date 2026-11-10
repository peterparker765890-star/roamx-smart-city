/* ==========================================
   ROAMX — LIVE NAVIGATION ENGINE
   TomTom Orbis + MapLibre GL JS
========================================== */

// Your TomTom API key
const TOMTOM_KEY = "qW1DnHeAfDf4JyBXEDU3NkcE4XU3xQjv";

// TomTom API configuration
const TOMTOM_BASE = "https://api.tomtom.com";
const MAP_STYLE = "street-dark";

// HTML elements
const $ = (id) => document.getElementById(id);

const elements = {
    locationStatus: $("locationStatus"),
    locationText: $("locationText"),
    destination: $("destination"),
    searchBtn: $("searchBtn"),
    searchResults: $("searchResults"),
    originText: $("originText"),
    destinationText: $("destinationText"),
    routeBtn: $("routeBtn"),
    distance: $("distance"),
    duration: $("duration"),
    locateBtn: $("locateBtn"),
    message: $("message"),
    trafficBtn: $("trafficBtn")
};

// Application state
let map = null;

let userPosition = null;        // [longitude, latitude]
let destinationPosition = null; // [longitude, latitude]

let userMarker = null;
let destinationMarker = null;

let trafficEnabled = false;
let isSearching = false;
let isRouting = false;

const DEFAULT_CENTER = [76.9558, 11.0168]; // Coimbatore

const ROUTE_SOURCE = "roamx-route";
const ROUTE_LAYER = "roamx-route-line";

const TRAFFIC_SOURCE = "roamx-traffic";
const TRAFFIC_LAYER = "roamx-traffic-layer";


/* ==========================================
   GENERAL HELPERS
========================================== */

function setMessage(message, type = "normal") {
    if (!elements.message) return;

    elements.message.textContent = message;
    elements.message.dataset.type = type;
}

function setLocationStatus(title, description) {
    if (elements.locationStatus) {
        elements.locationStatus.textContent = title;
    }

    if (elements.locationText) {
        elements.locationText.textContent = description;
    }
}

function formatDistance(meters) {
    if (!Number.isFinite(meters)) return "--";

    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(1)} km`;
    }

    return `${Math.round(meters)} m`;
}

function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return "--";

    const minutes = Math.round(seconds / 60);

    if (minutes < 60) {
        return `${minutes} min`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    return remainingMinutes
        ? `${hours} hr ${remainingMinutes} min`
        : `${hours} hr`;
}

function getErrorMessage(error) {
    return error?.message || "An unexpected error occurred.";
}

async function fetchJSON(url, options = {}) {
    const response = await fetch(url, options);

    if (!response.ok) {
        let details = "";

        try {
            const data = await response.json();

            details =
                data?.detailedError?.message ||
                data?.error?.description ||
                data?.message ||
                "";
        } catch (_) {
            details = "";
        }

        throw new Error(
            details || `TomTom API error: ${response.status}`
        );
    }

    return response.json();
}


/* ==========================================
   MAP INITIALIZATION
========================================== */

function initializeMap() {
    if (typeof maplibregl === "undefined") {
        setMessage("MapLibre could not be loaded. Check your internet connection.", "error");
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
                        `${TOMTOM_BASE}/maps/orbis/display/raster/tile/{z}/{x}/{y}?apiVersion=2&style=${MAP_STYLE}&key=${TOMTOM_KEY}`
                    ],

                    tileSize: 256,

                    attribution: "© TomTom"
                }
            },

            layers: [
                {
                    id: "tomtom-base-layer",
                    type: "raster",
                    source: "tomtom-base",
                    minzoom: 0,
                    maxzoom: 22
                }
            ]
        },

        center: DEFAULT_CENTER,
        zoom: 12,
        minZoom: 3,
        maxZoom: 20,

        attributionControl: false
    });

    map.addControl(
        new maplibregl.NavigationControl({
            visualizePitch: true
        }),
        "top-right"
    );

    map.addControl(
        new maplibregl.AttributionControl({
            compact: true
        }),
        "bottom-right"
    );

    map.on("load", () => {
        setMessage("ROAMX map connected successfully.", "success");

        addRouteSource();

        if (userPosition) {
            updateUserMarker();
        }

        locateUser();
    });

    map.on("error", (event) => {
        console.error("MapLibre error:", event.error || event);
    });
}


/* ==========================================
   ROUTE SOURCE AND LAYERS
========================================== */

function addRouteSource() {
    if (!map || map.getSource(ROUTE_SOURCE)) return;

    map.addSource(ROUTE_SOURCE, {
        type: "geojson",

        data: {
            type: "FeatureCollection",
            features: []
        }
    });

    // Route outline
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

    // Main route
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
            "line-width": 5,
            "line-opacity": 1
        }
    });
}

function clearRoute() {
    if (!map || !map.getSource(ROUTE_SOURCE)) return;

    map.getSource(ROUTE_SOURCE).setData({
        type: "FeatureCollection",
        features: []
    });

    if (elements.distance) {
        elements.distance.textContent = "--";
    }

    if (elements.duration) {
        elements.duration.textContent = "--";
    }
}


/* ==========================================
   CURRENT LOCATION
========================================== */

function locateUser() {
    if (!navigator.geolocation) {
        setLocationStatus(
            "Location unavailable",
            "Your browser does not support geolocation"
        );

        setMessage("Geolocation is not supported by this browser.", "error");
        return;
    }

    setLocationStatus(
        "Connecting location...",
        "Waiting for GPS permission"
    );

    setMessage("Requesting your current location...");

    navigator.geolocation.getCurrentPosition(
        (position) => {
            userPosition = [
                position.coords.longitude,
                position.coords.latitude
            ];

            updateUserMarker();

            if (map) {
                map.flyTo({
                    center: userPosition,
                    zoom: 15,
                    essential: true
                });
            }

            setLocationStatus(
                "Location connected",
                "Your current position is available"
            );

            if (elements.originText) {
                elements.originText.textContent = "Your current location";
            }

            setMessage("Your location is ready.", "success");

            updateRouteButton();
        },

        (error) => {
            let message = "Unable to access your location.";

            if (error.code === error.PERMISSION_DENIED) {
                message = "Location permission was denied. Enable it in browser settings.";
            } else if (error.code === error.POSITION_UNAVAILABLE) {
                message = "Your current location is unavailable.";
            } else if (error.code === error.TIMEOUT) {
                message = "Location request timed out. Please try again.";
            }

            setLocationStatus("Location not connected", message);
            setMessage(message, "error");

            console.error("Geolocation error:", error);
        },

        {
            enableHighAccuracy: true,
            timeout: 15000,
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

    const markerElement = document.createElement("div");

    markerElement.style.width = "18px";
    markerElement.style.height = "18px";
    markerElement.style.borderRadius = "50%";
    markerElement.style.background = "#27d9ed";
    markerElement.style.border = "4px solid #ffffff";
    markerElement.style.boxShadow = "0 0 18px #27d9ed";

    userMarker = new maplibregl.Marker({
        element: markerElement
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
        setMessage("Enter a destination to search.", "error");
        elements.destination?.focus();
        return;
    }

    if (isSearching) return;

    isSearching = true;

    if (elements.searchBtn) {
        elements.searchBtn.disabled = true;
        elements.searchBtn.textContent = "SEARCHING...";
    }

    if (elements.searchResults) {
        elements.searchResults.innerHTML = "";
    }

    setMessage("Searching for your destination...");

    try {
        const url = new URL(
            `${TOMTOM_BASE}/maps/orbis/places/geocode`
        );

        url.searchParams.set("query", query);
        url.searchParams.set("maxResults", "6");
        url.searchParams.set("countryCodesIso2", "IN");

        const data = await fetchJSON(url.toString(), {
            headers: {
                "TomTom-Api-Key": TOMTOM_KEY,
                "TomTom-Api-Version": "2",
                "Attributes": "results"
            }
        });

        const results = data.results || [];

        if (!results.length) {
            setMessage("No matching destinations found.", "error");
            return;
        }

        displaySearchResults(results);

        setMessage(
            `${results.length} destination result(s) found.`,
            "success"
        );

    } catch (error) {
        console.error("Destination search error:", error);

        setMessage(
            `Destination search failed: ${getErrorMessage(error)}`,
            "error"
        );

    } finally {
        isSearching = false;

        if (elements.searchBtn) {
            elements.searchBtn.disabled = false;
            elements.searchBtn.textContent = "SEARCH DESTINATION →";
        }
    }
}

function displaySearchResults(results) {
    const container = elements.searchResults;

    if (!container) return;

    container.innerHTML = "";

    results.forEach((result) => {
        const coordinates = result.position?.coordinates;

        if (!coordinates || coordinates.length < 2) return;

        const [longitude, latitude] = coordinates;

        const title =
            result.address?.freeformAddress ||
            result.poi?.name ||
            result.address?.municipality ||
            "Unknown destination";

        const description =
            result.poi?.name && result.address?.freeformAddress
                ? result.address.freeformAddress
                : result.type || "Location result";

        const button = document.createElement("button");

        button.type = "button";
        button.className = "result-item";

        const titleElement = document.createElement("strong");
        titleElement.textContent = title;

        const descriptionElement = document.createElement("small");
        descriptionElement.textContent = description;

        button.appendChild(titleElement);
        button.appendChild(descriptionElement);

        button.addEventListener("click", () => {
            selectDestination(
                [longitude, latitude],
                title
            );
        });

        container.appendChild(button);
    });

    if (!container.children.length) {
        setMessage("No usable destination coordinates were returned.", "error");
    }
}


/* ==========================================
   SELECT DESTINATION
========================================== */

function selectDestination(coordinates, name) {
    destinationPosition = coordinates;

    if (elements.destinationText) {
        elements.destinationText.textContent = name;
    }

    if (elements.destination) {
        elements.destination.value = name;
    }

    if (elements.searchResults) {
        elements.searchResults.innerHTML = "";
    }

    if (destinationMarker) {
        destinationMarker.remove();
    }

    const markerElement = document.createElement("div");

    markerElement.style.width = "18px";
    markerElement.style.height = "18px";
    markerElement.style.borderRadius = "50%";
    markerElement.style.background = "#8657ff";
    markerElement.style.border = "3px solid #ffffff";
    markerElement.style.boxShadow = "0 0 18px #8657ff";

    destinationMarker = new maplibregl.Marker({
        element: markerElement
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

function updateRouteButton() {
    if (!elements.routeBtn) return;

    const ready = Boolean(userPosition && destinationPosition);

    elements.routeBtn.disabled = !ready;
}


/* ==========================================
   ROUTE CALCULATION
========================================== */

async function calculateRoute() {
    if (!userPosition) {
        setMessage("Connect your current location first.", "error");
        locateUser();
        return;
    }

    if (!destinationPosition) {
        setMessage("Select a destination first.", "error");
        return;
    }

    if (isRouting) return;

    isRouting = true;

    if (elements.routeBtn) {
        elements.routeBtn.disabled = true;
        elements.routeBtn.textContent = "CALCULATING...";
    }

    setMessage("Calculating the best route using live traffic...");

    try {
        const origin = `${userPosition[1]},${userPosition[0]}`;
        const destination = `${destinationPosition[1]},${destinationPosition[0]}`;

        const locations = `${origin}:${destination}`;

        const url = new URL(
            `${TOMTOM_BASE}/maps/orbis/routing/calculateRoute/${locations}/json`
        );

        url.searchParams.set("apiVersion", "2");
        url.searchParams.set("routeType", "fast");
        url.searchParams.set("traffic", "live");
        url.searchParams.set("travelMode", "car");
        url.searchParams.set("maxAlternatives", "2");
        url.searchParams.set("sectionType", "traffic");
        url.searchParams.set("key", TOMTOM_KEY);

        const data = await fetchJSON(url.toString(), {
            headers: {
                "TomTom-Api-Version": "2",
                "Accept": "application/json"
            }
        });

        const routes = data.routes || [];

        if (!routes.length) {
            throw new Error("No valid route was found.");
        }

        displayRoutes(routes);

        const bestRoute = routes[0];
        displayRouteInformation(bestRoute);

        setMessage(
            routes.length > 1
                ? `${routes.length} route options calculated successfully.`
                : "Your route has been calculated successfully.",
            "success"
        );

    } catch (error) {
        console.error("Route calculation error:", error);

        setMessage(
            `Route calculation failed: ${getErrorMessage(error)}`,
            "error"
        );

    } finally {
        isRouting = false;

        if (elements.routeBtn) {
            elements.routeBtn.disabled = false;
            elements.routeBtn.textContent = "CALCULATE ROUTE";
        }

        updateRouteButton();
    }
}


/* ==========================================
   ROUTE GEOMETRY
========================================== */

function getRouteCoordinates(route) {
    const coordinates = [];

    const legs = route.legs || [];

    legs.forEach((leg) => {
        const points = leg.points || [];

        points.forEach((point) => {
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

    return coordinates;
}

function displayRoutes(routes) {
    if (!map || !map.getSource(ROUTE_SOURCE)) return;

    const features = [];

    routes.forEach((route, index) => {
        const coordinates = getRouteCoordinates(route);

        if (coordinates.length < 2) return;

        features.push({
            type: "Feature",

            properties: {
                routeIndex: index,
                selected: index === 0
            },

            geometry: {
                type: "LineString",
                coordinates
            }
        });
    });

    if (!features.length) {
        throw new Error("The routing service returned no usable route geometry.");
    }

    map.getSource(ROUTE_SOURCE).setData({
        type: "FeatureCollection",
        features
    });

    // Fit the map to the main route
    const mainCoordinates = getRouteCoordinates(routes[0]);

    const bounds = new maplibregl.LngLatBounds();

    mainCoordinates.forEach((coordinate) => {
        bounds.extend(coordinate);
    });

    if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
            padding: {
                top: 80,
                bottom: 80,
                left: 60,
                right: 60
            },

            maxZoom: 16,
            duration: 1200
        });
    }
}


/* ==========================================
   ROUTE INFORMATION
========================================== */

function displayRouteInformation(route) {
    const summary = route.summary || {};

    const distance = summary.lengthInMeters;
    const duration = summary.travelTimeInSeconds;
    const delay = summary.trafficDelayInSeconds;

    if (elements.distance) {
        elements.distance.textContent = formatDistance(distance);
    }

    if (elements.duration) {
        elements.duration.textContent = formatDuration(duration);
    }

    if (Number.isFinite(delay) && delay > 0) {
        setMessage(
            `Live traffic adds approximately ${formatDuration(delay)} to this route.`,
            "success"
        );
    }
}


/* ==========================================
   LIVE TRAFFIC OVERLAY
========================================== */

function toggleTraffic() {
    if (!map || !map.isStyleLoaded()) {
        setMessage("Map is still loading. Please try again.", "error");
        return;
    }

    trafficEnabled = !trafficEnabled;

    if (trafficEnabled) {
        enableTrafficLayer();

        if (elements.trafficBtn) {
            elements.trafficBtn.textContent = "TRAFFIC: ON";
            elements.trafficBtn.classList.add("active");
        }

        setMessage("Live traffic overlay enabled.", "success");

    } else {
        disableTrafficLayer();

        if (elements.trafficBtn) {
            elements.trafficBtn.textContent = "TRAFFIC: OFF";
            elements.trafficBtn.classList.remove("active");
        }

        setMessage("Live traffic overlay disabled.");
    }
}

function enableTrafficLayer() {
    if (map.getSource(TRAFFIC_SOURCE)) return;

    map.addSource(TRAFFIC_SOURCE, {
        type: "raster",

        tiles: [
            `${TOMTOM_BASE}/maps/orbis/traffic/flow/raster/tile/{z}/{x}/{y}?apiVersion=2&style=dark&tileSize=256&key=${TOMTOM_KEY}`
        ],

        tileSize: 256,

        attribution: "© TomTom Traffic"
    });

    map.addLayer({
        id: TRAFFIC_LAYER,

        type: "raster",

        source: TRAFFIC_SOURCE,

        paint: {
            "raster-opacity": 0.85
        }
    });
}

function disableTrafficLayer() {
    if (!map) return;

    if (map.getLayer(TRAFFIC_LAYER)) {
        map.removeLayer(TRAFFIC_LAYER);
    }

    if (map.getSource(TRAFFIC_SOURCE)) {
        map.removeSource(TRAFFIC_SOURCE);
    }
}


/* ==========================================
   EVENT LISTENERS
========================================== */

if (elements.searchBtn) {
    elements.searchBtn.addEventListener("click", searchDestination);
}

if (elements.destination) {
    elements.destination.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            searchDestination();
        }
    });
}

if (elements.routeBtn) {
    elements.routeBtn.addEventListener("click", calculateRoute);
}

if (elements.locateBtn) {
    elements.locateBtn.addEventListener("click", locateUser);
}

if (elements.trafficBtn) {
    elements.trafficBtn.addEventListener("click", toggleTraffic);
}


/* ==========================================
   START ROAMX
========================================== */

document.addEventListener("DOMContentLoaded", () => {
    initializeMap();
});