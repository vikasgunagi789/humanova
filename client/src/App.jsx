
import { useCallback, useEffect, useState } from "react";
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

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function App() {
  // All React hooks belong inside the component.
  const [page, setPage] = useState("dashboard");
  const [dashboard, setDashboard] = useState({});
  const [requests, setRequests] = useState([]);
  const [resources, setResources] = useState([]);
  const [emergency, setEmergency] = useState(EMPTY_EMERGENCY);
  const [selected, setSelected] = useState(null);
  const [matches, setMatches] = useState([]);
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
    refresh();
  }, [refresh]);

  const openForm = (type) => {
    setForm({ ...EMPTY_FORM });
    setShowForm(type);
    setNotice("");
    setError("");
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
    setError("");

    try {
      const data = await api(
        `/matches/${encodeURIComponent(request._id)}`
      );

      setMatches(Array.isArray(data?.matches) ? data.matches : []);
    } catch (err) {
      setError(err.message || "Unable to load matching resources.");
    }
  };

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
          `/matches/${encodeURIComponent(updatedRequest._id)}`
        );

        setMatches(Array.isArray(data?.matches) ? data.matches : []);
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
    { id: "emergency", label: "Emergency mode", icon: Siren },
  ];

  const activeEmergencyRequests = emergency.requests;

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
                    : page === "emergency"
                      ? "Community Emergency Mode"
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
                    {selected.quantity} needed · {selected.location} ·{" "}
                    {selected.category}
                  </p>
                  <p>Status: {selected.status}</p>
                </div>

                {matches.length === 0 ? (
                  <EmptyState text="No compatible resources yet. Add a resource in the same category and check again." />
                ) : (
                  matches.map((match, index) => {
                    const resource = match.resource;

                    if (!resource) return null;

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
                            <strong>
                              {Math.max(
                                0,
                                Math.min(100, Number(match.score) || 0)
                              )}
                              %
                            </strong>
                            <span>match</span>
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
