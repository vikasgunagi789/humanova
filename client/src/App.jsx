
import { useCallback, useEffect, useState } from "react";

import { useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";



import {
  Activity,
  ArrowRight,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  Clock3,
  HandHeart,
  History,
  HeartHandshake,
  LayoutDashboard,
  MapPin,
  Package,
  Plus,
  RefreshCw,
    Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Users,
   UserRound,
  X,
  Siren,
} from "lucide-react";
import "./index.css";

const API = (
  import.meta.env.VITE_API_URL || "http://localhost:5000/api"
).replace(/\/+$/, "");

const CATEGORIES = [
  "Food",
  "Clothing",
  "Education",
  "Medical",
  "Shelter",
  "Transport",
  "Volunteers",
  "Other",
];

const URGENCIES = ["Low", "Medium", "High", "Critical"];

const EMPTY_EMERGENCY = {
  summary: {
    activeNeeds: 0,
    criticalNeeds: 0,
    highPriorityNeeds: 0,
    unmatchedNeeds: 0,
    partiallyCoveredNeeds: 0,
  },
  requests: [],
};

const EMPTY_FORM = {
  title: "",
  description: "",
  category: "Food",
  quantity: 1,
  location: "",
  urgency: "Medium",
};

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(localStorage.getItem("humanova_token")
        ? { Authorization: `Bearer ${localStorage.getItem("humanova_token")}` }
        : {}),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error || data.message || `Request failed (${response.status})`
    );
  }

  return data;
}

function normalizeEmergency(data) {
  const summary = data?.summary || {};
  const requests = Array.isArray(data?.requests) ? data.requests : [];

  return {
    summary: {
      activeNeeds: Number(summary.activeNeeds) || 0,
      criticalNeeds: Number(summary.criticalNeeds) || 0,
      highPriorityNeeds: Number(summary.highPriorityNeeds) || 0,
      unmatchedNeeds: Number(summary.unmatchedNeeds) || 0,
      partiallyCoveredNeeds: Number(summary.partiallyCoveredNeeds) || 0,
    },
    requests: requests.map((item) => ({
      ...item,
      quantity: Number(item.quantity) || 0,
      availableQuantity: Number(item.availableQuantity) || 0,
      shortage: Number(item.shortage) || 0,
      coveragePercent: Math.max(
        0,
        Math.min(100, Number(item.coveragePercent) || 0)
      ),
      priorityScore: Number(item.priorityScore) || 0,
      matchingResources: Array.isArray(item.matchingResources)
        ? item.matchingResources
        : [],
    })),
  };
}


function buildCrisisRadar(requests) {
  const areas = new Map();

  for (const request of requests) {
    const location = String(request.location || "").trim() || "Location not specified";
    const key = location.toLowerCase();

    if (!areas.has(key)) {
      areas.set(key, {
        location,
        totalNeeds: 0,
        criticalNeeds: 0,
        highPriorityNeeds: 0,
        outstandingUnits: 0,
        unmatchedNeeds: 0,
        requests: [],
      });
    }

    const area = areas.get(key);
    const shortage = Math.max(
      0,
      Number(request.shortage ?? request.remainingNeed ?? request.quantity) || 0
    );

    area.totalNeeds += 1;
    area.outstandingUnits += shortage;
    area.requests.push(request);

    if (request.urgency === "Critical") {
      area.criticalNeeds += 1;
    }

    if (request.urgency === "High") {
      area.highPriorityNeeds += 1;
    }

    if (
      shortage > 0 &&
      Number(request.availableQuantity || 0) === 0
    ) {
      area.unmatchedNeeds += 1;
    }
  }

  return Array.from(areas.values())
    .map((area) => {
      const sortedRequests = [...area.requests].sort(
        (a, b) => (Number(b.priorityScore) || 0) -
                  (Number(a.priorityScore) || 0)
      );

      let severity = "Moderate";

      if (area.criticalNeeds > 0 || area.unmatchedNeeds >= 3) {
        severity = "Critical";
      } else if (
        area.highPriorityNeeds > 0 ||
        area.unmatchedNeeds > 0 ||
        area.outstandingUnits >= 20
      ) {
        severity = "High";
      }

      return {
        ...area,
        severity,
        representativeRequest: sortedRequests[0] || null,
      };
    })
    .sort((a, b) => {
      const severityWeight = {
        Critical: 3,
        High: 2,
        Moderate: 1,
      };

      return (
        severityWeight[b.severity] - severityWeight[a.severity] ||
        b.outstandingUnits - a.outstandingUnits
      );
    });
}

function formatAllocationDate(value) {
  if (!value) return "Date unavailable";

  let date;

  if (typeof value.toDate === "function") {
    date = value.toDate();
  } else if (typeof value._seconds === "number") {
    date = new Date(value._seconds * 1000);
  } else if (typeof value.seconds === "number") {
    date = new Date(value.seconds * 1000);
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}


function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}


const DEFAULT_CENTER = [12.9141, 74.8560]; // Mangaluru fallback

function MapRecenter({ center }) {
  const map = useMap();

  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [map, center]);

  return null;
}

// Div-based icons avoid Vite/Leaflet's missing default marker-image problem.
function createCommunityMarker(type) {
  const isRequest = type === "request";
  const color = isRequest ? "#ef4444" : "#10b981";
  const symbol = isRequest ? "!" : "+";

  return L.divIcon({
    className: "humanova-leaflet-marker-wrap",
    html: `<span class="humanova-leaflet-marker" style="--marker-color:${color}">${symbol}</span>`,
    iconSize: [34, 42],
    iconAnchor: [17, 39],
    popupAnchor: [0, -36],
  });
}


function CommunityMap({ requests, resources }) {
  const [points, setPoints] = useState([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState("");
  const [filter, setFilter] = useState("all");

  const places = useMemo(
    () => [
      ...requests
        .filter(
          (item) =>
            typeof item.location === "string" &&
            item.location.trim()
        )
        .map((item) => ({
          id: `request-${item._id}`,
          type: "request",
          title: item.title || "Community need",
          category: item.category || "Other",
          location: item.location.trim(),
          urgency: item.urgency || "Medium",
          quantity: Number(item.quantity) || 0,
          status: item.status || "Open",
        })),
      ...resources
        .filter(
          (item) =>
            typeof item.location === "string" &&
            item.location.trim()
        )
        .map((item) => ({
          id: `resource-${item._id}`,
          type: "resource",
          title: item.title || "Available resource",
          category: item.category || "Other",
          location: item.location.trim(),
          quantity: Number(item.quantity) || 0,
          status:
            Number(item.quantity) > 0
              ? "Available"
              : "Unavailable",
        })),
    ],
    [requests, resources]
  );

  useEffect(() => {
    let cancelled = false;

    async function locatePlaces() {
      setMapLoading(true);
      setMapError("");
      setPoints([]);

      try {
        const results = [];
        const cache = new Map();
        const failures = [];

        for (const place of places) {
          if (cancelled) return;

          const cacheKey = place.location.toLowerCase();

          let coords = cache.get(cacheKey);

          if (!coords) {
            const rawLocation = place.location.trim();

            const searchLocation =
              /\b(india|karnataka)\b/i.test(rawLocation)
                ? rawLocation
                : `${rawLocation}, Karnataka, India`;

            try {
              const url = new URL(
                "https://nominatim.openstreetmap.org/search"
              );

              url.searchParams.set("q", searchLocation);
              url.searchParams.set("format", "jsonv2");
              url.searchParams.set("limit", "1");

              const response = await fetch(url.toString(), {
                headers: {
                  Accept: "application/json",
                },
              });

              if (!response.ok) {
                throw new Error(
                  `Geocoder returned HTTP ${response.status}`
                );
              }

              const data = await response.json();

              if (!Array.isArray(data) || data.length === 0) {
                failures.push(place.location);
                continue;
              }

              const lat = Number(data[0].lat);
              const lon = Number(data[0].lon);

              if (
                !Number.isFinite(lat) ||
                !Number.isFinite(lon)
              ) {
                failures.push(place.location);
                continue;
              }

              coords = [lat, lon];
              cache.set(cacheKey, coords);

              // Keep requests to the public geocoder modest.
              await new Promise((resolve) =>
                setTimeout(resolve, 1100)
              );
            } catch (error) {
              console.error(
                "Humanova geocoding failed:",
                place.location,
                error
              );

              failures.push(place.location);
              continue;
            }
          }

          results.push({
            ...place,
            position: coords,
          });
        }

        if (cancelled) return;

        setPoints(results);

        if (places.length === 0) {
          setMapError(
            "No requests or resources have a saved location yet. Add a request or resource with a locality to display markers."
          );
        } else if (results.length === 0) {
          setMapError(
            `Could not map any of the ${places.length} saved location(s). Check your internet connection and the browser console for geocoding errors.`
          );
        } else if (failures.length > 0) {
          setMapError(
            `${results.length} location(s) mapped. Could not locate: ${[
              ...new Set(failures),
            ].join(", ")}. Try entering a town, district and state.`
          );
        }
      } catch (error) {
        console.error("Humanova map error:", error);

        if (!cancelled) {
          setMapError(
            "Unable to load location data. Check the browser console and your internet connection."
          );
        }
      } finally {
        if (!cancelled) {
          setMapLoading(false);
        }
      }
    }

    locatePlaces();

    return () => {
      cancelled = true;
    };
  }, [places]);

  const visiblePoints = points.filter((point) => {
    if (filter === "all") return true;
    return point.type === filter;
  });

  const center = visiblePoints[0]?.position || DEFAULT_CENTER;

  return (
    <section className="panel community-map-panel">
      <div className="panel-heading">
        <div>
          <h3>Community location map</h3>
          <p>
            Explore saved requests and resources by location.
          </p>
        </div>
        <MapPin size={22} />
      </div>

      <div className="map-toolbar">
        <button
          type="button"
          className={
            filter === "all" ? "map-filter active" : "map-filter"
          }
          onClick={() => setFilter("all")}
        >
          All locations
        </button>

        <button
          type="button"
          className={
            filter === "request"
              ? "map-filter active"
              : "map-filter"
          }
          onClick={() => setFilter("request")}
        >
          Community needs
        </button>

        <button
          type="button"
          className={
            filter === "resource"
              ? "map-filter active"
              : "map-filter"
          }
          onClick={() => setFilter("resource")}
        >
          Resources
        </button>
      </div>

      {mapLoading && (
        <p className="map-message">
          Locating saved community addresses…
        </p>
      )}

      {mapError && (
        <p className="map-message map-error" role="status">
          {mapError}
        </p>
      )}

      <div className="community-map">
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={11}
          scrollWheelZoom
          className="leaflet-map"
        >
          <MapRecenter center={center} />

          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {visiblePoints.map((point) => (
            <Marker
              key={point.id}
              position={point.position}
              icon={createCommunityMarker(point.type)}
            >
              <Popup>
                <strong>{point.title}</strong>
                <br />
                {point.type === "request"
                  ? "Community need"
                  : "Available resource"}
                <br />
                Category: {point.category}
                <br />
                Location: {point.location}
                <br />
                Quantity: {point.quantity}
                <br />
                Status: {point.status}
                {point.urgency && (
                  <>
                    <br />
                    Urgency: {point.urgency}
                  </>
                )}
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      <p className="map-attribution-note">
        Map tiles © OpenStreetMap contributors. Locations are
        estimated from saved address text. Verify them before
        coordinating deliveries or emergency assistance.
      </p>

      <div className="map-count">
        <MapPin size={15} />
        {visiblePoints.length} mapped location(s)
      </div>
    </section>
  );
}



function App() {
  // All React hooks belong inside the component.
  const [page, setPage] = useState("dashboard");
  const [authToken, setAuthToken] = useState(() => localStorage.getItem("humanova_token") || "");
  const [currentUser, setCurrentUser] = useState(null);
  const [profileActivity, setProfileActivity] = useState({ resources: [], requests: [], summary: {} });
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({
  name: "",
  email: "",
  password: "",
  phone: "",
  address: "",
  locality: "",
  accountType: "Individual",
});
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [dashboard, setDashboard] = useState({});
  const [requests, setRequests] = useState([]);
  const [resources, setResources] = useState([]);
  const [emergency, setEmergency] = useState(EMPTY_EMERGENCY);
  const [selected, setSelected] = useState(null);
  const [matches, setMatches] = useState([]);
  const [allocationQuantities, setAllocationQuantities] = useState({});
  const [showForm, setShowForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [allocations, setAllocations] = useState([]);
const [allocationSearch, setAllocationSearch] = useState("");
const [allocationStatusFilter, setAllocationStatusFilter] =
  useState("All");

  const [form, setForm] = useState(EMPTY_FORM);
  const [aiAnalysis, setAiAnalysis] = useState(null);
const [aiLoading, setAiLoading] = useState(false);
const [aiMatchingUsed, setAiMatchingUsed] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [dashboardData, requestsData, resourcesData, emergencyData] =
        await Promise.all([
          api("/dashboard"),
          api("/requests"),
          api("/resources"),
          api("/emergency"),
        ]);

      const nextRequests = Array.isArray(requestsData)
        ? requestsData
        : Array.isArray(requestsData?.requests)
          ? requestsData.requests
          : [];

      const nextResources = Array.isArray(resourcesData)
        ? resourcesData
        : Array.isArray(resourcesData?.resources)
          ? resourcesData.resources
          : [];

      
setDashboard(dashboardData || {});
setRequests(nextRequests);
setResources(nextResources);
setAllocations(
  Array.isArray(dashboardData?.allocations)
    ? dashboardData.allocations
    : []
);
setEmergency(normalizeEmergency(emergencyData));


      setSelected((current) => {
        if (!current?._id) return null;

        return (
          nextRequests.find((item) => item._id === current._id) ||
          normalizeEmergency(emergencyData).requests.find(
            (item) => item._id === current._id
          ) ||
          null
        );
      });
    } catch (err) {
      setError(err.message || "Failed to load community data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (page !== "profile" || !authToken) return;

    let active = true;
    setProfileLoading(true);
    setProfileError("");

    api("/profile/activity")
      .then((data) => {
        if (!active) return;
        setProfileActivity({
          resources: Array.isArray(data?.resources) ? data.resources : [],
          requests: Array.isArray(data?.requests) ? data.requests : [],
          summary: data?.summary || {},
        });
      })
      .catch((err) => {
        if (active) setProfileError(err.message || "Could not load your activity.");
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });

    return () => { active = false; };
  }, [page, authToken]);

  useEffect(() => {
    let active = true;
    if (!authToken) {
      setCurrentUser(null);
      setLoading(false);
      return () => { active = false; };
    }
    api("/auth/me")
      .then((data) => {
        if (!active) return;
        setCurrentUser(data.user || null);
        refresh();
      })
      .catch((err) => {
        if (!active) return;
        localStorage.removeItem("humanova_token");
        setAuthToken("");
        setCurrentUser(null);
        setAuthError(err.message || "Please sign in again.");
        setLoading(false);
      });
    return () => { active = false; };
  }, [authToken, refresh]);

  const submitAuth = async (event) => {
    event.preventDefault();
    if (authBusy) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      const endpoint = authMode === "register" ? "/auth/register" : "/auth/login";
      const payload =
  authMode === "register"
    ? {
        name: authForm.name.trim(),
        email: authForm.email.trim(),
        password: authForm.password,
        phone: authForm.phone.trim(),
        address: authForm.address.trim(),
        locality: authForm.locality.trim(),
        accountType: authForm.accountType,
      }
    : {
        email: authForm.email.trim(),
        password: authForm.password,
      };
      const result = await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
      localStorage.setItem("humanova_token", result.token);
      setAuthToken(result.token);
      setCurrentUser(result.user || null);
      setAuthForm({
  name: "",
  email: "",
  password: "",
  phone: "",
  address: "",
  locality: "",
  accountType: "Individual",
});
    } catch (err) {
      setAuthError(err.message || "Authentication failed.");
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = () => {
    localStorage.removeItem("humanova_token");
    setAuthToken("");
    setCurrentUser(null);
    setPage("dashboard");
    setRequests([]);
    setResources([]);
    setAllocations([]);
    setDashboard({});
    setNotice("");
    setError("");
  };

  
const openForm = (type) => {
  setForm({ ...EMPTY_FORM });
  setAiAnalysis(null);
  setAiLoading(false);
  setShowForm(type);
  setNotice("");
  setError("");
};

const analyzeNeedWithAI = async () => {
  if (showForm !== "request" || aiLoading) return;

  if (!form.title.trim()) {
    setError("Enter a request title before using AI analysis.");
    return;
  }

  setAiLoading(true);
  setError("");
  setNotice("");
  setAiAnalysis(null);

  try {
    const result = await api("/ai/analyze-need", {
      method: "POST",
      body: JSON.stringify({
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        quantity: Number(form.quantity),
        location: form.location.trim(),
      }),
    });

    const analysis = result?.analysis ?? result?.data ?? result;

    if (!analysis || typeof analysis !== "object") {
      throw new Error("The AI endpoint returned an unexpected response.");
    }

    setAiAnalysis(analysis);
  } catch (err) {
    setError(err.message || "AI analysis could not be completed.");
  } finally {
    setAiLoading(false);
  }
};

const applyAIRecommendations = () => {
  if (!aiAnalysis) return;

  const suggestedCategory = aiAnalysis.suggestedCategory;
  const suggestedUrgency = aiAnalysis.suggestedUrgency;

  setForm((current) => ({
    ...current,
    ...(CATEGORIES.includes(suggestedCategory)
      ? { category: suggestedCategory }
      : {}),
    ...(URGENCIES.includes(suggestedUrgency)
      ? { urgency: suggestedUrgency }
      : {}),
  }));

  setNotice("AI suggestions applied. Review them before submitting.");
};


  const submitForm = async (event) => {
    event.preventDefault();

    if (busy) return;

    setBusy(true);
    setError("");
    setNotice("");

    const formType = showForm;

    try {
      const path = formType === "request" ? "/requests" : "/resources";

      await api(path, {
        method: "POST",
        body: JSON.stringify({
          ...form,
          title: form.title.trim(),
          description: form.description.trim(),
          location: form.location.trim(),
          quantity: Number(form.quantity),
          ...(formType === "request"
            ? { urgency: form.urgency }
            : {}),
        }),
      });

      setShowForm(null);
      setNotice(
        formType === "request"
          ? "Community request created successfully."
          : "Resource added successfully."
      );

      await refresh();
    } catch (err) {
      setError(err.message || "Unable to save your submission.");
    } finally {
      setBusy(false);
    }
  };

  
const viewMatches = async (request) => {
  if (!request?._id) {
    setError("This request has no valid ID.");
    return;
  }

  setSelected(request);
  setPage("matches");
  setMatches([]);
  setAiMatchingUsed(null);
  setError("");
  setNotice("");

  try {
    const data = await api(
      `/ai/matches/${encodeURIComponent(request._id)}`
    );

    setMatches(Array.isArray(data?.matches) ? data.matches : []);
    setAiMatchingUsed(data?.aiEnhanced === true);
  } catch (err) {
    setAiMatchingUsed(false);
    setError(err.message || "Unable to load AI recommendations.");
  }
};


  const allocateResource = async (request, match) => {
    const resource = match?.resource;
    if (!request?._id || !resource?._id || busy) return;

    const remainingNeed = Math.max(
      0,
      Number(request.quantity || 0) - Number(request.allocatedQuantity || 0)
    );
    const available = Number(match.availableQuantity ?? resource.quantity ?? 0);
    const suggested = Math.min(remainingNeed, available);
    const quantity = Number(
      allocationQuantities[resource._id] ?? suggested
    );

    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      setError("Enter a whole-number allocation quantity greater than zero.");
      return;
    }
    if (quantity > available || quantity > remainingNeed) {
      setError(`Choose no more than ${Math.min(available, remainingNeed)} units.`);
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const allocation = await api("/allocations", {
        method: "POST",
        body: JSON.stringify({
          requestId: request._id,
          resourceId: resource._id,
          quantity,
        }),
      });

      setNotice(
        `Successfully reserved ${quantity} unit${quantity === 1 ? "" : "s"} of ${resource.title}. ` +
        `${Number(allocation.remainingNeed) || 0} unit(s) still needed.`
      );
      setAllocationQuantities((old) => ({ ...old, [resource._id]: "" }));
      await refresh();
      const updated = await api(
  `/ai/matches/${encodeURIComponent(request._id)}`
);
      setMatches(Array.isArray(updated?.matches) ? updated.matches : []);
      setAiMatchingUsed(updated?.aiEnhanced === true);
      const updatedRequest = updated?.request || request;
      setSelected(updatedRequest);
    } catch (err) {
      setError(err.message || "Unable to allocate this resource.");
    } finally {
      setBusy(false);
    }
  };

  
async function cancelAllocation(allocation) {
  const confirmed = window.confirm(
    `Cancel the allocation of ${allocation.quantity} unit(s) of ${
      allocation.resourceTitle || "this resource"
    }? The stock will be restored if cancellation succeeds.`
  );

  if (!confirmed) return;

  setBusy(true);
  setError("");
  setNotice("");

  try {
    await api(`/allocations/${allocation._id}/cancel`, {
      method: "PATCH",
    });

    setNotice("Allocation cancelled successfully. Resource stock has been restored.");
    await refresh();
  } catch (err) {
    setError(err.message || "Failed to cancel allocation.");
  } finally {
    setBusy(false);
  }
}


  const changeStatus = async (request, status) => {
    if (!request?._id || busy) return;

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const updated = await api(
        `/requests/${encodeURIComponent(request._id)}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ status }),
        }
      );

      const updatedRequest = updated?.request || updated;

      if (!updatedRequest?._id) {
        throw new Error("The server did not return the updated request.");
      }

      setRequests((old) =>
        old.map((item) =>
          item._id === updatedRequest._id ? updatedRequest : item
        )
      );

      setSelected((current) =>
        current?._id === updatedRequest._id
          ? updatedRequest
          : current
      );

      setNotice(`Request status updated to ${status}.`);

      await refresh();

      if (page === "matches") {
        const data = await api(
          `/ai/matches/${encodeURIComponent(updatedRequest._id)}`
        );

        setMatches(Array.isArray(data?.matches) ? data.matches : []);
        setAiMatchingUsed(data?.aiEnhanced === true);
        setSelected(data?.request || updatedRequest);
      }
    } catch (err) {
      setError(err.message || "Unable to update the request status.");
    } finally {
      setBusy(false);
    }
  };

  const stats = [
    {
      label: "Total requests",
      value: dashboard.totalRequests ?? 0,
      icon: HandHeart,
      tone: "purple",
    },
    {
      label: "Open requests",
      value: dashboard.openRequests ?? 0,
      icon: Clock3,
      tone: "orange",
    },
    {
      label: "Resources available",
      value: dashboard.availableResources ?? 0,
      icon: Package,
      tone: "blue",
    },
    {
      label: "Needs fulfilled",
      value: dashboard.fulfilled ?? 0,
      icon: CheckCircle2,
      tone: "green",
    },
  ];

  const nav = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { id: "requests", label: "Community needs", icon: HandHeart },
  { id: "resources", label: "Resources", icon: Package },
  { id: "allocations", label: "Allocation history", icon: History },
  { id: "emergency", label: "Emergency mode", icon: Siren },
  { id: "map", label: "Community map", icon: MapPin },
];

  const activeEmergencyRequests = emergency.requests;
  
const impactMetrics = (() => {
  const totalRequests = requests.length;

  const fulfilledRequests = requests.filter(
    (request) => request.status === "Fulfilled"
  ).length;

  const allocatedUnits = allocations.reduce((total, allocation) => {
    if (allocation.status === "Cancelled") return total;

    return total + Math.max(0, Number(allocation.quantity) || 0);
  }, 0);

  const outstandingUnits = requests.reduce((total, request) => {
    if (request.status === "Fulfilled") return total;

    const quantity = Math.max(0, Number(request.quantity) || 0);
    const allocated = Math.max(
      0,
      Number(request.allocatedQuantity) || 0
    );

    return total + Math.max(0, quantity - allocated);
  }, 0);

  return {
    totalRequests,
    fulfilledRequests,
    allocatedUnits,
    outstandingUnits,
    fulfillmentRate:
      totalRequests > 0
        ? Math.round((fulfilledRequests / totalRequests) * 100)
        : 0,
  };
})();

const filteredAllocations = allocations.filter((allocation) => {
  const search = allocationSearch.trim().toLowerCase();

  const matchesSearch =
    !search ||
    [
      allocation.requestTitle,
      allocation.resourceTitle,
      allocation.location,
      allocation.requestId,
      allocation.resourceId,
      allocation.status,
    ].some((value) =>
      String(value || "").toLowerCase().includes(search)
    );

  const matchesStatus =
    allocationStatusFilter === "All" ||
    allocation.status === allocationStatusFilter;

  return matchesSearch && matchesStatus;
});


// const rankedMatches = [...matches]
//   .map((resource) => ({
//     ...resource,
//     humanovaMatch: rankResourceMatch(selected || {}, resource),
//   }))
//   .sort(
//     (a, b) =>
//       b.humanovaMatch.score - a.humanovaMatch.score
//   );


  const crisisAreas = buildCrisisRadar(activeEmergencyRequests);

  if (!authToken || !currentUser) {
    return (
      <div className="auth-shell">
        <section className="auth-visual">
          <div className="auth-brand"><span className="auth-brand-mark"><HeartHandshake size={26} /></span><span>humanova<span className="auth-dot">.</span></span></div>
          <div className="auth-hero-copy">
            <span className="auth-kicker">COMMUNITY IMPACT NETWORK</span>
            <h1>Small acts.<br /><em>Meaningful change.</em></h1>
            <p>Connect community needs with the resources and people ready to help.</p>
            <div className="auth-visual-points"><span><HandHeart size={17} /> Coordinate community needs</span><span><Package size={17} /> Put resources to good use</span><span><ShieldCheck size={17} /> Keep your workspace protected</span></div>
          </div>
          <div className="auth-visual-footer">A better way to support one another.</div>
        </section>
        <section className="auth-panel-wrap">
          <form className="auth-panel" onSubmit={submitAuth}>
            <span className="auth-kicker">WELCOME TO HUMANOVA</span>
            <h2>{authMode === "register" ? "Create your account" : "Welcome back"}</h2>
            <p className="auth-subtitle">{authMode === "register" ? "Join your community's resource network." : "Sign in to continue to your community workspace."}</p>
            {authError && <div className="auth-error" role="alert">{authError}</div>}
            
{authMode === "register" && (
  <>
    <label className="auth-field">
      Full name
      <input
        autoComplete="name"
        value={authForm.name}
        onChange={(e) =>
          setAuthForm((v) => ({ ...v, name: e.target.value }))
        }
        placeholder="Your full name"
        required
        minLength={2}
      />
    </label>

    <label className="auth-field">
      Phone number
      <input
        type="tel"
        autoComplete="tel"
        value={authForm.phone}
        onChange={(e) =>
          setAuthForm((v) => ({ ...v, phone: e.target.value }))
        }
        placeholder="Your phone number"
        required
      />
    </label>

    <label className="auth-field">
      Full address
      <input
        autoComplete="street-address"
        value={authForm.address}
        onChange={(e) =>
          setAuthForm((v) => ({ ...v, address: e.target.value }))
        }
        placeholder="House number, street or area"
        required
      />
    </label>

    <label className="auth-field">
      Locality / Town
      <input
        autoComplete="address-level2"
        value={authForm.locality}
        onChange={(e) =>
          setAuthForm((v) => ({ ...v, locality: e.target.value }))
        }
        placeholder="Your town or locality"
        required
      />
    </label>

    <label className="auth-field">
      Account type
      <select
        value={authForm.accountType}
        onChange={(e) =>
          setAuthForm((v) => ({
            ...v,
            accountType: e.target.value,
          }))
        }
        required
      >
        <option value="Individual">Individual / Person in need</option>
        <option value="Volunteer">Volunteer</option>
        <option value="NGO">NGO</option>
        <option value="Resource Provider">Resource Provider / Donor</option>
      </select>
    </label>
  </>
)}

            <label className="auth-field">Email address<input type="email" autoComplete="email" value={authForm.email} onChange={(e) => setAuthForm((v) => ({ ...v, email: e.target.value }))} placeholder="you@example.com" required /></label>
            <label className="auth-field">Password<input type="password" autoComplete={authMode === "register" ? "new-password" : "current-password"} value={authForm.password} onChange={(e) => setAuthForm((v) => ({ ...v, password: e.target.value }))} placeholder={authMode === "register" ? "At least 8 characters" : "Enter your password"} required minLength={authMode === "register" ? 8 : 1} /></label>
            <button className="btn primary auth-submit" type="submit" disabled={authBusy}>{authBusy ? "Please wait…" : authMode === "register" ? "Create account" : "Sign in"}<ArrowRight size={17} /></button>
            <p className="auth-switch">{authMode === "register" ? "Already have an account?" : "New to Humanova?"} <button type="button" onClick={() => { setAuthMode(authMode === "register" ? "login" : "register"); setAuthError(""); }}>{authMode === "register" ? "Sign in" : "Create an account"}</button></p>
            <p className="auth-security"><ShieldCheck size={14} /> Your account is protected with password hashing and signed sessions.</p>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <HeartHandshake size={25} />
          </div>
          <div>
            <h2>
              humanova<span>.</span>
            </h2>
            <p>COMMUNITY IMPACT NETWORK</p>
          </div>
        </div>

        <div className="workspace-label">WORKSPACE</div>

        <nav>
          {nav.map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${page === item.id ? "active" : ""}`}
                onClick={() => {
                  setPage(item.id);
                  setSelected(null);
                  setMatches([]);
                  setError("");
                  setNotice("");
                }}
              >
                <Icon size={19} />
                {item.label}
              </button>
            );
          })}

          <button
            type="button"
            className={`nav-item ${page === "matches" ? "active" : ""}`}
            onClick={() => {
              setPage("matches");
              setError("");
              setNotice("");
            }}
          >
            <BrainCircuit size={19} />
            Smart matching
          </button>

          <button
  type="button"
  className={`nav-item ${page === "profile" ? "active" : ""}`}
  onClick={() => setPage("profile")}
>
  <UserRound size={19} />
  <span>My Profile</span>
</button>
        </nav>

        
        <div className="sidebar-bottom">
          <div className="community-icon">
            <Users size={21} />
          </div>

          <strong>Stronger together.</strong>

          <p>
            Small acts of support create meaningful community impact.
          </p>

          <div className="connection">
            <span />
            API connected when available
          </div>

          <div className="signed-in-user">
            <span className="user-avatar">
              {(currentUser?.name || "U").slice(0, 1).toUpperCase()}
            </span>

            <span className="signed-in-copy">
              <strong>{currentUser?.name || "Community member"}</strong>
              <small>{currentUser?.email || "Signed in"}</small>
            </span>

            <button
    type="button"
    className="signout-button"
    onClick={signOut}
  >
    <X size={16} />

  </button>
          </div>
        </div>
      </aside>



      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="eyebrow">
              COMMUNITY RESOURCE COORDINATION
            </div>
            <h1>
              {page === "dashboard"
  ? "Community overview"
  : page === "requests"
    ? "Community needs"
    : page === "resources"
      ? "Available resources"
      : page === "allocations"
        ? "Allocation history"
        : page === "emergency"
          ? "Community Emergency Mode"
          : page === "map"
            ? "Community location map"
            : page === "profile"
              ? "My Profile"
              : "Intelligent matching"}
            </h1>
          </div>

          <button
            type="button"
            className="icon-button"
            title="Refresh data"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw size={18} />
          </button>
        </header>

        {error && (
          <div className="alert error" role="alert">
            <TriangleAlert size={18} />
            <span>{error}</span>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {notice && (
          <div className="alert success" role="status">
            <CheckCircle2 size={18} />
            <span>{notice}</span>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {page === "dashboard" && (
          <>
            <section className="welcome-panel">
              <div className="welcome-copy">
                <span className="pill">
                  <Sparkles size={14} />
                  COMMUNITY, CONNECTED
                </span>

                <h2>
                  Turn available resources
                  <br />
                  into meaningful impact.
                </h2>

                <p>
                  Connect unmet needs with the people and resources
                  ready to help.
                </p>

                <div className="welcome-actions">
                  <button
                    type="button"
                    className="btn light"
                    onClick={() => openForm("request")}
                  >
                    <Plus size={17} />
                    Request help
                  </button>

                  <button
                    type="button"
                    className="btn outline-light"
                    onClick={() => openForm("resource")}
                  >
                    Offer a resource
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>

              <div className="welcome-art">
                <HeartHandshake size={108} strokeWidth={1.2} />
              </div>
            </section>

            <section className="stats-grid">
              {stats.map((stat) => {
                const Icon = stat.icon;

                return (
                  <article className="stat-card" key={stat.label}>
                    <div className={`stat-icon ${stat.tone}`}>
                      <Icon size={21} />
                    </div>
                    <p>{stat.label}</p>
                    <h2>{loading ? "…" : stat.value}</h2>
                  </article>
                );
              })}
            </section>

            
<section className="impact-tracker panel">
  <div className="impact-tracker-header">
    <div>
      <span className="impact-tracker-eyebrow">
        <Activity size={15} />
        MEASURABLE COMMUNITY IMPACT
      </span>
      <h3>Every resource creates an impact.</h3>
      <p>
        A live summary of community needs and the resources
        coordinated through Humanova.
      </p>
    </div>

    <button
      type="button"
      className="impact-refresh"
      onClick={refresh}
      disabled={loading}
    >
      <RefreshCw size={15} />
      Refresh
    </button>
  </div>

  <div className="impact-metric-grid">
    <article className="impact-metric">
      <div className="impact-metric-icon impact-teal">
        <CheckCircle2 size={21} />
      </div>
      <span>Requests fulfilled</span>
      <strong>{loading ? "—" : impactMetrics.fulfilledRequests}</strong>
      <small>Confirmed as fulfilled</small>
    </article>

    <article className="impact-metric">
      <div className="impact-metric-icon impact-blue">
        <Package size={21} />
      </div>
      <span>Units allocated</span>
      <strong>{loading ? "—" : impactMetrics.allocatedUnits}</strong>
      <small>Reserved through allocations</small>
    </article>

    <article className="impact-metric">
      <div className="impact-metric-icon impact-purple">
        <Activity size={21} />
      </div>
      <span>Fulfillment rate</span>
      <strong>
        {loading ? "—" : `${impactMetrics.fulfillmentRate}%`}
      </strong>
      <small>Fulfilled requests / all requests</small>
    </article>

    <article className="impact-metric">
      <div className="impact-metric-icon impact-orange">
        <TriangleAlert size={21} />
      </div>
      <span>Outstanding units</span>
      <strong>{loading ? "—" : impactMetrics.outstandingUnits}</strong>
      <small>Quantity still needed</small>
    </article>
  </div>

  <div className="impact-progress-section">
    <div className="impact-progress-heading">
      <div>
        <strong>Community fulfillment progress</strong>
        <p>Requests marked as fulfilled</p>
      </div>
      <strong>{loading ? "—" : `${impactMetrics.fulfillmentRate}%`}</strong>
    </div>

    <div
      className="impact-progress-track"
      role="progressbar"
      aria-label="Community request fulfillment rate"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={impactMetrics.fulfillmentRate}
    >
      <div
        className="impact-progress-fill"
        style={{
          width: `${impactMetrics.fulfillmentRate}%`,
        }}
      />
    </div>

    <div className="impact-progress-footer">
      <span>
        {impactMetrics.fulfilledRequests} fulfilled
      </span>
      <span>
        {impactMetrics.totalRequests} total requests
      </span>
    </div>
  </div>
</section>


            <section className="content-grid">
              <div className="panel">
                <div className="panel-heading">
                  <div>
                    <h3>Needs seeking support</h3>
                    <p>Requests awaiting a solution</p>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setPage("requests")}
                  >
                    View all <ArrowRight size={15} />
                  </button>
                </div>

                <RequestList
                  items={requests
                    .filter((item) => item.status !== "Fulfilled")
                    .slice(0, 5)}
                  onMatches={viewMatches}
                  onStatus={changeStatus}
                  busy={busy}
                />
              </div>

              <div className="panel impact-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Community pulse</h3>
                    <p>Current coordination snapshot</p>
                  </div>
                  <Activity size={20} className="muted" />
                </div>

                <div className="pulse-row">
                  <span className="pulse-icon orange">
                    <TriangleAlert size={19} />
                  </span>
                  <div>
                    <strong>
                      {dashboard.urgentRequests ?? 0} priority needs
                    </strong>
                    <p>High or critical urgency, still unfulfilled</p>
                  </div>
                </div>

                <div className="pulse-row">
                  <span className="pulse-icon green">
                    <ShieldCheck size={19} />
                  </span>
                  <div>
                    <strong>
                      {dashboard.fulfilled ?? 0} needs fulfilled
                    </strong>
                    <p>Confirmed through the status workflow</p>
                  </div>
                </div>

                <div className="impact-note">
                  <Sparkles size={18} />
                  <p>
                    <strong>Humanova intelligence</strong>
                    <br />
                    Matching scores explain category, locality, urgency
                    and quantity compatibility.
                  </p>
                </div>
              </div>
            </section>
          </>
        )}

        {page === "map" && (
  <CommunityMap
    requests={requests}
    resources={resources}
  />
)}

        {page === "requests" && (
          <section className="panel page-panel">
            <div className="panel-heading">
              <div>
                <h3>All community requests</h3>
                <p>
                  Prioritize needs and discover possible matches.
                </p>
              </div>

              <button
                type="button"
                className="btn primary"
                onClick={() => openForm("request")}
              >
                <Plus size={17} />
                New request
              </button>
            </div>

            <RequestList
              items={requests}
              onMatches={viewMatches}
              onStatus={changeStatus}
              busy={busy}
            />
          </section>
        )}

        {page === "resources" && (
          <section className="panel page-panel">
            <div className="panel-heading">
              <div>
                <h3>Resource inventory</h3>
                <p>
                  Resources shared by donors and community members.
                </p>
              </div>

              <button
                type="button"
                className="btn primary"
                onClick={() => openForm("resource")}
              >
                <Plus size={17} />
                Add resource
              </button>
            </div>

            {resources.length === 0 ? (
              <EmptyState text="No resources yet. Add the first offer to get started." />
            ) : (
              <div className="resource-grid">
                {resources.map((resource) => (
                  <article
                    className="resource-card"
                    key={resource._id}
                  >
                    <div className="resource-symbol">
                      <Package size={22} />
                    </div>
                    <span className="category-label">
                      {resource.category}
                    </span>
                    <h3>{resource.title}</h3>
                    <p>
                      {resource.description ||
                        "Community resource offered to help meet local needs."}
                    </p>
                    <div className="resource-meta">
                      <MapPin size={15} />
                      {resource.location || "Location not specified"}
                    </div>
                    <div className="quantity-row">
                      <span>Quantity available</span>
                      <strong>{resource.quantity ?? 0}</strong>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {page === "allocations" && (
  <section className="panel page-panel">
    <div className="panel-heading">
      <div>
        <h3>Resource allocation history</h3>
        <p>
          Track which resources were reserved for community
          requests and monitor their status.
        </p>
      </div>

      <button
        type="button"
        className="btn primary"
        onClick={refresh}
        disabled={loading}
      >
        <RefreshCw size={16} />
        Refresh history
      </button>
    </div>

    <div className="allocation-history-summary">
      <div>
        <span>Total records</span>
        <strong>{allocations.length}</strong>
      </div>

      <div>
        <span>Reserved</span>
        <strong>
          {allocations.filter(
            (item) => item.status === "Reserved"
          ).length}
        </strong>
      </div>

      <div>
        <span>Cancelled</span>
        <strong>
          {allocations.filter(
            (item) => item.status === "Cancelled"
          ).length}
        </strong>
      </div>

      <div>
        <span>Units reserved</span>
        <strong>
          {allocations.reduce(
            (total, item) =>
              item.status === "Cancelled"
                ? total
                : total + Math.max(0, Number(item.quantity) || 0),
            0
          )}
        </strong>
      </div>
    </div>

    <div className="allocation-history-controls">
      <label className="allocation-search">
        <Search size={17} />
        <input
          type="search"
          placeholder="Search requests, resources, or locations..."
          value={allocationSearch}
          onChange={(event) =>
            setAllocationSearch(event.target.value)
          }
        />
      </label>

      <select
        aria-label="Filter allocations by status"
        value={allocationStatusFilter}
        onChange={(event) =>
          setAllocationStatusFilter(event.target.value)
        }
      >
        <option value="All">All statuses</option>
        <option value="Reserved">Reserved</option>
        <option value="Cancelled">Cancelled</option>
      </select>
    </div>

    {loading ? (
      <EmptyState text="Loading allocation history..." />
    ) : filteredAllocations.length === 0 ? (
      <EmptyState
        text={
          allocations.length === 0
            ? "No allocations yet. Allocate a compatible resource to see the record here."
            : "No allocations match your search or selected status."
        }
      />
    ) : (
      <div className="allocation-history-list">
        {filteredAllocations.map((allocation, index) => (
          <article
            className="allocation-history-card"
            key={allocation._id || allocation.id || index}
          >
            <div className="allocation-history-icon">
              <Package size={22} />
            </div>

            <div className="allocation-history-details">
              <div className="allocation-history-title">
                <h4>
                  {allocation.resourceTitle || "Resource"}
                </h4>

                <span
                  className={`allocation-status ${
                    allocation.status === "Cancelled"
                      ? "allocation-status-cancelled"
                      : "allocation-status-reserved"
                  }`}
                >
                  {allocation.status || "Unknown"}
                </span>
              </div>

              {allocation.status !== "Cancelled" && (
      <button
        type="button"
        className="btn btn-danger"
        disabled={busy}
        onClick={() => cancelAllocation(allocation)}
      >
        Cancel Allocation
      </button>
    )}

              <p>
                <strong>Request:</strong>{" "}
                {allocation.requestTitle || "Unnamed request"}
              </p>

              <p>
                <strong>Quantity:</strong>{" "}
                {Number(allocation.quantity) || 0} unit(s)
              </p>

              <p>
                <MapPin size={14} />
                {allocation.location || "Location not specified"}
              </p>

              <p>
                <CalendarDays size={14} />
                {formatAllocationDate(allocation.createdAt)}
              </p>

              <small>
                Allocation ID:{" "}
                {allocation._id || allocation.id || "Unavailable"}
              </small>
            </div>
          </article>
        ))}
      </div>
    )}
  </section>
)}

        {page === "matches" && (
          <section className="panel page-panel">
            <div className="panel-heading">
              <div>
                <h3>Smart resource matching</h3>
                <p>
                  Choose a request to see ranked resource recommendations.
                </p>
              </div>
            </div>

            <div className="request-picker">
              {requests
                .filter((item) =>
                  ["Open", "Matched", "Accepted"].includes(item.status)
                )
                .map((request) => (
                  <button
                    type="button"
                    key={request._id}
                    className={`picker-item ${
                      selected?._id === request._id ? "selected" : ""
                    }`}
                    onClick={() => viewMatches(request)}
                  >
                    <span>
                      <strong>{request.title}</strong>
                      <small>
                        {request.category} · {request.location}
                      </small>
                    </span>
                    <ArrowRight size={17} />
                  </button>
                ))}
            </div>

            {selected && (
              <div className="matches-section">
                <div className="selected-request">
                  <span
                    className={`urgency ${
                      selected.urgency?.toLowerCase() || "low"
                    }`}
                  >
                    {selected.urgency || "Low"} priority
                  </span>

                  <h3>{selected.title}</h3>
                  <p>
                    {Math.max(0, Number(selected.quantity || 0) - Number(selected.allocatedQuantity || 0))} units still needed · {Number(selected.allocatedQuantity || 0)} allocated · {selected.location} · {selected.category}
                  </p>
                  
<p>Status: {selected.status}</p>

<div
  className={`matching-status ${
    aiMatchingUsed === true
      ? "matching-status-ai"
      : aiMatchingUsed === false
        ? "matching-status-rules"
        : "matching-status-loading"
  }`}
>
  <BrainCircuit size={17} />
  <div>
    <strong>
      {aiMatchingUsed === true
        ? "AI-enhanced matching"
        : aiMatchingUsed === false
          ? "Standard matching"
          : "Checking matching method..."}
    </strong>
    <small>
      {aiMatchingUsed === true
        ? "The server reports that AI assistance was used to rank eligible resources."
        : aiMatchingUsed === false
          ? "The server reports that standard matching was used."
          : "Waiting for the matching response."}
    </small>
  </div>
</div>





                </div>

                {matches.length === 0 ? (
                  <EmptyState text={
                    Number(selected.quantity || 0) <= Number(selected.allocatedQuantity || 0)
                      ? "This request is fully allocated. No outstanding need remains."
                      : "No compatible resources yet. Add a non-expired resource in the same category and check again."
                  } />
                ) : (
                  matches.map((match, index) => {
                    const resource = match.resource;

if (!resource) return null;

const matchScore = Math.max(
  0,
  Math.min(100, Number(match.score) || 0)
);

const remainingNeed = Math.max(
  0,
  Number(selected.quantity || 0) -
    Number(selected.allocatedQuantity || 0)
);

const availableStock = Math.max(
  0,
  Number(match.availableQuantity ?? resource.quantity ?? 0)
);

const suggestedQuantity = Math.max(
  0,
  Math.min(
    Number(match.suggestedQuantity || 0),
    availableStock,
    remainingNeed
  )
);

const recommendation =
  matchScore >= 80
    ? "Excellent match"
    : matchScore >= 60
      ? "Good match"
      : matchScore >= 40
        ? "Partial match"
        : "Low compatibility";

                    return (
                      <article
                        className="match-card"
                        key={resource._id || index}
                      >
                        <div className="match-top">
                          <div className="resource-symbol">
                            <Package size={21} />
                          </div>

                          <div className="match-title">
                            <h3>{resource.title}</h3>
                            <p>
                              {resource.location} ·{" "}
                              {resource.quantity} available
                            </p>
                          </div>

                          <div className="score">
  <strong>{matchScore}%</strong>
  <span>match</span>
  <small className={`recommendation-label recommendation-${recommendation
    .toLowerCase()
    .replace(/\s+/g, "-")}`}>
    {recommendation}
  </small>
</div>
                        </div>

                         <div className="score-track">
                          <div
                            style={{
                              width: `${Math.max(
                                0,
                                Math.min(100, Number(match.score) || 0)
                              )}%`,
                            }}
                          />
                        </div>

                        <div className="match-fulfillment">
  <div className="match-fulfillment-heading">
    <span>Request coverage</span>
    <strong>
      {remainingNeed > 0
        ? `${Math.min(100, Math.round((suggestedQuantity / remainingNeed) * 100))}%`
        : "100%"}
    </strong>
  </div>

  <div className="match-fulfillment-track">
    <div
      style={{
        width: `${
          remainingNeed > 0
            ? Math.min(100, (suggestedQuantity / remainingNeed) * 100)
            : 100
        }%`,
      }}
    />
  </div>

  <p>
    Suggested allocation: <strong>{suggestedQuantity}</strong> units
    {" · "}
    Remaining need: <strong>{remainingNeed}</strong> units
    {" · "}
    Available stock: <strong>{availableStock}</strong> units
  </p>
</div>

                        <h4>
                          <BrainCircuit size={15} />
                          Why this match?
                        </h4>

                        <div className="reason-list">
                          {(Array.isArray(match.reasons)
                            ? match.reasons
                            : []
                          ).map((reason, reasonIndex) => (
                            <span key={`${reason}-${reasonIndex}`}>
                              <CheckCircle2 size={14} />
                              {reason}
                            </span>
                          ))}
                        </div>

                        {(match.aiReason || match.aiExplanation) && (
                          <div className="ai-match-reason">
                            <BrainCircuit size={17} />
                            <div>
                              <strong>AI recommendation</strong>
                              <p>{match.aiReason || match.aiExplanation}</p>
                            </div>
                          </div>
                        )}

                        <div className="allocation-action">
                          <label className="allocation-quantity">
                            <span>Units to allocate</span>
                            <input
                              type="number"
                              min="1"
                              max={Math.min(
                                Number(match.availableQuantity ?? resource.quantity ?? 0),
                                Math.max(0, Number(selected.quantity || 0) - Number(selected.allocatedQuantity || 0))
                              )}
                              value={allocationQuantities[resource._id] ?? String(match.suggestedQuantity || 1)}
                              onChange={(event) => setAllocationQuantities((old) => ({
                                ...old,
                                [resource._id]: event.target.value,
                              }))}
                              disabled={
  busy ||
  !["Open", "Matched", "Accepted"].includes(selected.status)
}
                            />
                          </label>
                          <button
                            type="button"
                            className="btn primary"
                            
disabled={
  busy ||
  !["Open", "Matched", "Accepted"].includes(selected.status) ||
  Number(match.availableQuantity ?? resource.quantity ?? 0) < 1 ||
  Number(selected.quantity || 0) <= Number(selected.allocatedQuantity || 0)
}

                            onClick={() => allocateResource(selected, match)}
                          >
                            <Package size={16} /> {busy ? "Allocating…" : "Allocate resource"}
                          </button>
                        </div>

                        {selected.status === "Open" && (
                          <button
                            type="button"
                            className="btn primary full"
                            disabled={busy}
                            onClick={() =>
                              changeStatus(selected, "Matched")
                            }
                          >
                            Select match <ArrowRight size={16} />
                          </button>
                        )}

                        {selected.status === "Matched" && (
                          <button
                            type="button"
                            className="btn primary full"
                            disabled={busy}
                            onClick={() =>
                              changeStatus(selected, "Accepted")
                            }
                          >
                            Accept match <CheckCircle2 size={16} />
                          </button>
                        )}

                        {selected.status === "Accepted" && (
                          <button
                            type="button"
                            className="btn primary full"
                            disabled={busy}
                            onClick={() =>
                              changeStatus(selected, "Fulfilled")
                            }
                          >
                            Confirm fulfillment{" "}
                            <CheckCircle2 size={16} />
                          </button>
                        )}
                      </article>
                    );
                  })
                )}
              </div>
            )}
          </section>
        )}

        {page === "profile" && (
          <section className="profile-page">
            <div className="panel-heading">
              <div>
                <h2>My Profile</h2>
                <p>Your account details and the community activity you have added.</p>
              </div>
              <button type="button" className="btn primary" onClick={() => {
                setPage("profile");
                setProfileLoading(true);
                setProfileError("");
                api("/profile/activity")
                  .then((data) => setProfileActivity({
                    resources: Array.isArray(data?.resources) ? data.resources : [],
                    requests: Array.isArray(data?.requests) ? data.requests : [],
                    summary: data?.summary || {},
                  }))
                  .catch((err) => setProfileError(err.message || "Could not refresh your activity."))
                  .finally(() => setProfileLoading(false));
              }} disabled={profileLoading}>
                <RefreshCw size={16} /> {profileLoading ? "Refreshing…" : "Refresh activity"}
              </button>
            </div>

            {profileError && <div className="alert error" role="alert">{profileError}</div>}

            <div className="profile-card">
              <div className="profile-details">
                <p><strong>Name:</strong> {currentUser?.name || "Not available"}</p>
                <p><strong>Email:</strong> {currentUser?.email || "Not available"}</p>
                <p><strong>Phone:</strong> {currentUser?.phone || "Not available"}</p>
                <p><strong>Address:</strong> {currentUser?.address || "Not available"}</p>
                <p><strong>Locality:</strong> {currentUser?.locality || "Not available"}</p>
                <p><strong>Account type:</strong> {currentUser?.accountType || "Not available"}</p>
              </div>
            </div>

            <div className="stats-grid profile-stats-grid">
              <article className="stat-card"><div className="stat-icon blue"><Package size={21} /></div><p>My resources</p><h2>{profileLoading ? "…" : (profileActivity.summary.totalResources ?? profileActivity.resources.length)}</h2></article>
              <article className="stat-card"><div className="stat-icon purple"><HandHeart size={21} /></div><p>My community needs</p><h2>{profileLoading ? "…" : (profileActivity.summary.totalRequests ?? profileActivity.requests.length)}</h2></article>
              <article className="stat-card"><div className="stat-icon orange"><Clock3 size={21} /></div><p>Open needs</p><h2>{profileLoading ? "…" : (profileActivity.summary.openRequests ?? profileActivity.requests.filter((item) => item.status === "Open").length)}</h2></article>
              <article className="stat-card"><div className="stat-icon green"><CheckCircle2 size={21} /></div><p>Fulfilled needs</p><h2>{profileLoading ? "…" : (profileActivity.summary.fulfilledRequests ?? profileActivity.requests.filter((item) => item.status === "Fulfilled").length)}</h2></article>
            </div>

            <section className="panel page-panel">
              <div className="panel-heading"><div><h3>Resources I added</h3><p>Only resources created by your account.</p></div><Package size={21} /></div>
              {profileLoading ? <EmptyState text="Loading your resources…" /> : profileActivity.resources.length === 0 ? <EmptyState text="You have not added any resources yet. Use Add resource to offer something to your community." /> : (
                <div className="resource-grid">
                  {profileActivity.resources.map((resource, index) => (
                    <article className="resource-card" key={resource._id || resource.id || index}>
                      <div className="resource-symbol"><Package size={22} /></div>
                      <span className="category-label">{resource.category || "Other"}</span>
                      <h3>{resource.title || "Untitled resource"}</h3>
                      <p>{resource.description || "Community resource offered to help meet local needs."}</p>
                      <div className="resource-meta"><MapPin size={15} />{resource.location || "Location not specified"}</div>
                      <div className="quantity-row"><span>Quantity available</span><strong>{resource.quantity ?? 0}</strong></div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="panel page-panel">
              <div className="panel-heading"><div><h3>Community needs I created</h3><p>Track the requests you submitted and their current status.</p></div><HandHeart size={21} /></div>
              {profileLoading ? <EmptyState text="Loading your community needs…" /> : profileActivity.requests.length === 0 ? <EmptyState text="You have not created any community needs yet." /> : (
                <div className="profile-activity-list">
                  {profileActivity.requests.map((request, index) => (
                    <article className="request-card" key={request._id || request.id || index}>
                      <div className="panel-heading">
                        <div><span className="category-label">{request.category || "Other"}</span><h3>{request.title || "Untitled community need"}</h3></div>
                        <span className={`request-status status-${String(request.status || "open").toLowerCase().replace(/\s+/g, "-")}`}>{request.status || "Open"}</span>
                      </div>
                      <p>{request.description || "No description provided."}</p>
                      <div className="resource-meta"><MapPin size={15} />{request.location || "Location not specified"}</div>
                      <div className="quantity-row"><span>Quantity needed</span><strong>{request.quantity ?? 0}</strong></div>
                      <div className="quantity-row"><span>Urgency</span><strong>{request.urgency || "Medium"}</strong></div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <button type="button" className="btn secondary" onClick={() => setPage("dashboard")}>Back to Dashboard</button>
          </section>
        )}

        {page === "emergency" && (
          <section className="emergency-page">
            <div className="emergency-banner">
              <div>
                <span className="emergency-eyebrow">
                  <Siren size={15} />
                  PRIORITY RESPONSE CENTER
                </span>

                <h2>Help where it matters most.</h2>
                <p>
                  Identify urgent needs, uncover resource shortages,
                  and coordinate support faster.
                </p>
              </div>

              <button
                type="button"
                className="btn light"
                onClick={refresh}
                disabled={loading}
              >
                <RefreshCw size={16} />
                {loading ? "Updating..." : "Refresh"}
              </button>
            </div>

            <div className="emergency-stats">
              <article className="emergency-stat critical-stat">
                <span>Critical needs</span>
                <strong>
                  {emergency.summary.criticalNeeds}
                </strong>
                <small>Highest urgency</small>
              </article>

              <article className="emergency-stat high-stat">
                <span>High priority</span>
                <strong>
                  {emergency.summary.highPriorityNeeds}
                </strong>
                <small>Needs requiring attention</small>
              </article>

              <article className="emergency-stat unmatched-stat">
                <span>Unmatched needs</span>
                <strong>
                  {emergency.summary.unmatchedNeeds}
                </strong>
                <small>
                  No same-category resources available
                </small>
              </article>

              <article className="emergency-stat partial-stat">
                <span>Partially covered</span>
                <strong>
                  {emergency.summary.partiallyCoveredNeeds}
                </strong>
                <small>Additional resources needed</small>
              </article>
            </div>

            
<div className="crisis-radar panel">
  <div className="crisis-radar-heading">
    <div>
      <span className="crisis-radar-eyebrow">
        <MapPin size={15} />
        COMMUNITY CRISIS RADAR
      </span>
      <h3>Where help is needed most</h3>
      <p>
        Areas ranked using outstanding requests, urgency,
        and currently uncovered needs.
      </p>
    </div>

    <div className="crisis-radar-count">
      <strong>{crisisAreas.length}</strong>
      <span>Areas monitored</span>
    </div>
  </div>

  {crisisAreas.length === 0 ? (
    <div className="crisis-radar-empty">
      <CheckCircle2 size={22} />
      <div>
        <strong>No outstanding community needs</strong>
        <p>New requests will appear here when submitted.</p>
      </div>
    </div>
  ) : (
    <div className="crisis-area-grid">
      {crisisAreas.map((area) => (
        <article
          className={`crisis-area-card crisis-${area.severity.toLowerCase()}`}
          key={area.location.toLowerCase()}
        >
          <div className="crisis-area-top">
            <div className="crisis-area-location">
              <MapPin size={17} />
              <h4>{area.location}</h4>
            </div>

            <span className={`crisis-severity crisis-severity-${area.severity.toLowerCase()}`}>
              {area.severity}
            </span>
          </div>

          <div className="crisis-area-metrics">
            <div>
              <strong>{area.totalNeeds}</strong>
              <span>Open needs</span>
            </div>
            <div>
              <strong>{area.outstandingUnits}</strong>
              <span>Units outstanding</span>
            </div>
          </div>

          <div className="crisis-area-breakdown">
            <span>
              <i className="crisis-dot critical-dot" />
              {area.criticalNeeds} critical
            </span>
            <span>
              <i className="crisis-dot high-dot" />
              {area.highPriorityNeeds} high priority
            </span>
            <span>
              <i className="crisis-dot missing-dot" />
              {area.unmatchedNeeds} unmatched
            </span>
          </div>

          <div className="crisis-area-footer">
            <span>
              {area.severity === "Critical"
                ? "Immediate attention recommended"
                : area.severity === "High"
                  ? "Additional support needed"
                  : "Monitor outstanding needs"}
            </span>

            {area.representativeRequest && (
              <button
                type="button"
                className="btn primary crisis-action"
                onClick={() => viewMatches(area.representativeRequest)}
              >
                Find resources
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  )}
</div>


            <div className="panel emergency-list-panel">
              <div className="panel-heading">
                <div>
                  <h3>Priority response queue</h3>
                  <p>
                    Critical needs appear first. Coverage is estimated
                    from current same-category resource quantities.
                  </p>
                </div>
                <Siren size={21} />
              </div>

              {loading && activeEmergencyRequests.length === 0 ? (
                <EmptyState text="Loading emergency response data..." />
              ) : activeEmergencyRequests.length === 0 ? (
                <EmptyState text="No active community needs. New requests will appear here automatically." />
              ) : (
                <div className="emergency-list">
                  {activeEmergencyRequests.map((item) => (
                    <article
                      className="emergency-request"
                      key={item._id}
                    >
                      <div className="emergency-request-top">
                        <div className="emergency-request-icon">
                          <TriangleAlert size={21} />
                        </div>

                        <div className="emergency-request-info">
                          <div className="emergency-tags">
                            <span
                              className={`urgency ${
                                item.urgency?.toLowerCase() || "low"
                              }`}
                            >
                              {item.urgency || "Low"} priority
                            </span>

                            <span
                              className={`coverage-tag ${
                                item.coverageStatus === "Unmatched"
                                  ? "coverage-missing"
                                  : item.coverageStatus ===
                                      "Partially covered"
                                    ? "coverage-partial"
                                    : "coverage-complete"
                              }`}
                            >
                              {item.coverageStatus || "Unknown coverage"}
                            </span>
                          </div>

                          <h4>{item.title}</h4>
                          <p>
                            {item.category} · {item.location} ·{" "}
                            {item.status}
                          </p>
                        </div>

                        <div className="priority-score">
                          <strong>{item.priorityScore}</strong>
                          <span>Priority score</span>
                        </div>
                      </div>

                      <div className="emergency-quantities">
                        <div>
                          <span>Needed</span>
                          <strong>{item.quantity}</strong>
                        </div>
                        <div>
                          <span>Available</span>
                          <strong>{item.availableQuantity}</strong>
                        </div>
                        <div>
                          <span>Shortage</span>
                          <strong>{item.shortage}</strong>
                        </div>
                      </div>

                      <div className="coverage-progress">
                        <div className="coverage-progress-label">
                          <span>Estimated coverage</span>
                          <strong>{item.coveragePercent}%</strong>
                        </div>

                        <div className="coverage-track">
                          <div
                            className="coverage-fill"
                            style={{
                              width: `${item.coveragePercent}%`,
                            }}
                          />
                        </div>
                      </div>

                      {item.matchingResources.length > 0 && (
                        <div className="emergency-resources">
                          <strong>
                            <Package size={15} />
                            Potential resources
                          </strong>

                          {item.matchingResources.map(
                            (resource, index) => (
                              <div
                                className="emergency-resource-item"
                                key={resource._id || index}
                              >
                                <span>{resource.title}</span>
                                <span>
                                  {resource.quantity} available ·{" "}
                                  {resource.location}
                                </span>
                              </div>
                            )
                          )}
                        </div>
                      )}

                      <div className="emergency-actions">
                        <button
                          type="button"
                          className="btn primary"
                          onClick={() => viewMatches(item)}
                        >
                          Find compatible matches
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        <footer>
          <span>HUMANOVA © 2026</span>
          <span>Community first. Impact always.</span>
        </footer>
      </main>

      {showForm && (
        <div
          className="modal-backdrop"
          onClick={() => !busy && setShowForm(null)}
        >
          <form
            className="modal"
            onClick={(event) => event.stopPropagation()}
            onSubmit={submitForm}
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">COMMUNITY IMPACT</span>
                <h2>
                  {showForm === "request"
                    ? "Request community support"
                    : "Offer a resource"}
                </h2>
              </div>

              <button
                type="button"
                className="icon-button"
                disabled={busy}
                aria-label="Close form"
                onClick={() => setShowForm(null)}
              >
                <X size={20} />
              </button>
            </div>

            <Field label="Title">
              <input
                required
                maxLength={100}
                placeholder="e.g. Meal packets for 20 people"
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
              />
            </Field>

            <Field label="Category">
              <select
                value={form.category}
                onChange={(event) =>
                  setForm({ ...form, category: event.target.value })
                }
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </Field>

            <div className="form-row">
              <Field label="Quantity">
                <input
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  required
                  value={form.quantity}
                  onChange={(event) =>
                    setForm({ ...form, quantity: event.target.value })
                  }
                />
              </Field>

              <Field label="Locality">
                <input
                  required
                  maxLength={100}
                  placeholder="e.g. Kadwad"
                  value={form.location}
                  onChange={(event) =>
                    setForm({ ...form, location: event.target.value })
                  }
                />
              </Field>
            </div>

            {showForm === "request" && (
              <Field label="Urgency">
                <select
                  value={form.urgency}
                  onChange={(event) =>
                    setForm({ ...form, urgency: event.target.value })
                  }
                >
                  {URGENCIES.map((urgency) => (
                    <option key={urgency} value={urgency}>
                      {urgency}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Description (optional)">
              <textarea
                rows="3"
                maxLength={500}
                placeholder="Add useful context..."
                value={form.description}
                onChange={(event) =>
                  setForm({
                    ...form,
                    description: event.target.value,
                  })
                }
              />
            </Field>

            
{showForm === "request" && (
  <section className="ai-analysis-panel">
    <div className="ai-analysis-heading">
      <span className="ai-analysis-icon">
        <BrainCircuit size={21} />
      </span>
      <div>
        <h3>AI Need Analysis</h3>
        <p>
          Analyze the request for suggested category, urgency,
          and recommended actions.
        </p>
      </div>
    </div>

    <button
      type="button"
      className="btn primary ai-analyze-button"
      onClick={analyzeNeedWithAI}
      disabled={aiLoading || busy}
    >
      <Sparkles size={17} />
      {aiLoading ? "Analyzing request..." : "Analyze with AI"}
    </button>

    {aiLoading && (
      <p className="ai-analysis-loading">
        <RefreshCw size={16} />
        Reviewing the need and preparing recommendations...
      </p>
    )}

    {aiAnalysis && (
      <div className="ai-analysis-result">
        <div className="ai-analysis-result-heading">
          <CheckCircle2 size={19} />
          <h4>Analysis and recommendations</h4>
        </div>

        <div className="ai-suggestion-grid">
          {aiAnalysis.suggestedCategory && (
            <div className="ai-suggestion">
              <span>Suggested category</span>
              <strong>{aiAnalysis.suggestedCategory}</strong>
            </div>
          )}

          {aiAnalysis.suggestedUrgency && (
            <div className="ai-suggestion">
              <span>Suggested urgency</span>
              <strong>{aiAnalysis.suggestedUrgency}</strong>
            </div>
          )}
        </div>

        {(aiAnalysis.summary || aiAnalysis.needSummary ||
          aiAnalysis.analysis || aiAnalysis.reason) && (
          <div className="ai-analysis-copy">
            <strong>Need summary and reasoning</strong>
            <p>
              {aiAnalysis.summary || aiAnalysis.needSummary ||
                aiAnalysis.analysis || aiAnalysis.reason}
            </p>
          </div>
        )}

        {(aiAnalysis.suggestedActions || aiAnalysis.recommendations ||
          aiAnalysis.recommendedActions) && (
          <div className="ai-analysis-copy">
            <strong>Recommended actions</strong>
            {Array.isArray(
              aiAnalysis.suggestedActions || aiAnalysis.recommendations ||
              aiAnalysis.recommendedActions
            ) ? (
              <ul>
                {(aiAnalysis.suggestedActions || aiAnalysis.recommendations ||
                  aiAnalysis.recommendedActions).map((item, index) => (
                  <li key={`${index}-${String(item)}`}>
                    {typeof item === "string"
                      ? item
                      : item.title || item.description || JSON.stringify(item)}
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                {String(aiAnalysis.suggestedActions || aiAnalysis.recommendations ||
                  aiAnalysis.recommendedActions)}
              </p>
            )}
          </div>
        )}

        {(aiAnalysis.missingInformation || aiAnalysis.missingDetails) && (
          <div className="ai-analysis-copy">
            <strong>Information to check</strong>
            <p>
              {Array.isArray(aiAnalysis.missingInformation || aiAnalysis.missingDetails)
                ? (aiAnalysis.missingInformation || aiAnalysis.missingDetails).join(", ")
                : String(aiAnalysis.missingInformation || aiAnalysis.missingDetails)}
            </p>
          </div>
        )}

        <button
          type="button"
          className="btn primary"
          onClick={applyAIRecommendations}
        >
          <CheckCircle2 size={16} />
          Apply AI suggestions
        </button>

        <p className="ai-analysis-disclaimer">
          Review AI suggestions before submitting. They do not
          replace human verification of community needs.
        </p>
      </div>
    )}
  </section>
)}


            <button
              type="submit"
              className="btn primary full"
              disabled={busy}
            >
              {busy ? "Saving..." : "Submit"}
              <ArrowRight size={17} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function RequestList({ items, onMatches, onStatus, busy }) {
  if (!items.length) {
    return (
      <EmptyState text="Nothing here yet. Create a request to start coordinating community support." />
    );
  }

  return (
    <div className="request-list">
      {items.map((item) => (
        <article className="request-row" key={item._id}>
          <div className="request-symbol">
            <HandHeart size={20} />
          </div>

          <div className="request-info">
            <h4>{item.title}</h4>
            <p>
              {item.category} · {item.quantity} needed ·{" "}
              <MapPin size={13} />
              {item.location}
            </p>

            <div className="row-tags">
              <span
                className={`urgency ${
                  item.urgency?.toLowerCase() || "low"
                }`}
              >
                {item.urgency || "Low"}
              </span>
              <span className="status-tag">{item.status}</span>
            </div>
          </div>

          <div className="row-actions">
            {item.status === "Open" && (
              <button
                type="button"
                className="small-action"
                onClick={() => onMatches(item)}
              >
                Find match
              </button>
            )}

            {item.status === "Matched" && (
              <button
                type="button"
                disabled={busy}
                className="small-action"
                onClick={() => onStatus(item, "Accepted")}
              >
                Accept
              </button>
            )}

            {item.status === "Accepted" && (
              <button
                type="button"
                disabled={busy}
                className="small-action"
                onClick={() => onStatus(item, "Fulfilled")}
              >
                Fulfill
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="empty-state">
      <Package size={28} />
      <p>{text}</p>
    </div>
  );
}

export default App;