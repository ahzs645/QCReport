import React, { useEffect, useState } from "react";
import QcResultsView from "./views/QcResultsView.jsx";
import ControlChartView from "./views/ControlChartView.jsx";
import PresetsView from "./views/PresetsView.jsx";
import EwsParserView from "./views/EwsParserView.jsx";

const TABS = [
  { id: "qc", label: "Quality Check & Results" },
  { id: "control", label: "Control Charts" },
  { id: "ews", label: "EWS Parser" },
  { id: "presets", label: "Presets" },
];

const tabFromHash = () => {
  const h = window.location.hash.replace(/^#\/?/, "");
  return TABS.some((t) => t.id === h) ? h : "qc";
};

export default function App() {
  const [tab, setTab] = useState(tabFromHash);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (id) => {
    window.location.hash = id === "qc" ? "" : `/${id}`;
    setTab(id);
  };

  return (
    <div className="app">
      <header>
        <h1>NALS Water — Lab Tools</h1>
        <p className="byline">Runs entirely in your browser — no server, no upload.</p>
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => go(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === "qc" && <QcResultsView />}
      {tab === "control" && <ControlChartView />}
      {tab === "ews" && <EwsParserView />}
      {tab === "presets" && <PresetsView />}
    </div>
  );
}
