import React, { useState } from "react";
import QcResultsView from "./views/QcResultsView.jsx";
import ControlChartView from "./views/ControlChartView.jsx";

const TABS = [
  { id: "qc", label: "Quality Check & Results" },
  { id: "control", label: "Control Charts" },
];

export default function App() {
  const [tab, setTab] = useState("qc");
  return (
    <div className="app">
      <header>
        <h1>NALS Water — Lab Tools</h1>
        <p className="byline">Runs entirely in your browser — no server, no upload.</p>
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === "qc" ? <QcResultsView /> : <ControlChartView />}
    </div>
  );
}
