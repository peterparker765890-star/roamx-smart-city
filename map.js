/* =====================================================
   ROAMX — COMPLETE LIVE NAVIGATION ENGINE
   TomTom Orbis Maps v2 + MapLibre GL JS
   Search | GPS | Routing | Traffic
===================================================== */

/* TOMTOM CONFIGURATION */
const TOMTOM_KEY = "qW1DnHeAfDf4JyBXEDU3NkcE4XU3xQjv";
const TOMTOM_BASE = "https://api.tomtom.com";

/* DEFAULT MAP LOCATION */
const DEFAULT_CENTER = [76.9558, 11.0168];

/* HTML ELEMENTS */
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

/* APPLICATION STATE */
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


/* =====================================================
   1. GENERAL HELPERS
===================================================== */

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
        return (meters / 1000).toFixed(1) + " km";
    }

    return Math.round(meters) + " m";
}

function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return "--";

    const minutes = Math.round(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;

    if (hours === 0) {
        return minutes + " min";
    }

    return remaining > 0
        ? `${hours} hr ${remaining} min`
        : `${hours} hr`;
}

function clearSearchResults() {
    if (!elements.searchResults) return;

    elements.searchResults.innerHTML = "";
    elements.searchResults.style.display = "none";
}

function clearRoute() {
    if (map && map.getSource(ROUTE_SOURCE)) {
        map.getSource(ROUTE_SOURCE).setData({
            type: "FeatureCollection",
            features: []
        });
    }

    if (elements.distance) {
        elements.distance.textContent = "--";
    }

    if (elements.duration) {
        elements.duration.textContent = "--";
    }
}

async function fetchJSON(url, options = {}) {
    const response = await fetch(url, options);

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const error =
            data?.detailedError?.message ||
            data?.error?.description ||
            data?.message ||
            `TomTom API error: ${response.status}`;

        throw new Error(error);
    }

    return data;
}


/* =====================================================
   2. MAP INITIALIZATION
===================================================== */

function initializeMap() {

    if (typeof maplibregl === "undefined") {
        setMessage(
            "MapLibre library is missing. Check map.html.",
            "error"
        );
        return;
    }

    if (!elements.destination || !elements.searchBtn ||
        !elements.searchResults || !elements.routeBtn) {

        console.error("ROAMX: Required HTML elements are missing.");

        setMessage(
            "Some map controls are missing from map.html.",
            "error"
        );

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
                        `${TOMTOM_BASE}/maps/orbis/display/raster/tile/{z}/{x}/{y}?apiVersion=2&style=street-dark&key=${encodeURIComponent(TOMTOM_KEY)}`
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

        console.log("ROAMX map initialized.");

        addRouteLayer();

        setMessage(
            "ROAMX map connected successfully.",
            "success"
        );

        locateUser();
    });

    map.on("error", event => {
        console.error("ROAMX Map Error:", event.error || event);
    });
}


/* =====================================================
   3. ROUTE LAYER
===================================================== */

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
            "line-width": 10,
            "line-opacity": 0.9
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
            "line-width": 5,
            "line-opacity": 1
        }
    });
}


/* =====================================================
   4. CURRENT LOCATION / GPS
===================================================== */

function locateUser() {

    if (!navigator.geolocation) {

        setLocationStatus(
            "Location unavailable",
            "Your browser does not support GPS."
        );

        setMessage(
            "Geolocation is not supported.",
            "error"
        );

        return;
    }

    setLocationStatus(
        "Connecting location...",
        "Waiting for GPS permission"
    );

    setMessage("Requesting your current location...");

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

            if (elements.originText) {
                elements.originText.textContent =
                    "Your current location";
            }

            setMessage(
                "Your location is ready.",
                "success"
            );

            updateRouteButton();
        },

        error => {

            let message =
                "Unable to access your location.";

            if (error.code === 1) {
                message =
                    "Location permission denied. Allow location in browser settings.";
            }

            if (error.code === 2) {
                message =
                    "Your current location is unavailable.";
            }

            if (error.code === 3) {
                message =
                    "Location request timed out. Try again.";
            }

            setLocationStatus(
                "Location not connected",
                message
            );

            setMessage(message, "error");

            console.error("GPS Error:", error);
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


/* =====================================================
   5. TOMTOM ORBIS DESTINATION SEARCH
===================================================== */

async function searchDestination() {

    const query = elements.destination.value.trim();

    if (!query) {

        setMessage(
            "Enter a destination first.",
            "error"
        );

        elements.destination.focus();

        return;
    }

    if (searching) return;

    searching = true;

    elements.searchBtn.disabled = true;
    elements.searchBtn.textContent = "SEARCHING...";

    clearSearchResults();

    setMessage("Searching destinations...");

    try {

        const url = new URL(
            `${TOMTOM_BASE}/maps/orbis/places/geocode`
        );

        url.searchParams.set("query", query);
        url.searchParams.set("maxResults", "6");
        url.searchParams.set("countryCodesIso2", "IN");

        const data = await fetchJSON(url.toString(), {

            method: "GET",

            headers: {
                "TomTom-Api-Key": TOMTOM_KEY,
                "TomTom-Api-Version": "2",
                "Attributes": "results(title,position,address)",
                "Accept": "application/json"
            }
        });

        const results = data.results || [];

        if (!results.length) {

            setMessage(
                "No destinations found. Try another search.",
                "error"
            );

            return;
        }

        displaySearchResults(results);

        setMessage(
            `${results.length} destination result(s) found.`,
            "success"
        );

    } catch (error) {

        console.error("ROAMX Search Error:", error);

        setMessage(
            "Search failed: " + error.message,
            "error"
        );

    } finally {

        searching = false;

        elements.searchBtn.disabled = false;

        elements.searchBtn.textContent =
            "SEARCH DESTINATION →";
    }
}


/* =====================================================
   6. DISPLAY DESTINATION RESULTS
===================================================== */

function displaySearchResults(results) {

    const container = elements.searchResults;

    if (!container) return;

    container.innerHTML = "";

    results.forEach(result => {

        const coordinates =
            result.position?.coordinates;

        if (!coordinates || coordinates.length < 2) {
            return;
        }

        const longitude = coordinates[0];
        const latitude = coordinates[1];

        if (
            !Number.isFinite(longitude) ||
            !Number.isFinite(latitude)
        ) {
            return;
        }

        const title =
            result.title ||
            result.address?.municipality ||
            "Unknown destination";

        const address = result.address || {};

        const description = [
            address.street,
            address.municipality,
            address.countrySubdivision,
            address.country
        ].filter(Boolean).join(", ") ||
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

    /* IMPORTANT: SHOW THE RESULTS */

    container.style.display =
        container.children.length > 0
            ? "block"
            : "none";

    if (!container.children.length) {

        setMessage(
            "No valid destination coordinates found.",
            "error"
        );
    }
}


/* =====================================================
   7. SELECT DESTINATION
===================================================== */

function selectDestination(coordinates, name) {

    destinationPosition = coordinates;

    elements.destination.value = name;

    if (elements.destinationText) {
        elements.destinationText.textContent = name;
    }

    clearSearchResults();

    if (destinationMarker) {
        destinationMarker.remove();
    }

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

    setMessage(
        "Destination selected. Calculate your route.",
        "success"
    );
}


/* =====================================================
   8. ROUTE BUTTON STATE
===================================================== */

function updateRouteButton() {

    if (!elements.routeBtn) return;

    elements.routeBtn.disabled =
        !(userPosition && destinationPosition);
}


/* =====================================================
   9. TOMTOM ORBIS ROUTING API
===================================================== */

async function calculateRoute() {

    if (!userPosition) {

        setMessage(
            "Connect your current location first.",
            "error"
        );

        locateUser();

        return;
    }

    if (!destinationPosition) {

        setMessage(
            "Select a destination first.",
            "error"
        );

        return;
    }

    if (routing) return;

    routing = true;

    elements.routeBtn.disabled = true;

    elements.routeBtn.textContent =
        "CALCULATING...";

    setMessage(
        "Calculating your route using live traffic..."
    );

    try {

        const origin =
            `${userPosition[1]},${userPosition[0]}`;

        const destination =
            `${destinationPosition[1]},${destinationPosition[0]}`;

        const url = new URL(
            `${TOMTOM_BASE}/maps/orbis/routing/calculateRoute/${origin}:${destination}/json`
        );

        url.searchParams.set("apiVersion", "2");
        url.searchParams.set("key", TOMTOM_KEY);
        url.searchParams.set("routeType", "fast");
        url.searchParams.set("traffic", "live");
        url.searchParams.set("travelMode", "car");
        url.searchParams.set("routeRepresentation", "polyline");
        url.searchParams.set("sectionType", "traffic");

        const data = await fetchJSON(url.toString());

        if (!data.routes || !data.routes.length) {

            throw new Error(
                "TomTom did not return a route."
            );
        }

        displayRoutes(data.routes);

        const route = data.routes[0];

        const summary = route.summary || {};

        if (
            !Number.isFinite(summary.lengthInMeters) ||
            !Number.isFinite(summary.travelTimeInSeconds)
        ) {
            throw new Error(
                "Route distance or travel time is missing."
            );
        }

        if (elements.distance) {
            elements.distance.textContent =
                formatDistance(summary.lengthInMeters);
        }

        if (elements.duration) {
            elements.duration.textContent =
                formatDuration(summary.travelTimeInSeconds);
        }

        const delay =
            summary.trafficDelayInSeconds || 0;

        setMessage(
            delay > 0
                ? `Route ready. Traffic delay: ${formatDuration(delay)}.`
                : "Your route has been calculated successfully.",
            "success"
        );

    } catch (error) {

        console.error("ROAMX Routing Error:", error);

        setMessage(
            "Route calculation failed: " + error.message,
            "error"
        );

    } finally {

        routing = false;

        elements.routeBtn.textContent =
            "CALCULATE ROUTE";

        updateRouteButton();
    }
}


/* =====================================================
   10. DRAW ROUTE ON MAP
===================================================== */

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

    if (!features.length) {

        throw new Error(
            "TomTom returned no usable route geometry."
        );
    }

    map.getSource(ROUTE_SOURCE).setData({

        type: "FeatureCollection",

        features
    });

    const bounds = new maplibregl.LngLatBounds();

    features[0].geometry.coordinates.forEach(point => {
        bounds.extend(point);
    });

    map.fitBounds(bounds, {

        padding: {
            top: 90,
            bottom: 90,
            left: 60,
            right: 60
        },

        maxZoom: 16,
        duration: 1200
    });
}


/* =====================================================
   11. LIVE TRAFFIC OVERLAY
===================================================== */

function toggleTraffic() {

    if (!map || !map.isStyleLoaded()) {

        setMessage(
            "Map is still loading.",
            "error"
        );

        return;
    }

    if (!trafficEnabled) {

        try {

            enableTrafficLayer();

            trafficEnabled = true;

            if (elements.trafficBtn) {

                elements.trafficBtn.textContent =
                    "TRAFFIC: ON";

                elements.trafficBtn.classList.add("active");
            }

            setMessage(
                "Live traffic overlay enabled.",
                "success"
            );

        } catch (error) {

            console.error("Traffic Error:", error);

            setMessage(
                "Traffic error: " + error.message,
                "error"
            );
        }

    } else {

        disableTrafficLayer();

        trafficEnabled = false;

        if (elements.trafficBtn) {

            elements.trafficBtn.textContent =
                "TRAFFIC: OFF";

            elements.trafficBtn.classList.remove("active");
        }

        setMessage(
            "Traffic overlay disabled.",
            "success"
        );
    }
}


/* =====================================================
   12. ADD TRAFFIC TILES
===================================================== */

function enableTrafficLayer() {

    if (!map.getSource(TRAFFIC_SOURCE)) {

        map.addSource(TRAFFIC_SOURCE, {

            type: "raster",

            tiles: [
                `${TOMTOM_BASE}/maps/orbis/traffic/flow/raster/tile/{z}/{x}/{y}?apiVersion=2&style=dark&tileSize=256&key=${encodeURIComponent(TOMTOM_KEY)}`
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


/* =====================================================
   13. REMOVE TRAFFIC TILES
===================================================== */

function disableTrafficLayer() {

    if (map.getLayer(TRAFFIC_LAYER)) {
        map.removeLayer(TRAFFIC_LAYER);
    }

    if (map.getSource(TRAFFIC_SOURCE)) {
        map.removeSource(TRAFFIC_SOURCE);
    }
}


/* =====================================================
   14. EVENT LISTENERS
===================================================== */

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


/* =====================================================
   15. START ROAMX
===================================================== */

initializeMap();

console.log(
    "%cROAMX LIVE NAVIGATION INITIALIZED",
    "color:#27d9ed;font-size:16px;font-weight:bold;"
);