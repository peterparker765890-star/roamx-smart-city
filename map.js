const TOMTOM_KEY = "qW1DnHeAfDf4JyBXEDU3NkcE4XU3xQjv";
const TOMTOM_BASE = "https://api.tomtom.com";
const MAP_STYLE = "street-dark";
const $ = (id) => document.getElementById(id);

const elements = {
locationStatus:$("locationStatus"),
locationText:$("locationText"),
destination:$("destination"),
searchBtn:$("searchBtn"),
searchResults:$("searchResults"),
originText:$("originText"),
destinationText:$("destinationText"),
routeBtn:$("routeBtn"),
distance:$("distance"),
duration:$("duration"),
locateBtn:$("locateBtn"),
message:$("message"),
trafficBtn:$("trafficBtn")
};

let map=null;
let userPosition=null;
let destinationPosition=null;
let userMarker=null;
let destinationMarker=null;
let trafficEnabled=false;
let isSearching=false;
let isRouting=false;
let searchRequestId=0;
let routeCoordinates=[];
let routeSummary=null;
let routeMetrics=null;
let navigationMode="idle";
let navigationWatchId=null;
let simulationTimer=null;
let simulationStartedAt=0;
let simulationElapsedBeforePause=0;
let simulationSpeed=1;
let simulatedMarker=null;
let simulatedPosition=null;
let offRouteReadings=0;
let lastRerouteAt=0;
let rerouteInProgress=false;

const SIMULATION_DURATION_MS=180000;
const OFF_ROUTE_METERS=90;
const OFF_ROUTE_CONFIRMATIONS=3;
const REROUTE_COOLDOWN_MS=25000;
const DEFAULT_CENTER=[76.9558,11.0168];
const ROUTE_SOURCE="roamx-route";
const ROUTE_OUTLINE_LAYER="roamx-route-outline";
const ROUTE_LAYER="roamx-route-line";
const TRAFFIC_SOURCE="roamx-traffic";
const TRAFFIC_LAYER="roamx-traffic-layer";

function setMessage(message,type="normal"){
if(!elements.message)return;
elements.message.textContent=message;
elements.message.dataset.type=type;
}

function setLocationStatus(title,description){
if(elements.locationStatus)elements.locationStatus.textContent=title;
if(elements.locationText)elements.locationText.textContent=description;
}

function formatDistance(meters){
if(!Number.isFinite(meters))return "--";
return meters>=1000?`${(meters/1000).toFixed(1)} km`:`${Math.round(meters)} m`;
}

function formatDuration(seconds){
if(!Number.isFinite(seconds))return "--";
const minutes=Math.round(seconds/60);
if(minutes<60)return `${minutes} min`;
const hours=Math.floor(minutes/60);
const remainingMinutes=minutes%60;
return remainingMinutes?`${hours} hr ${remainingMinutes} min`:`${hours} hr`;
}

function showButtonLoading(button,loading,loadingText,normalText){
if(!button)return;
button.disabled=loading;
button.textContent=loading?loadingText:normalText;
}

async function fetchJSON(url,options={}){
const response=await fetch(url,options);
if(!response.ok){
let detail="";
try{
const body=await response.json();
detail=body?.detailedError?.message||body?.error?.description||body?.message||body?.error||"";
}catch(_){}
throw new Error(detail?`${response.status}: ${detail}`:`TomTom request failed (${response.status}).`);
}
return response.json();
}

function setResultsVisible(visible){
const container=elements.searchResults;
if(!container)return;
container.style.display=visible?"block":"none";
container.style.visibility="visible";
container.style.opacity="1";
container.style.position="relative";
container.style.zIndex="20";
container.style.pointerEvents="auto";
}

function clearSearchResults(){
if(!elements.searchResults)return;
elements.searchResults.replaceChildren();
setResultsVisible(false);
}

function updateRouteButton(){
if(!elements.routeBtn)return;
elements.routeBtn.disabled=!(userPosition&&destinationPosition);
}

function initializeMap(){
if(!document.getElementById("map")){
console.error("ROAMX: #map container was not found.");
setMessage("Map container is missing from map.html.","error");
return;
}
if(typeof maplibregl==="undefined"){
setMessage("MapLibre failed to load. Check your internet connection.","error");
return;
}

map=new maplibregl.Map({
container:"map",
style:{
version:8,
sources:{
"tomtom-base":{
type:"raster",
tiles:[`${TOMTOM_BASE}/maps/orbis/display/raster/tile/{z}/{x}/{y}?apiVersion=2&style=${MAP_STYLE}&tileSize=256&key=${encodeURIComponent(TOMTOM_KEY)}`],
tileSize:256,
attribution:"© TomTom"
}
},
layers:[{
id:"tomtom-base-layer",
type:"raster",
source:"tomtom-base",
minzoom:0,
maxzoom:22
}]
},
center:DEFAULT_CENTER,
zoom:12,
minZoom:3,
maxZoom:20,
attributionControl:false
});

map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),"top-right");
map.addControl(new maplibregl.AttributionControl({compact:true}),"bottom-right");

map.on("load",()=>{
addRouteLayers();
createNavigationPanel();
setMessage("ROAMX map connected successfully.","success");
locateUser();
});

map.on("error",(event)=>{
console.error("ROAMX map error:",event.error||event);
});
}

function addRouteLayers(){
if(!map||map.getSource(ROUTE_SOURCE))return;

map.addSource(ROUTE_SOURCE,{
type:"geojson",
data:{type:"FeatureCollection",features:[]}
});

map.addLayer({
id:ROUTE_OUTLINE_LAYER,
type:"line",
source:ROUTE_SOURCE,
filter:["==",["get","selected"],true],
layout:{"line-join":"round","line-cap":"round"},
paint:{"line-color":"#080b18","line-width":10,"line-opacity":0.9}
});

map.addLayer({
id:ROUTE_LAYER,
type:"line",
source:ROUTE_SOURCE,
filter:["==",["get","selected"],true],
layout:{"line-join":"round","line-cap":"round"},
paint:{"line-color":"#27d9ed","line-width":6,"line-opacity":1}
});

map.addLayer({
id:"roamx-alternative-routes",
type:"line",
source:ROUTE_SOURCE,
filter:["==",["get","selected"],false],
layout:{"line-join":"round","line-cap":"round"},
paint:{
"line-color":"#8657ff",
"line-width":4,
"line-opacity":0.75,
"line-dasharray":[2,2]
}
});
}

function clearRoute(){
stopNavigation(false);
routeCoordinates=[];
routeSummary=null;
routeMetrics=null;
if(map?.getSource(ROUTE_SOURCE)){
map.getSource(ROUTE_SOURCE).setData({type:"FeatureCollection",features:[]});
}
if(elements.distance)elements.distance.textContent="--";
if(elements.duration)elements.duration.textContent="--";
}

function locateUser(){
if(!navigator.geolocation){
setLocationStatus("Location unavailable","This browser does not support location services.");
setMessage("Geolocation is not supported by this browser.","error");
return;
}

setLocationStatus("Connecting location...","Waiting for GPS permission");
setMessage("Requesting your current location...");

navigator.geolocation.getCurrentPosition(
(position)=>{
userPosition=[position.coords.longitude,position.coords.latitude];
updateUserMarker();
if(map)map.flyTo({center:userPosition,zoom:15,essential:true});
setLocationStatus("Location connected","Your current position is available");
if(elements.originText)elements.originText.textContent="Your current location";
setMessage("Your location is ready.","success");
updateRouteButton();
},
(error)=>{
let message="Unable to access your location.";
if(error.code===error.PERMISSION_DENIED)message="Location permission denied. Allow location access in browser settings.";
else if(error.code===error.POSITION_UNAVAILABLE)message="Your current position is unavailable.";
else if(error.code===error.TIMEOUT)message="Location request timed out. Press USE MY LOCATION to retry.";
setLocationStatus("Location not connected",message);
setMessage(message,"error");
console.error("ROAMX geolocation error:",error);
updateRouteButton();
},
{enableHighAccuracy:true,timeout:20000,maximumAge:10000}
);
}

function updateUserMarker(){
if(!map||!userPosition)return;
if(userMarker){
userMarker.setLngLat(userPosition);
return;
}
const marker=document.createElement("div");
marker.className="roamx-user-marker";
marker.style.cssText="width:18px;height:18px;border-radius:50%;background:#27d9ed;border:4px solid #ffffff;box-shadow:0 0 18px #27d9ed";
userMarker=new maplibregl.Marker({element:marker}).setLngLat(userPosition).addTo(map);
}

async function searchDestination(){
const query=elements.destination?.value.trim();
if(!query){
setMessage("Enter a destination to search.","error");
elements.destination?.focus();
return;
}
if(isSearching)return;

isSearching=true;
const thisRequest=++searchRequestId;
showButtonLoading(elements.searchBtn,true,"SEARCHING...","SEARCH DESTINATION →");
clearSearchResults();
setMessage(`Searching for "${query}"...`);

try{
const url=new URL(`${TOMTOM_BASE}/maps/orbis/places/geocode`);
url.searchParams.set("query",query);
url.searchParams.set("maxResults","6");
url.searchParams.set("countryCodesIso2","IN");
if(userPosition)url.searchParams.set("position",`${userPosition[0]},${userPosition[1]}`);

const data=await fetchJSON(url.toString(),{
method:"GET",
headers:{
"TomTom-Api-Key":TOMTOM_KEY,
"TomTom-Api-Version":"2",
"Attributes":"results"
}
});

if(thisRequest!==searchRequestId)return;
const results=Array.isArray(data.results)?data.results:[];

if(!results.length){
clearSearchResults();
setMessage("No matching destinations found. Try adding a town or district.","error");
return;
}

displaySearchResults(results);
const count=elements.searchResults?.children.length||0;
setMessage(
count?`${count} destination result(s) found. Select one below.`:"Results were returned, but no usable coordinates were found.",
count?"success":"error"
);
}catch(error){
console.error("ROAMX destination search error:",error);
clearSearchResults();
setMessage(`Search failed: ${error.message}`,"error");
}finally{
if(thisRequest===searchRequestId){
isSearching=false;
showButtonLoading(elements.searchBtn,false,"SEARCHING...","SEARCH DESTINATION →");
}
}
}

function displaySearchResults(results){
const container=elements.searchResults;
if(!container){
setMessage("Search results container is missing in map.html.","error");
return;
}
container.replaceChildren();

results.forEach((result)=>{
const coordinates=result.position?.coordinates;
if(!Array.isArray(coordinates)||coordinates.length<2||
!Number.isFinite(Number(coordinates[0]))||
!Number.isFinite(Number(coordinates[1])))return;

const longitude=Number(coordinates[0]);
const latitude=Number(coordinates[1]);
const title=result.poi?.name||result.address?.freeformAddress||
result.address?.municipality||result.address?.countrySecondarySubdivision||"Unknown destination";
const description=result.address?.freeformAddress||
result.address?.municipality||result.type||"Location result";

const button=document.createElement("button");
button.type="button";
button.className="result-item";
button.style.display="block";
button.style.width="100%";
button.style.position="relative";
button.style.zIndex="21";
button.style.pointerEvents="auto";

const titleElement=document.createElement("strong");
titleElement.textContent=title;
const descriptionElement=document.createElement("small");
descriptionElement.textContent=description;
button.append(titleElement,descriptionElement);

let selected=false;
const chooseResult=(event)=>{
event.preventDefault();
event.stopPropagation();
if(selected)return;
selected=true;
selectDestination([longitude,latitude],title);
};
button.addEventListener("click",chooseResult);
button.addEventListener("keydown",(event)=>{
if(event.key==="Enter"||event.key===" ")chooseResult(event);
});
container.appendChild(button);
});

setResultsVisible(container.children.length>0);
}

function selectDestination(coordinates,name){
if(!Array.isArray(coordinates)||coordinates.length!==2){
setMessage("The selected destination has invalid coordinates.","error");
return;
}

destinationPosition=coordinates;
if(elements.destination)elements.destination.value=name;
if(elements.destinationText)elements.destinationText.textContent=name;
clearSearchResults();

if(destinationMarker)destinationMarker.remove();

const marker=document.createElement("div");
marker.className="roamx-destination-marker";
marker.style.cssText="width:18px;height:18px;border-radius:50%;background:#8657ff;border:3px solid #ffffff;box-shadow:0 0 18px #8657ff";

destinationMarker=new maplibregl.Marker({element:marker}).setLngLat(destinationPosition).addTo(map);
if(map)map.flyTo({center:destinationPosition,zoom:14,essential:true});
clearRoute();
updateRouteButton();
setMessage(`Destination selected: ${name}. Now calculate your route.`,"success");
}

async function calculateRoute(){
if(!userPosition){
setMessage("Your location is not connected. Press USE MY LOCATION first.","error");
locateUser();
return;
}
if(!destinationPosition){
setMessage("Search for a destination and select one of the results first.","error");
return;
}
if(isRouting)return;

isRouting=true;
showButtonLoading(elements.routeBtn,true,"CALCULATING...","CALCULATE ROUTE");
setMessage("Calculating your route using TomTom live traffic...");

try{
const origin=`${userPosition[1]},${userPosition[0]}`;
const destination=`${destinationPosition[1]},${destinationPosition[0]}`;
const locations=`${origin}:${destination}`;
const url=new URL(`${TOMTOM_BASE}/maps/orbis/routing/calculateRoute/${locations}/json`);

url.searchParams.set("apiVersion","2");
url.searchParams.set("routeType","fast");
url.searchParams.set("traffic","live");
url.searchParams.set("travelMode","car");
url.searchParams.set("maxAlternatives","2");
url.searchParams.set("sectionType","traffic");
url.searchParams.set("key",TOMTOM_KEY);

const data=await fetchJSON(url.toString(),{
method:"GET",
headers:{"TomTom-Api-Version":"2","Accept":"application/json"}
});

const routes=Array.isArray(data.routes)?data.routes:[];
if(!routes.length)throw new Error("TomTom did not return a route. Try another destination.");

const features=routes.map((route,index)=>{
const coordinates=getRouteCoordinates(route);
if(coordinates.length<2)return null;
return{
type:"Feature",
properties:{routeIndex:index,selected:index===0},
geometry:{type:"LineString",coordinates}
};
}).filter(Boolean);

if(!features.length)throw new Error("Route received, but route geometry was missing.");
if(!map?.getSource(ROUTE_SOURCE))throw new Error("Map is not ready yet. Refresh and try again.");

map.getSource(ROUTE_SOURCE).setData({type:"FeatureCollection",features});
routeCoordinates=features[0].geometry.coordinates;
routeSummary=routes[0].summary||{};
routeMetrics=buildRouteMetrics(routeCoordinates);
displayRouteInformation(routes[0]);
createNavigationPanel();
updateNavigationPanel("ready");
fitMapToRoute(routeCoordinates);

const delay=routes[0].summary?.trafficDelayInSeconds||0;
const routeCount=routes.length;
setMessage(
delay>0?`${routeCount} route option(s) found. Live traffic delay: ${formatDuration(delay)}.`:
`${routeCount} route option(s) calculated successfully using live traffic.`,
"success"
);
}catch(error){
console.error("ROAMX route calculation error:",error);
setMessage(`Route calculation failed: ${error.message}`,"error");
}finally{
isRouting=false;
showButtonLoading(elements.routeBtn,false,"CALCULATING...","CALCULATE ROUTE");
updateRouteButton();
}
}

function getRouteCoordinates(route){
const coordinates=[];
(route.legs||[]).forEach((leg)=>{
(leg.points||[]).forEach((point)=>{
const longitude=Number(point.longitude);
const latitude=Number(point.latitude);
if(Number.isFinite(longitude)&&Number.isFinite(latitude))coordinates.push([longitude,latitude]);
});
});
return coordinates;
}

function displayRouteInformation(route){
const summary=route?.summary||{};
if(elements.distance)elements.distance.textContent=formatDistance(summary.lengthInMeters);
if(elements.duration)elements.duration.textContent=formatDuration(summary.travelTimeInSeconds);
}

function fitMapToRoute(coordinates){
if(!map||!coordinates?.length)return;
const bounds=new maplibregl.LngLatBounds();
coordinates.forEach((coordinate)=>bounds.extend(coordinate));
if(!bounds.isEmpty()){
map.fitBounds(bounds,{
padding:{top:90,bottom:90,left:70,right:70},
maxZoom:16,
duration:1200
});
}
}

function toggleTraffic(){
if(!map||!map.isStyleLoaded()){
setMessage("The map is still loading. Please wait and try again.","error");
return;
}
try{
if(!trafficEnabled){
enableTrafficLayer();
trafficEnabled=true;
if(elements.trafficBtn){
elements.trafficBtn.textContent="TRAFFIC: ON";
elements.trafficBtn.classList.add("active");
}
setMessage("Live traffic flow overlay enabled.","success");
}else{
disableTrafficLayer();
trafficEnabled=false;
if(elements.trafficBtn){
elements.trafficBtn.textContent="TRAFFIC: OFF";
elements.trafficBtn.classList.remove("active");
}
setMessage("Live traffic flow overlay disabled.");
}
}catch(error){
console.error("ROAMX traffic layer error:",error);
setMessage(`Traffic layer error: ${error.message}`,"error");
}
}

function enableTrafficLayer(){
if(map.getSource(TRAFFIC_SOURCE))return;
map.addSource(TRAFFIC_SOURCE,{
type:"raster",
tiles:[`${TOMTOM_BASE}/maps/orbis/traffic/flow/raster/tile/{z}/{x}/{y}?apiVersion=2&style=dark&tileSize=256&key=${encodeURIComponent(TOMTOM_KEY)}`],
tileSize:256,
attribution:"© TomTom Traffic"
});
map.addLayer({
id:TRAFFIC_LAYER,
type:"raster",
source:TRAFFIC_SOURCE,
paint:{"raster-opacity":0.9}
});
}

function disableTrafficLayer(){
if(!map)return;
if(map.getLayer(TRAFFIC_LAYER))map.removeLayer(TRAFFIC_LAYER);
if(map.getSource(TRAFFIC_SOURCE))map.removeSource(TRAFFIC_SOURCE);
}

/* NAVIGATION PANEL AND SIMULATION */

function createNavigationPanel(){
if(document.getElementById("roamxNavigationPanel"))return;
if(!elements.routeBtn||!elements.routeBtn.parentElement)return;

const panel=document.createElement("section");
panel.id="roamxNavigationPanel";
panel.style.cssText=[
"margin:18px 0",
"padding:18px",
"border:1px solid rgba(39,217,237,.35)",
"border-radius:16px",
"background:linear-gradient(145deg,rgba(13,23,43,.98),rgba(20,15,43,.96))",
"color:#f4f7ff",
"font-family:inherit",
"box-shadow:0 12px 35px rgba(0,0,0,.22)"
].join(";");

panel.innerHTML=`
<div style="font-size:11px;letter-spacing:2px;color:#27d9ed;font-weight:800;margin-bottom:8px">ROAMX / ACTIVE NAVIGATION</div>
<div id="roamxNavStatus" style="font-size:18px;font-weight:800;margin-bottom:12px">Route not ready</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
<div style="padding:12px;border-radius:10px;background:rgba(255,255,255,.055)">
<div id="roamxDistanceLabel" style="font-size:10px;letter-spacing:1.4px;color:#9baac4">REMAINING DISTANCE</div>
<div id="roamxRemainingDistance" style="font-size:23px;font-weight:800;margin-top:5px">--</div>
</div>
<div style="padding:12px;border-radius:10px;background:rgba(255,255,255,.055)">
<div id="roamxEtaLabel" style="font-size:10px;letter-spacing:1.4px;color:#9baac4">ARRIVAL ESTIMATE</div>
<div id="roamxETA" style="font-size:23px;font-weight:800;margin-top:5px">--</div>
</div>
</div>
<div id="roamxNavigationMessage" style="font-size:12px;line-height:1.6;color:#aab8d0;margin-bottom:14px">Calculate a route to begin live navigation or run a demo.</div>
<div style="display:flex;flex-wrap:wrap;gap:8px">
<button type="button" id="roamxStartButton" style="flex:1;min-width:145px;padding:12px 14px;border:0;border-radius:9px;background:#27d9ed;color:#07111d;font-weight:900;letter-spacing:.6px;cursor:pointer">START GPS NAVIGATION</button>
<button type="button" id="roamxDemoButton" style="flex:1;min-width:145px;padding:12px 14px;border:1px solid #8657ff;border-radius:9px;background:rgba(134,87,255,.16);color:#fff;font-weight:900;letter-spacing:.6px;cursor:pointer">▶ DEMO SIMULATION</button>
<button type="button" id="roamxPauseButton" style="display:none;padding:12px 14px;border:1px solid rgba(255,255,255,.25);border-radius:9px;background:transparent;color:#fff;font-weight:800;cursor:pointer">PAUSE</button>
<button type="button" id="roamxEndButton" style="display:none;padding:12px 14px;border:1px solid rgba(255,90,110,.6);border-radius:9px;background:rgba(255,70,90,.12);color:#ff9aa8;font-weight:800;cursor:pointer">END</button>
</div>
<div id="roamxSimulationHint" style="display:none;margin-top:10px;font-size:11px;color:#b9a5ff">DEMO MODE · Virtual movement only · No physical travel or GPS movement required</div>`;

elements.routeBtn.insertAdjacentElement("afterend",panel);
document.getElementById("roamxStartButton").addEventListener("click",startLiveNavigation);
document.getElementById("roamxDemoButton").addEventListener("click",startDemoSimulation);
document.getElementById("roamxPauseButton").addEventListener("click",toggleSimulationPause);
document.getElementById("roamxEndButton").addEventListener("click",()=>stopNavigation(true));
}

function updateNavigationPanel(state){
const panel=document.getElementById("roamxNavigationPanel");
if(!panel)return;

const status=document.getElementById("roamxNavStatus");
const distance=document.getElementById("roamxRemainingDistance");
const eta=document.getElementById("roamxETA");
const message=document.getElementById("roamxNavigationMessage");
const start=document.getElementById("roamxStartButton");
const demo=document.getElementById("roamxDemoButton");
const pause=document.getElementById("roamxPauseButton");
const end=document.getElementById("roamxEndButton");
const hint=document.getElementById("roamxSimulationHint");
if(!status)return;

const hasRoute=routeCoordinates.length>=2&&routeMetrics;
start.disabled=!hasRoute||navigationMode==="live";
demo.disabled=!destinationPosition||navigationMode==="simulation"||navigationMode==="paused";
start.style.opacity=start.disabled?".45":"1";
demo.style.opacity=demo.disabled?".45":"1";
pause.style.display=(navigationMode==="simulation"||navigationMode==="paused")?"inline-block":"none";
end.style.display=["live","simulation","paused"].includes(navigationMode)?"inline-block":"none";
hint.style.display=navigationMode==="simulation"||navigationMode==="paused"?"block":"none";
pause.textContent=navigationMode==="paused"?"RESUME":"PAUSE";

if(state==="ready"||navigationMode==="idle"){
status.textContent=hasRoute?"Route ready — choose a navigation mode":"Calculate a route to begin";
message.textContent=hasRoute?"Start GPS navigation when travelling, or use Demo Simulation to test ROAMX from your laptop.":"Select a destination and calculate a route first.";
distance.textContent=hasRoute?formatDistance(routeMetrics.total):"--";
eta.textContent=hasRoute?formatDuration(routeSummary?.travelTimeInSeconds||0):"--";
document.getElementById("roamxDistanceLabel").textContent="ROUTE DISTANCE";
document.getElementById("roamxEtaLabel").textContent="ESTIMATED TIME";
}

if(navigationMode==="live"){
status.textContent="Navigation active · GPS tracking";
message.textContent="ROAMX is following your device location. Keep location services enabled.";
document.getElementById("roamxDistanceLabel").textContent="REMAINING DISTANCE";
document.getElementById("roamxEtaLabel").textContent="ARRIVAL ESTIMATE";
}else if(navigationMode==="simulation"){
status.textContent="Demo simulation running";
message.textContent="A virtual marker is travelling along the selected route. Your real GPS position is not changed.";
document.getElementById("roamxDistanceLabel").textContent="SIMULATED REMAINING";
document.getElementById("roamxEtaLabel").textContent="SIMULATION ETA";
}else if(navigationMode==="paused"){
status.textContent="Demo simulation paused";
message.textContent="Press RESUME to continue the virtual journey.";
}else if(navigationMode==="arrived"){
status.textContent="Destination reached";
message.textContent="The navigation journey has finished successfully.";
distance.textContent="0 m";
eta.textContent="ARRIVED";
}else if(navigationMode==="idle"&&state==="ended"){
status.textContent="Navigation ended";
message.textContent="Tracking has stopped. Your route is still available to start again.";
}
}

function haversineMeters(a,b){
const rad=value=>value*Math.PI/180;
const dLat=rad(b[1]-a[1]);
const dLon=rad(b[0]-a[0]);
const lat1=rad(a[1]);
const lat2=rad(b[1]);
const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}

function buildRouteMetrics(coordinates){
const cumulative=[0];
for(let i=1;i<coordinates.length;i++){
cumulative.push(cumulative[i-1]+haversineMeters(coordinates[i-1],coordinates[i]));
}
return{cumulative,total:cumulative[cumulative.length-1]||0};
}

function pointAtRouteDistance(distanceMeters){
const coords=routeCoordinates;
const cumulative=routeMetrics.cumulative;
const target=Math.max(0,Math.min(distanceMeters,routeMetrics.total));
let index=cumulative.findIndex(value=>value>=target);
if(index<=0)return coords[0];
if(index<0)return coords[coords.length-1];
const segmentLength=cumulative[index]-cumulative[index-1]||1;
const fraction=(target-cumulative[index-1])/segmentLength;
return[
coords[index-1][0]+(coords[index][0]-coords[index-1][0])*fraction,
coords[index-1][1]+(coords[index][1]-coords[index-1][1])*fraction
];
}

function createVirtualMarker(position){
if(!map||!position)return;
if(!simulatedMarker){
const node=document.createElement("div");
node.style.cssText="width:22px;height:22px;border-radius:50%;background:#ffbd4a;border:4px solid #fff;box-shadow:0 0 0 7px rgba(255,189,74,.2),0 0 24px #ffbd4a";
simulatedMarker=new maplibregl.Marker({element:node,anchor:"center"}).setLngLat(position).addTo(map);
}else{
simulatedMarker.setLngLat(position);
}
simulatedPosition=position;
}

function updateProgress(distanceTravelled,isDemo){
if(!routeMetrics)return;
const remaining=Math.max(0,routeMetrics.total-distanceTravelled);
const originalSeconds=Number(routeSummary?.travelTimeInSeconds)||Math.max(60,routeMetrics.total/10);
const remainingSeconds=originalSeconds*(remaining/Math.max(1,routeMetrics.total));
const distanceNode=document.getElementById("roamxRemainingDistance");
const etaNode=document.getElementById("roamxETA");
if(distanceNode)distanceNode.textContent=formatDistance(remaining);
if(etaNode){
if(isDemo)etaNode.textContent=formatDuration(remainingSeconds);
else etaNode.textContent=new Date(Date.now()+remainingSeconds*1000).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
}
}

function startDemoSimulation(){
if(!routeMetrics||routeCoordinates.length<2){
setMessage("Calculate a route before starting Demo Simulation.","error");
return;
}
stopNavigation(false);
navigationMode="simulation";
simulationElapsedBeforePause=0;
simulationStartedAt=Date.now();
simulationSpeed=1;
offRouteReadings=0;
createVirtualMarker(routeCoordinates[0]);
map.easeTo({center:routeCoordinates[0],zoom:16,duration:700});
updateNavigationPanel("running");
updateProgress(0,true);
setMessage("ROAMX demo simulation started. Virtual vehicle is moving along the route.","success");
runSimulationTick();
simulationTimer=window.setInterval(runSimulationTick,500);
}

function runSimulationTick(){
if(navigationMode!=="simulation"||!routeMetrics)return;
const elapsed=simulationElapsedBeforePause+(Date.now()-simulationStartedAt)*simulationSpeed;
const fraction=Math.min(1,elapsed/SIMULATION_DURATION_MS);
const travelled=routeMetrics.total*fraction;
const position=pointAtRouteDistance(travelled);
createVirtualMarker(position);
updateProgress(travelled,true);
if(map)map.easeTo({center:position,zoom:16,duration:450,essential:true});
if(fraction>=1){
clearInterval(simulationTimer);
simulationTimer=null;
navigationMode="arrived";
if(simulatedMarker){simulatedMarker.remove();simulatedMarker=null;}
updateNavigationPanel("arrived");
setMessage("Demo complete — destination reached successfully.","success");
}
}

function toggleSimulationPause(){
if(navigationMode==="simulation"){
simulationElapsedBeforePause+=(Date.now()-simulationStartedAt)*simulationSpeed;
clearInterval(simulationTimer);
simulationTimer=null;
navigationMode="paused";
updateNavigationPanel("paused");
setMessage("Demo simulation paused.");
}else if(navigationMode==="paused"){
navigationMode="simulation";
simulationStartedAt=Date.now();
updateNavigationPanel("running");
simulationTimer=window.setInterval(runSimulationTick,500);
runSimulationTick();
setMessage("Demo simulation resumed.","success");
}
}

function startLiveNavigation(){
if(!routeMetrics||routeCoordinates.length<2){
setMessage("Calculate a route before starting GPS navigation.","error");
return;
}
if(!navigator.geolocation){
setMessage("This browser does not support GPS. Use Demo Simulation instead.","error");
return;
}
if(!window.isSecureContext){
setMessage("GPS navigation requires HTTPS. Open ROAMX using its GitHub Pages address.","error");
return;
}

stopNavigation(false);
navigationMode="live";
updateNavigationPanel("running");
setMessage("Starting live GPS navigation...","success");

navigationWatchId=navigator.geolocation.watchPosition(
onLivePosition,
error=>{
console.error("ROAMX live GPS error:",error);
setMessage(error.code===1?"Location permission denied. Allow GPS or use Demo Simulation.":"GPS signal unavailable. Try again or use Demo Simulation.","error");
},
{enableHighAccuracy:true,maximumAge:1500,timeout:20000}
);
}

function onLivePosition(position){
if(navigationMode!=="live")return;
const accuracy=position.coords.accuracy;
if(Number.isFinite(accuracy)&&accuracy>100){
setMessage(`GPS signal is weak (±${Math.round(accuracy)} m). Waiting for a more accurate position.`);
return;
}

userPosition=[position.coords.longitude,position.coords.latitude];
updateUserMarker();
const nearest=nearestRouteVertex(userPosition);
updateProgress(nearest.distanceAlong,false);
if(map)map.easeTo({center:userPosition,zoom:17,duration:500,essential:true});

if(nearest.distanceFromRoute>OFF_ROUTE_METERS)offRouteReadings++;
else offRouteReadings=0;

if(offRouteReadings>=OFF_ROUTE_CONFIRMATIONS&&
Date.now()-lastRerouteAt>REROUTE_COOLDOWN_MS&&!rerouteInProgress){
rerouteFromCurrentPosition();
}

if(destinationPosition&&haversineMeters(userPosition,destinationPosition)<35){
navigationMode="arrived";
stopGPSWatch();
updateNavigationPanel("arrived");
setMessage("You have reached your destination. Travel safely.","success");
}
}

function nearestRouteVertex(position){
let bestDistance=Infinity;
let bestIndex=0;
routeCoordinates.forEach((coordinate,index)=>{
const distance=haversineMeters(position,coordinate);
if(distance<bestDistance){bestDistance=distance;bestIndex=index;}
});
return{
distanceFromRoute:bestDistance,
distanceAlong:routeMetrics.cumulative[bestIndex]||0
};
}

async function rerouteFromCurrentPosition(){
if(!destinationPosition||!userPosition||rerouteInProgress)return;
rerouteInProgress=true;
lastRerouteAt=Date.now();
offRouteReadings=0;
setMessage("You appear to be off route. ROAMX is recalculating your route...","success");

try{
const origin=`${userPosition[1]},${userPosition[0]}`;
const destination=`${destinationPosition[1]},${destinationPosition[0]}`;
const url=new URL(`${TOMTOM_BASE}/maps/orbis/routing/calculateRoute/${origin}:${destination}/json`);
url.searchParams.set("apiVersion","2");
url.searchParams.set("routeType","fast");
url.searchParams.set("traffic","live");
url.searchParams.set("travelMode","car");
url.searchParams.set("sectionType","traffic");
url.searchParams.set("key",TOMTOM_KEY);

const data=await fetchJSON(url.toString(),{
headers:{"TomTom-Api-Version":"2","Accept":"application/json"}
});
const route=data.routes?.[0];
const coords=route?getRouteCoordinates(route):[];
if(coords.length<2)throw new Error("No replacement route was returned.");

routeCoordinates=coords;
routeSummary=route.summary||{};
routeMetrics=buildRouteMetrics(coords);

map.getSource(ROUTE_SOURCE)?.setData({
type:"FeatureCollection",
features:[{
type:"Feature",
properties:{selected:true},
geometry:{type:"LineString",coordinates:coords}
}]
});

displayRouteInformation(route);
fitMapToRoute(coords);
setMessage("A new route has been calculated. Continue travelling safely.","success");
}catch(error){
console.error("ROAMX reroute error:",error);
setMessage(`Automatic rerouting failed: ${error.message}`,"error");
}finally{
rerouteInProgress=false;
}
}

function stopGPSWatch(){
if(navigationWatchId!==null){
navigator.geolocation.clearWatch(navigationWatchId);
navigationWatchId=null;
}
}

function stopNavigation(showEndedMessage=true){
stopGPSWatch();

if(simulationTimer!==null){
clearInterval(simulationTimer);
simulationTimer=null;
}

simulationElapsedBeforePause=0;
simulationStartedAt=0;

if(simulatedMarker){
simulatedMarker.remove();
simulatedMarker=null;
}
simulatedPosition=null;
navigationMode="idle";

if(showEndedMessage){
navigationMode="idle";
updateNavigationPanel("ended");
setMessage("Navigation ended. You can start GPS navigation or run the demo again.");
}else if(document.getElementById("roamxNavigationPanel")){
updateNavigationPanel("ready");
}
}

function attachEventListeners(){
if(elements.searchBtn){
elements.searchBtn.addEventListener("click",searchDestination);
}

if(elements.destination){
elements.destination.addEventListener("keydown",(event)=>{
if(event.key==="Enter"){
event.preventDefault();
searchDestination();
}
});

elements.destination.addEventListener("input",()=>{
if(destinationPosition){
destinationPosition=null;
if(destinationMarker){
destinationMarker.remove();
destinationMarker=null;
}
if(elements.destinationText)elements.destinationText.textContent="Not selected";
clearRoute();
updateRouteButton();
}
});
}

if(elements.routeBtn)elements.routeBtn.addEventListener("click",calculateRoute);
if(elements.locateBtn)elements.locateBtn.addEventListener("click",locateUser);
if(elements.trafficBtn)elements.trafficBtn.addEventListener("click",toggleTraffic);
}

function startRoamX(){
clearSearchResults();
attachEventListeners();
initializeMap();
}

if(document.readyState==="loading"){
document.addEventListener("DOMContentLoaded",startRoamX,{once:true});
}else{
startRoamX();
}