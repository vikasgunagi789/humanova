
import { useCallback, useEffect, useState } from "react";
import {
  Activity, ArrowRight, BrainCircuit, CheckCircle2,
  Clock3, HandHeart, HeartHandshake, LayoutDashboard,
  MapPin, Package, Plus, RefreshCw, ShieldCheck,
  Sparkles, TriangleAlert, Users, X
} from "lucide-react";
import "./index.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const CATEGORIES = [
  "Food", "Clothing", "Education", "Medical",
  "Shelter", "Transport", "Volunteers", "Other"
];
const URGENCIES = ["Low", "Medium", "High", "Critical"];

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function Field({ label, children }) {
  return <label className="field">
    <span>{label}</span>
    {children}
  </label>;
}

function App() {
  const [page, setPage] = useState("dashboard");
  const [dashboard, setDashboard] = useState({});
  const [requests, setRequests] = useState([]);
  const [resources, setResources] = useState([]);
  const [selected, setSelected] = useState(null);
  const [matches, setMatches] = useState([]);
  const [showForm, setShowForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [form, setForm] = useState({
    title: "", description: "", category: "Food",
    quantity: 1, location: "", urgency: "Medium"
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [d, r, inventory] = await Promise.all([
        api("/dashboard"),
        api("/requests"),
        api("/resources")
      ]);
      setDashboard(d);
      setRequests(r);
      setResources(inventory);
      setSelected(old =>
        old ? (r.find(item => item._id === old._id) || null) : null
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const openForm = type => {
    setForm({
      title: "",
      description: "",
      category: type === "request" ? "Food" : "Food",
      quantity: 1,
      location: "",
      urgency: "Medium"
    });
    setShowForm(type);
    setNotice("");
    setError("");
  };

  const submitForm = async event => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const path = showForm === "request" ? "/requests" : "/resources";
      await api(path, {
        method: "POST",
        body: JSON.stringify({
          ...form,
          quantity: Number(form.quantity)
        })
      });
      setShowForm(null);
      setNotice(
        showForm === "request"
          ? "Community request created successfully."
          : "Resource added successfully."
      );
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const viewMatches = async request => {
    setSelected(request);
    setPage("matches");
    setError("");
    try {
      const data = await api(`/matches/${request._id}`);
      setMatches(data.matches || []);
    } catch (err) {
      setError(err.message);
      setMatches([]);
    }
  };

  const changeStatus = async (request, status) => {
    setBusy(true);
    setError("");
    try {
      const updated = await api(`/requests/${request._id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      setRequests(old =>
        old.map(item => item._id === updated._id ? updated : item)
      );
      setSelected(updated);
      setNotice(`Request status updated to ${status}.`);
      await refresh();
      if (page === "matches") {
        const data = await api(`/matches/${updated._id}`);
        setMatches(data.matches || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const stats = [
    {
      label: "Total requests",
      value: dashboard.totalRequests ?? 0,
      icon: HandHeart,
      tone: "purple"
    },
    {
      label: "Open requests",
      value: dashboard.openRequests ?? 0,
      icon: Clock3,
      tone: "orange"
    },
    {
      label: "Resources available",
      value: dashboard.availableResources ?? 0,
      icon: Package,
      tone: "blue"
    },
    {
      label: "Needs fulfilled",
      value: dashboard.fulfilled ?? 0,
      icon: CheckCircle2,
      tone: "green"
    }
  ];

  const nav = [
    { id: "dashboard", label: "Overview", icon: LayoutDashboard },
    { id: "requests", label: "Community needs", icon: HandHeart },
    { id: "resources", label: "Resources", icon: Package }
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><HeartHandshake size={25}/></div>
          <div>
            <h2>humanova<span>.</span></h2>
            <p>COMMUNITY IMPACT NETWORK</p>
          </div>
        </div>

        <div className="workspace-label">WORKSPACE</div>
        <nav>
          {nav.map(item => {
            const Icon = item.icon;
            return <button
              key={item.id}
              className={`nav-item ${page === item.id ? "active" : ""}`}
              onClick={() => {
                setPage(item.id);
                setSelected(null);
                setError("");
              }}
            >
              <Icon size={19}/>{item.label}
            </button>;
          })}
          <button
            className={`nav-item ${page === "matches" ? "active" : ""}`}
            onClick={() => setPage("matches")}
          >
            <BrainCircuit size={19}/> Smart matching
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="community-icon"><Users size={21}/></div>
          <strong>Stronger together.</strong>
          <p>Small acts of support create meaningful community impact.</p>
          <div className="connection"><span/> API connected when available</div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="eyebrow">COMMUNITY RESOURCE COORDINATION</div>
            <h1>
              {page === "dashboard" ? "Community overview" :
               page === "requests" ? "Community needs" :
               page === "resources" ? "Available resources" :
               "Intelligent matching"}
            </h1>
          </div>
          <button className="icon-button" title="Refresh data" onClick={refresh}>
            <RefreshCw size={18}/>
          </button>
        </header>

        {error && <div className="alert error"><TriangleAlert size={18}/>{error}
          <button onClick={() => setError("")}><X size={16}/></button>
        </div>}
        {notice && <div className="alert success"><CheckCircle2 size={18}/>{notice}
          <button onClick={() => setNotice("")}><X size={16}/></button>
        </div>}

        {page === "dashboard" && <>
          <section className="welcome-panel">
            <div className="welcome-copy">
              <span className="pill"><Sparkles size={14}/> COMMUNITY, CONNECTED</span>
              <h2>Turn available resources<br/>into meaningful impact.</h2>
              <p>Connect unmet needs with the people and resources ready to help.</p>
              <div className="welcome-actions">
                <button className="btn light" onClick={() => openForm("request")}>
                  <Plus size={17}/> Request help
                </button>
                <button className="btn outline-light" onClick={() => openForm("resource")}>
                  Offer a resource <ArrowRight size={16}/>
                </button>
              </div>
            </div>
            <div className="welcome-art"><HeartHandshake size={108} strokeWidth={1.2}/></div>
          </section>

          <section className="stats-grid">
            {stats.map(stat => {
              const Icon = stat.icon;
              return <article className="stat-card" key={stat.label}>
                <div className={`stat-icon ${stat.tone}`}><Icon size={21}/></div>
                <p>{stat.label}</p>
                <h2>{loading ? "…" : stat.value}</h2>
              </article>;
            })}
          </section>

          <section className="content-grid">
            <div className="panel">
              <div className="panel-heading">
                <div><h3>Needs seeking support</h3><p>Requests awaiting a solution</p></div>
                <button className="text-button" onClick={() => setPage("requests")}>View all <ArrowRight size={15}/></button>
              </div>
              <RequestList
                items={requests.filter(r => r.status !== "Fulfilled").slice(0, 5)}
                onMatches={viewMatches}
                onStatus={changeStatus}
                busy={busy}
              />
            </div>
            <div className="panel impact-panel">
              <div className="panel-heading">
                <div><h3>Community pulse</h3><p>Current coordination snapshot</p></div>
                <Activity size={20} className="muted"/>
              </div>
              <div className="pulse-row">
                <span className="pulse-icon orange"><TriangleAlert size={19}/></span>
                <div><strong>{dashboard.urgentRequests ?? 0} priority needs</strong><p>High or critical urgency, still unfulfilled</p></div>
              </div>
              <div className="pulse-row">
                <span className="pulse-icon green"><ShieldCheck size={19}/></span>
                <div><strong>{dashboard.fulfilled ?? 0} needs fulfilled</strong><p>Confirmed through the status workflow</p></div>
              </div>
              <div className="impact-note">
                <Sparkles size={18}/>
                <p><strong>Humanova intelligence</strong><br/>Matching scores explain category, locality, urgency and quantity compatibility.</p>
              </div>
            </div>
          </section>
        </>}

        {page === "requests" && <section className="panel page-panel">
          <div className="panel-heading">
            <div><h3>All community requests</h3><p>Prioritize needs and discover possible matches.</p></div>
            <button className="btn primary" onClick={() => openForm("request")}><Plus size={17}/> New request</button>
          </div>
          <RequestList items={requests} onMatches={viewMatches} onStatus={changeStatus} busy={busy}/>
        </section>}

        {page === "resources" && <section className="panel page-panel">
          <div className="panel-heading">
            <div><h3>Resource inventory</h3><p>Resources shared by donors and community members.</p></div>
            <button className="btn primary" onClick={() => openForm("resource")}><Plus size={17}/> Add resource</button>
          </div>
          {resources.length === 0 ? <EmptyState text="No resources yet. Add the first offer to get started."/> :
            <div className="resource-grid">{resources.map(resource =>
              <article className="resource-card" key={resource._id}>
                <div className="resource-symbol"><Package size={22}/></div>
                <span className="category-label">{resource.category}</span>
                <h3>{resource.title}</h3>
                <p>{resource.description || "Community resource offered to help meet local needs."}</p>
                <div className="resource-meta"><MapPin size={15}/>{resource.location}</div>
                <div className="quantity-row"><span>Quantity available</span><strong>{resource.quantity}</strong></div>
              </article>
            )}</div>
          }
        </section>}

        {page === "matches" && <section className="panel page-panel">
          <div className="panel-heading">
            <div><h3>Smart resource matching</h3><p>Choose a request to see ranked resource recommendations.</p></div>
          </div>
          <div className="request-picker">
            {requests.filter(r => r.status === "Open").map(r =>
              <button
                key={r._id}
                className={`picker-item ${selected?._id === r._id ? "selected" : ""}`}
                onClick={() => viewMatches(r)}
              >
                <span><strong>{r.title}</strong><small>{r.category} · {r.location}</small></span>
                <ArrowRight size={17}/>
              </button>
            )}
          </div>
          {selected && <div className="matches-section">
            <div className="selected-request">
              <span className={`urgency ${selected.urgency?.toLowerCase()}`}>{selected.urgency} priority</span>
              <h3>{selected.title}</h3>
              <p>{selected.quantity} needed · {selected.location} · {selected.category}</p>
            </div>
            {matches.length === 0 ? <EmptyState text="No compatible resources yet. Ask a teammate to add a resource in the same category."/> :
              matches.map(match => <article className="match-card" key={match.resource._id}>
                <div className="match-top">
                  <div className="resource-symbol"><Package size={21}/></div>
                  <div className="match-title"><h3>{match.resource.title}</h3><p>{match.resource.location} · {match.resource.quantity} available</p></div>
                  <div className="score"><strong>{match.score}%</strong><span>match</span></div>
                </div>
                <div className="score-track"><div style={{width:`${match.score}%`}}/></div>
                <h4><BrainCircuit size={15}/> Why this match?</h4>
                <div className="reason-list">{match.reasons.map(reason =>
                  <span key={reason}><CheckCircle2 size={14}/>{reason}</span>
                )}</div>
                {selected.status === "Open" && <button className="btn primary full" disabled={busy} onClick={() => changeStatus(selected, "Matched")}>Select match <ArrowRight size={16}/></button>}
                {selected.status === "Matched" && <button className="btn primary full" disabled={busy} onClick={() => changeStatus(selected, "Accepted")}>Accept match <CheckCircle2 size={16}/></button>}
                {selected.status === "Accepted" && <button className="btn primary full" disabled={busy} onClick={() => changeStatus(selected, "Fulfilled")}>Confirm fulfillment <CheckCircle2 size={16}/></button>}
              </article>)
            }
          </div>}
        </section>}

        <footer><span>HUMANOVA © 2026</span><span>Community first. Impact always.</span></footer>
      </main>

      {showForm && <div className="modal-backdrop" onClick={() => setShowForm(null)}>
        <form className="modal" onClick={e => e.stopPropagation()} onSubmit={submitForm}>
          <div className="modal-heading">
            <div><span className="eyebrow">COMMUNITY IMPACT</span>
              <h2>{showForm === "request" ? "Request community support" : "Offer a resource"}</h2>
            </div>
            <button type="button" className="icon-button" onClick={() => setShowForm(null)}><X size={20}/></button>
          </div>
          <Field label="Title">
            <input required maxLength={100} placeholder="e.g. Meal packets for 20 people" value={form.title} onChange={e => setForm({...form, title:e.target.value})}/>
          </Field>
          <Field label="Category">
            <select value={form.category} onChange={e => setForm({...form, category:e.target.value})}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <div className="form-row">
            <Field label="Quantity">
              <input type="number" min="1" max="100000" required value={form.quantity} onChange={e => setForm({...form, quantity:e.target.value})}/>
            </Field>
            <Field label="Locality">
              <input required maxLength={100} placeholder="e.g. Kadwad" value={form.location} onChange={e => setForm({...form, location:e.target.value})}/>
            </Field>
          </div>
          {showForm === "request" && <Field label="Urgency">
            <select value={form.urgency} onChange={e => setForm({...form, urgency:e.target.value})}>
              {URGENCIES.map(u => <option key={u}>{u}</option>)}
            </select>
          </Field>}
          <Field label="Description (optional)">
            <textarea rows="3" maxLength={500} placeholder="Add useful context..." value={form.description} onChange={e => setForm({...form, description:e.target.value})}/>
          </Field>
          <button className="btn primary full" disabled={busy}>{busy ? "Saving..." : "Submit"} <ArrowRight size={17}/></button>
        </form>
      </div>}
    </div>
  );
}

function RequestList({ items, onMatches, onStatus, busy }) {
  if (!items.length) return <EmptyState text="Nothing here yet. Create a request to start coordinating community support."/>;
  return <div className="request-list">{items.map(item =>
    <article className="request-row" key={item._id}>
      <div className="request-symbol"><HandHeart size={20}/></div>
      <div className="request-info">
        <h4>{item.title}</h4>
        <p>{item.category} · {item.quantity} needed · <MapPin size={13}/>{item.location}</p>
        <div className="row-tags">
          <span className={`urgency ${item.urgency?.toLowerCase()}`}>{item.urgency}</span>
          <span className="status-tag">{item.status}</span>
        </div>
      </div>
      <div className="row-actions">
        {item.status === "Open" && <button className="small-action" onClick={() => onMatches(item)}>Find match</button>}
        {item.status === "Matched" && <button disabled={busy} className="small-action" onClick={() => onStatus(item,"Accepted")}>Accept</button>}
        {item.status === "Accepted" && <button disabled={busy} className="small-action" onClick={() => onStatus(item,"Fulfilled")}>Fulfill</button>}
      </div>
    </article>
  )}</div>;
}

function EmptyState({ text }) {
  return <div className="empty-state"><Package size={28}/><p>{text}</p></div>;
}

export default App;
