/* =========================================================
   ROAMX — LIVE NAVIGATION ENGINE
   TomTom Orbis v2 + MapLibre GL JS

   SEARCH | GPS | ROUTING | TRAFFIC
   START NAVIGATION | LIVE TRACKING | AUTO REROUTING
   REMAINING DISTANCE | ETA | ARRIVAL DETECTION
========================================================= */

/* TOMTOM CONFIGURATION */
const TOMTOM_KEY = "qW1DnHeAfDf4JyBXEDU3NkcE4XU3xQjv";
const TOMTOM_BASE = "https://api.tomtom.com";
const TOMTOM_VERSION = "2";

const DEFAULT_CENTER = [76.9558, 11.0168];

const $ = id => document.getElementById(id);

/* HTML ELEMENTS */
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

/* MAP STATE */
let map = null;

let userPosition = null;
let destinationPosition = null;

let userMarker = null;
let destinationMarker = null;

let trafficEnabled = false;
let searching = false;
let routing = false;

let searchController = null;

/* NAVIGATION STATE */
let navigationActive = false;
let navigationWatchId = null;

let routeCoordinates = [];
let routeSummary = null;

let offRouteCount = 0;
let arrivalCount = 0;

let lastRerouteTime = 0;
let rerouting = false;

let lastGPSUpdate = 0;

const OFF_ROUTE_DISTANCE = 65;
const OFF_ROUTE_CONFIRMATIONS = 3;
const REROUTE_COOLDOWN = 20000;

const ARRIVAL_DISTANCE = 35;
const ARRIVAL_CONFIRMATIONS = 2;

const ROUTE_SOURCE = "roamx-route";
const ROUTE_LAYER = "roamx-route-line";
const ROUTE_OUTLINE = "roamx-route-outline";

const TRAFFIC_SOURCE = "roamx-traffic";
const TRAFFIC_LAYER = "roamx-traffic-layer";

/* =========================================================
   GENERAL HELPERS
========================================================= */

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

    const minutes = Math.max(0, Math.round(seconds / 60));

    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;

    if (hours === 0) return minutes + " min";

    return remaining > 0
        ? `${hours} hr ${remaining} min`
        : `${hours} hr`;
}

function formatETA(seconds) {
    const arrival = new Date(Date.now() + seconds * 1000);

    return arrival.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function isValidCoordinates(longitude, latitude) {
    return (
        Number.isFinite(longitude) &&
        Number.isFinite(latitude) &&
        longitude >= -180 &&
        longitude <= 180 &&
        latitude >= -90 &&
        latitude <= 90
    );
}

function clearSearchResults() {
    if (!elements.searchResults) return;

    elements.searchResults.innerHTML = "";
    elements.searchResults.style.display = "none";
}

function getTomTomHeaders() {
    return {
        "TomTom-Api-Key": TOMTOM_KEY,
        "TomTom-Api-Version": TOMTOM_VERSION,
        "Accept": "application/json"
    };
}

async function fetchJSON(url, options = {}) {
    const response = await fetch(url, options);

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        console.error("TomTom API response:", data);

        throw new Error(
            data?.detailedError?.message ||
            data?.error?.description ||
            data?.errorText ||
            data?.message ||
            `TomTom API error: ${response.status}`
        );
    }

    return data;
}

function haversineDistance(pointA, pointB) {
    const toRadians = degrees => degrees * Math.PI / 180;

    const lat1 = toRadians(pointA[1]);
    const lat2 = toRadians(pointB[1]);

    const deltaLat = toRadians(pointB[1] - pointA[1]);
    const deltaLon = toRadians(pointB[0] - pointA[0]);

    const a =
        Math.sin(deltaLat / 2) ** 2 +
        Math.cos(lat1) *
        Math.cos(lat2) *
        Math.sin(deltaLon / 2) ** 2;

    return 6371000 * 2 * Math.atan2(
        Math.sqrt(a),
        Math.sqrt(1 - a)
    );
}

function calculatePolylineLength(points) {
    let total = 0;

    for (let i = 1; i < points.length; i++) {
        total += haversineDistance(points[i - 1], points[i]);
    }

    return total;
}

/* =========================================================
   NAVIGATION INTERFACE
   Created automatically. No HTML changes required.
========================================================= */

function createNavigationInterface() {
    if (document.getElementById("roamxNavigationPanel")) return;

    const panel = document.createElement("div");

    panel.id = "roamxNavigationPanel";

    panel.style.cssText = `
        margin-top:18px;
        padding:18px;
        border:1px solid rgba(39,217,237,0.25);
        border-radius:14px;
        background:#101629;
        color:#ffffff;
        font-family:inherit;
        display:none;
    `;

    panel.innerHTML = `
        <div style="
            font-size:11px;
            letter-spacing:2px;
            color:#27d9ed;
            margin-bottom:12px;
        ">
            ROAMX / ACTIVE NAVIGATION
        </div>

        <div id="roamxNavStatus" style="
            font-size:17px;
            font-weight:700;
            margin-bottom:14px;
        ">
            Route ready
        </div>

        <div style="
            display:grid;
            grid-template-columns:1fr 1fr;
            gap:12px;
            margin-bottom:15px;
        ">
            <div style="
                background:#19233a;
                padding:12px;
                border-radius:9px;
            ">
                <div style="font-size:10px;color:#9baac5;">
                    REMAINING DISTANCE
                </div>
                <div id="roamxRemainingDistance" style="
                    font-size:20px;
                    font-weight:700;
                    margin-top:5px;
                ">--</div>
            </div>

            <div style="
                background:#19233a;
                padding:12px;
                border-radius:9px;
            ">
                <div style="font-size:10px;color:#9baac5;">
                    ARRIVAL ESTIMATE
                </div>
                <div id="roamxETA" style="
                    font-size:20px;
                    font-weight:700;
                    margin-top:5px;
                ">--</div>
            </div>
        </div>

        <div id="roamxNavigationMessage" style="
            font-size:12px;
            color:#aab8d0;
            margin-bottom:14px;
        ">
            Your journey is ready to begin.
        </div>

        <div style="
            display:flex;
            gap:10px;
            flex-wrap:wrap;
        ">
            <button id="roamxStartButton" type="button" style="
                flex:1;
                min-width:130px;
                padding:13px;
                background:#27d9ed;
                color:#07111d;
                border:0;
                border-radius:8px;
                font-weight:800;
                cursor:pointer;
            ">
                START NAVIGATION
            </button>

            <button id="roamxEndButton" type="button" style="
                flex:1;
                min-width:130px;
                padding:13px;
                background:#29334a;
                color:white;
                border:1px solid #46536e;
                border-radius:8px;
                font-weight:700;
                cursor:pointer;
                display:none;
            ">
                END NAVIGATION
            </button>
        </div>
    `;

    if (elements.routeBtn) {
        elements.routeBtn.insertAdjacentElement("afterend", panel);
    } else {
        document.getElementById("map")?.insertAdjacentElement(
            "afterend",
            panel
        );
    }

    $("roamxStartButton")?.addEventListener(
        "click",
        startNavigation
    );

    $("roamxEndButton")?.addEventListener(
        "click",
        stopNavigation
    );
}

function updateNavigationInterface(status, message) {
    const statusElement = $("roamxNavStatus");
    const messageElement = $("roamxNavigationMessage");

    if (statusElement) {
        statusElement.textContent = status;
    }

    if (messageElement) {
        messageElement.textContent = message;
    }
}

function showNavigationPanel() {
    const panel = $("roamxNavigationPanel");

    if (panel) panel.style.display = "block";
}

function updateNavigationButtons() {
    const startButton = $("roamxStartButton");
    const endButton = $("roamxEndButton");

    if (startButton) {
        startButton.style.display =
            navigationActive ? "none" : "block";
    }

    if (endButton) {
        endButton.style.display =
            navigationActive ? "block" : "none";
    }
}

function updateProgressDisplay(remainingDistance, remainingSeconds) {
    const distanceElement = $("roamxRemainingDistance");
    const etaElement = $("roamxETA");

    if (distanceElement) {
        distanceElement.textContent =
            formatDistance(remainingDistance);
    }

    if (etaElement) {
        etaElement.textContent =
            formatETA(remainingSeconds);
    }

    if (elements.distance) {
        elements.distance.textContent =
            formatDistance(remainingDistance);
    }

    if (elements.duration) {
        elements.duration.textContent =
            formatDuration(remainingSeconds);
    }
}

/* =========================================================
   MAP INITIALIZATION
========================================================= */

function initializeMap() {
    if (typeof maplibregl === "undefined") {
        setMessage(
            "MapLibre library is missing. Check map.html.",
            "error"
        );
        return;
    }

    if (!document.getElementById("map")) {
        setMessage("Map container is missing from map.html.", "error");
        return;
    }

    if (
        !elements.destination ||
        !elements.searchBtn ||
        !elements.searchResults ||
        !elements.routeBtn
    ) {
        setMessage(
            "Some map controls are missing from map.html.",
            "error"
        );
        return;
    }

    createNavigationInterface();

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
        addRouteLayer();

        setMessage(
            "ROAMX map connected successfully.",
            "success"
        );

        locateUser();
    });

    map.on("error", event => {
        console.error(
            "ROAMX Map Error:",
            event.error || event
        );
    });
}

/* =========================================================
   ROUTE LAYER
========================================================= */

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
        id: ROUTE_OUTLINE,
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

function clearRoute() {
    routeCoordinates = [];
    routeSummary = null;

    const source = map?.getSource(ROUTE_SOURCE);

    if (source) {
        source.setData({
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

    const panel = $("roamxNavigationPanel");

    if (panel) panel.style.display = "none";
}

/* =========================================================
   GPS LOCATION
========================================================= */

function handleGPSPosition(position) {
    const longitude = position.coords.longitude;
    const latitude = position.coords.latitude;

    if (!isValidCoordinates(longitude, latitude)) return;

    // Ignore very inaccurate readings.
    if (position.coords.accuracy > 100) {
        console.warn(
            "ROAMX: GPS accuracy too low:",
            position.coords.accuracy
        );
        return;
    }

    userPosition = [longitude, latitude];

    updateUserMarker();

    setLocationStatus(
        "Location connected",
        `GPS accuracy: approximately ${Math.round(position.coords.accuracy)} m`
    );

    if (elements.originText) {
        elements.originText.textContent = "Your current location";
    }

    updateRouteButton();

    if (navigationActive) {
        processNavigationUpdate(position);
    }
}

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
            handleGPSPosition(position);

            if (!navigationActive && userPosition) {
                map.flyTo({
                    center: userPosition,
                    zoom: 15,
                    essential: true
                });
            }

            setMessage(
                "Your location is ready.",
                "success"
            );
        },

        error => {
            const message = getGPSErrorMessage(error);

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

function getGPSErrorMessage(error) {
    if (error.code === 1) {
        return "Location permission denied. Allow location in browser settings.";
    }

    if (error.code === 2) {
        return "Your current location is unavailable.";
    }

    if (error.code === 3) {
        return "Location request timed out. Try again.";
    }

    return "Unable to access your location.";
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

/* =========================================================
   DESTINATION SEARCH
========================================================= */

async function searchDestination() {
    const query = elements.destination.value.trim();

    if (!query) {
        setMessage("Enter a destination first.", "error");
        elements.destination.focus();
        return;
    }

    if (searching) return;

    searching = true;

    elements.searchBtn.disabled = true;
    elements.searchBtn.textContent = "SEARCHING...";

    clearSearchResults();

    setMessage("Searching destinations...");

    if (searchController) {
        searchController.abort();
    }

    searchController = new AbortController();

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
                ...getTomTomHeaders(),
                "Attributes": "results(title,position,address)"
            },

            signal: searchController.signal
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

        if (!elements.searchResults.children.length) {
            setMessage(
                "No valid destination coordinates found.",
                "error"
            );
            return;
        }

        setMessage(
            `${elements.searchResults.children.length} destination result(s) found.`,
            "success"
        );

    } catch (error) {
        if (error.name === "AbortError") return;

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

        searchController = null;
    }
}

/* =========================================================
   SEARCH RESULTS
========================================================= */

function displaySearchResults(results) {
    const container = elements.searchResults;

    container.innerHTML = "";

    results.forEach(result => {
        const coordinates = result.position?.coordinates;

        if (!coordinates || coordinates.length < 2) return;

        const longitude = Number(coordinates[0]);
        const latitude = Number(coordinates[1]);

        if (!isValidCoordinates(longitude, latitude)) return;

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
        ].filter(Boolean).join(", ") || "Location result";

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

    container.style.display =
        container.children.length > 0 ? "block" : "none";
}

/* =========================================================
   SELECT DESTINATION
========================================================= */

function selectDestination(coordinates, name) {
    if (navigationActive) {
        stopNavigation();
    }

    destinationPosition = coordinates;

    elements.destination.value = name;

    if (elements.destinationText) {
        elements.destinationText.textContent = name;
    }

    clearSearchResults();
    clearRoute();

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

    updateRouteButton();

    setMessage(
        "Destination selected. Calculate your route.",
        "success"
    );
}

/* =========================================================
   ROUTE BUTTON
========================================================= */

function updateRouteButton() {
    if (!elements.routeBtn) return;

    elements.routeBtn.disabled =
        !(userPosition && destinationPosition);
}

/* =========================================================
   TOMTOM ROUTE REQUEST
========================================================= */

async function requestTomTomRoute(origin, destination) {
    const originString =
        `${origin[1]},${origin[0]}`;

    const destinationString =
        `${destination[1]},${destination[0]}`;

    const url = new URL(
        `${TOMTOM_BASE}/maps/orbis/routing/calculateRoute/${originString}:${destinationString}/json`
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
        throw new Error("TomTom did not return a route.");
    }

    return data;
}

/* =========================================================
   ROUTE CALCULATION
========================================================= */

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
        setMessage("Select a destination first.", "error");
        return;
    }

    if (routing || navigationActive) return;

    routing = true;

    elements.routeBtn.disabled = true;
    elements.routeBtn.textContent = "CALCULATING...";

    setMessage(
        "Calculating your route using live traffic..."
    );

    try {
        const data = await requestTomTomRoute(
            userPosition,
            destinationPosition
        );

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

        routeSummary = summary;

        displayRoutes(data.routes);

        updateProgressDisplay(
            summary.lengthInMeters,
            summary.travelTimeInSeconds
        );

        showNavigationPanel();

        updateNavigationInterface(
            "Route ready",
            "Your route is ready. Press START NAVIGATION when you are ready to travel."
        );

        updateNavigationButtons();

        const delay = summary.trafficDelayInSeconds || 0;

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

/* =========================================================
   DRAW ROUTE
========================================================= */

function displayRoutes(routes) {
    const features = [];

    let primaryCoordinates = [];

    routes.forEach((route, index) => {
        const coordinates = [];

        (route.legs || []).forEach(leg => {
            (leg.points || []).forEach(point => {
                const longitude = Number(point.longitude);
                const latitude = Number(point.latitude);

                if (
                    isValidCoordinates(longitude, latitude)
                ) {
                    coordinates.push([
                        longitude,
                        latitude
                    ]);
                }
            });
        });

        if (coordinates.length < 2) return;

        if (index === 0) {
            primaryCoordinates = coordinates;
        }

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

    if (!features.length || primaryCoordinates.length < 2) {
        throw new Error(
            "TomTom returned no usable route geometry."
        );
    }

    routeCoordinates = primaryCoordinates;

    const source = map.getSource(ROUTE_SOURCE);

    if (!source) {
        throw new Error(
            "Route map layer is not ready."
        );
    }

    source.setData({
        type: "FeatureCollection",
        features
    });

    const bounds = new maplibregl.LngLatBounds();

    routeCoordinates.forEach(point => {
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

/* =========================================================
   START NAVIGATION
========================================================= */

function startNavigation() {
    if (navigationActive) return;

    if (!destinationPosition || routeCoordinates.length < 2) {
        setMessage(
            "Calculate a route before starting navigation.",
            "error"
        );
        return;
    }

    if (!navigator.geolocation) {
        setMessage(
            "Your browser does not support GPS navigation.",
            "error"
        );
        return;
    }

    if (!window.isSecureContext) {
        setMessage(
            "GPS navigation requires HTTPS. Open ROAMX using its GitHub Pages HTTPS address.",
            "error"
        );
        return;
    }

    navigationActive = true;

    offRouteCount = 0;
    arrivalCount = 0;

    updateNavigationButtons();

    updateNavigationInterface(
        "Navigation active",
        "ROAMX is tracking your journey. Keep GPS enabled."
    );

    setLocationStatus(
        "Navigation active",
        "Continuously tracking your current position"
    );

    setMessage(
        "Navigation started. Travel safely.",
        "success"
    );

    if (elements.locateBtn) {
        elements.locateBtn.disabled = true;
    }

    navigationWatchId = navigator.geolocation.watchPosition(
        handleGPSPosition,
        handleNavigationGPSError,
        {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 20000
        }
    );

    if (userPosition) {
        map.easeTo({
            center: userPosition,
            zoom: 17,
            duration: 1000
        });
    }
}

/* =========================================================
   NAVIGATION GPS ERRORS
========================================================= */

function handleNavigationGPSError(error) {
    console.error("Navigation GPS Error:", error);

    const message = getGPSErrorMessage(error);

    setLocationStatus(
        "GPS signal problem",
        message
    );

    updateNavigationInterface(
        "GPS signal interrupted",
        message + " Navigation will continue when GPS becomes available."
    );

    setMessage(message, "error");
}

/* =========================================================
   LIVE NAVIGATION UPDATE
========================================================= */

function processNavigationUpdate(position) {
    if (!navigationActive || !userPosition) return;

    const now = Date.now();

    // Prevent excessive map animation from rapid GPS events.
    if (now - lastGPSUpdate < 500) return;

    lastGPSUpdate = now;

    const heading = position.coords.heading;

    map.easeTo({
        center: userPosition,
        zoom: 17,
        bearing:
            Number.isFinite(heading) ? heading : map.getBearing(),
        duration: 650,
        essential: true
    });

    updateUserMarker();

    const progress = getRouteProgress(userPosition);

    if (!progress) return;

    const totalRouteLength =
        routeSummary?.lengthInMeters ||
        calculatePolylineLength(routeCoordinates);

    const totalTravelTime =
        routeSummary?.travelTimeInSeconds || 0;

    const remainingDistance = progress.remainingDistance;

    const remainingSeconds =
        totalRouteLength > 0
            ? (remainingDistance / totalRouteLength) * totalTravelTime
            : 0;

    updateProgressDisplay(
        remainingDistance,
        remainingSeconds
    );

    updateNavigationInterface(
        "Navigation active",
        `Approximately ${formatDistance(remainingDistance)} remaining. Estimated arrival: ${formatETA(remainingSeconds)}.`
    );

    checkArrival(userPosition);

    if (navigationActive) {
        checkOffRoute(progress.distanceFromRoute);
    }
}

/* =========================================================
   ROUTE PROGRESS
========================================================= */

function getRouteProgress(position) {
    if (!routeCoordinates.length) return null;

    let nearestIndex = 0;
    let nearestDistance = Infinity;

    for (let i = 0; i < routeCoordinates.length; i++) {
        const distance = haversineDistance(
            position,
            routeCoordinates[i]
        );

        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = i;
        }
    }

    let remainingDistance = 0;

    for (
        let i = nearestIndex + 1;
        i < routeCoordinates.length;
        i++
    ) {
        remainingDistance += haversineDistance(
            routeCoordinates[i - 1],
            routeCoordinates[i]
        );
    }

    remainingDistance += nearestDistance;

    return {
        nearestIndex,
        distanceFromRoute: nearestDistance,
        remainingDistance
    };
}

/* =========================================================
   OFF-ROUTE DETECTION
========================================================= */

function checkOffRoute(distanceFromRoute) {
    if (!navigationActive || rerouting) return;

    if (distanceFromRoute > OFF_ROUTE_DISTANCE) {
        offRouteCount++;
    } else {
        offRouteCount = 0;
        return;
    }

    if (offRouteCount < OFF_ROUTE_CONFIRMATIONS) {
        return;
    }

    const now = Date.now();

    if (now - lastRerouteTime < REROUTE_COOLDOWN) {
        return;
    }

    automaticallyReroute();
}

/* =========================================================
   AUTOMATIC REROUTING
========================================================= */

async function automaticallyReroute() {
    if (
        !navigationActive ||
        !userPosition ||
        !destinationPosition ||
        rerouting
    ) {
        return;
    }

    rerouting = true;
    lastRerouteTime = Date.now();

    offRouteCount = 0;

    updateNavigationInterface(
        "Recalculating route...",
        "You appear to be away from the planned route. ROAMX is finding a new route."
    );

    setMessage(
        "You are off route. Recalculating...",
        "normal"
    );

    try {
        const data = await requestTomTomRoute(
            userPosition,
            destinationPosition
        );

        const route = data.routes[0];

        routeSummary = route.summary || {};

        displayRoutes(data.routes);

        updateNavigationInterface(
            "New route ready",
            "Your route has been updated using your current location."
        );

        setMessage(
            "New route calculated successfully.",
            "success"
        );

    } catch (error) {
        console.error("ROAMX Rerouting Error:", error);

        updateNavigationInterface(
            "Rerouting unavailable",
            "Could not update your route. Continue safely and try again."
        );

        setMessage(
            "Automatic rerouting failed: " + error.message,
            "error"
        );

    } finally {
        rerouting = false;
    }
}

/* =========================================================
   ARRIVAL DETECTION
========================================================= */

function checkArrival(position) {
    if (!destinationPosition || !navigationActive) return;

    const distance = haversineDistance(
        position,
        destinationPosition
    );

    if (distance <= ARRIVAL_DISTANCE) {
        arrivalCount++;
    } else {
        arrivalCount = 0;
    }

    if (arrivalCount >= ARRIVAL_CONFIRMATIONS) {
        destinationReached();
    }
}

function destinationReached() {
    if (!navigationActive) return;

    navigationActive = false;

    stopGPSWatch();

    updateNavigationButtons();

    updateNavigationInterface(
        "DESTINATION REACHED",
        "You have arrived at your selected destination. Have a great day!"
    );

    updateProgressDisplay(0, 0);

    setLocationStatus(
        "Destination reached",
        "Your journey has been completed"
    );

    setMessage(
        "ROAMX: You have reached your destination!",
        "success"
    );

    if (elements.locateBtn) {
        elements.locateBtn.disabled = false;
    }

    if (elements.routeBtn) {
        elements.routeBtn.disabled = false;
    }
}

/* =========================================================
   END NAVIGATION
========================================================= */

function stopGPSWatch() {
    if (
        navigationWatchId !== null &&
        navigator.geolocation
    ) {
        navigator.geolocation.clearWatch(
            navigationWatchId
        );
    }

    navigationWatchId = null;
}

function stopNavigation() {
    if (!navigationActive) return;

    navigationActive = false;

    stopGPSWatch();

    offRouteCount = 0;
    arrivalCount = 0;
    rerouting = false;

    updateNavigationButtons();

    updateNavigationInterface(
        "Navigation ended",
        "Your live journey tracking has stopped. You can calculate another route."
    );

    setLocationStatus(
        "Location connected",
        "Your last GPS position is available"
    );

    setMessage(
        "Navigation ended.",
        "success"
    );

    if (elements.locateBtn) {
        elements.locateBtn.disabled = false;
    }

    updateRouteButton();
}

/* =========================================================
   LIVE TRAFFIC
========================================================= */

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

function disableTrafficLayer() {
    if (map.getLayer(TRAFFIC_LAYER)) {
        map.removeLayer(TRAFFIC_LAYER);
    }

    if (map.getSource(TRAFFIC_SOURCE)) {
        map.removeSource(TRAFFIC_SOURCE);
    }
}

/* =========================================================
   EVENT LISTENERS
========================================================= */

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

/* =========================================================
   START ROAMX
========================================================= */

initializeMap();

console.log(
    "%cROAMX LIVE NAVIGATION INITIALIZED",
    "color:#27d9ed;font-size:16px;font-weight:bold;"
);