import React, { useMemo, useState } from "react";
import DropZone from "../components/DropZone.jsx";
import ControlChart from "../components/ControlChart.jsx";
import { CHART_STYLES, loadChartStyle, saveChartStyle } from "../components/charts.js";
import { extractLfbFromRun, loadControlChartFile, parsePasted, seriesFor } from "../core/control.js";

const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export default function ControlChartView() {
  const [rawData, setRawData] = useState(null);
  const [elements, setElements] = useState([]);
  const [element, setElement] = useState(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [runPoints, setRunPoints] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [showLine, setShowLine] = useState(false);
  const [chartStyle, setChartStyle] = useState(loadChartStyle);

  const chooseChartStyle = (id) => { setChartStyle(id); saveChartStyle(id); };

  // Apply a freshly-loaded dataset (from a file or pasted text).
  function applyData(rd, chartedElements) {
    setRawData(rd);
    const labelled = chartedElements.filter((e) => e.label);
    setElements(labelled);
    setElement(labelled[0]?.label || null);
    const dates = rd.batches.map((b) => b.date).filter(Boolean).map((d) => new Date(d));
    if (dates.length) {
      setFrom(iso(new Date(Math.min(...dates))));
      setTo(iso(new Date(Math.max(...dates))));
    }
  }

  function loadPasted() {
    setError(null);
    try {
      const { rawData: rd, chartedElements } = parsePasted(pasteText);
      applyData(rd, chartedElements);
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  async function handleFiles(files) {
    setBusy(true);
    setError(null);
    try {
      const newRuns = [];
      for (const f of files) {
        try {
          const { rawData: rd, chartedElements } = await loadControlChartFile(f);
          applyData(rd, chartedElements);
        } catch {
          const rp = await extractLfbFromRun(f);
          if (rp.found) newRuns.push(rp);
          else throw new Error(`${f.name}: not a control-chart workbook and no Digest LFB row found.`);
        }
      }
      if (newRuns.length) setRunPoints((prev) => [...prev, ...newRuns]);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const series = useMemo(() => {
    if (!rawData || !element) return null;
    return seriesFor(rawData, element, { from: from || null, to: to || null, runPoints });
  }, [rawData, element, from, to, runPoints]);

  const elementName = elements.find((e) => e.label === element)?.name || element;

  return (
    <>
      <p className="sub">
        Control-chart trending utility. Load a Digest-LFB ControlChart workbook (its full history),
        choose an element and time period, and view the Shewhart chart. Drop raw ICPOES runs too to
        add their LFB as new points.
      </p>
      <DropZone
        onFiles={handleFiles}
        status={busy ? "working" : "idle"}
        label="Drop the ControlChart workbook here"
        hint="…and optionally raw ICPOES runs to append new LFB points."
      />
      <details className="paste-box">
        <summary>…or paste RAW DATA (copy the rows from Excel)</summary>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={"ICPOES (Unadjusted Data)\tAg 328.068 nm\tAl 396.152 nm\t…\nExcel File\tDate\tComment\tConc. (mg/L)\t…\n2025NALS…\tFebruary 4, 2025\t2025NALS… A02\t0.0231\t0.0942\t…"}
          rows={6}
          spellCheck={false}
        />
        <button onClick={loadPasted} disabled={!pasteText.trim()}>Load pasted data</button>
      </details>
      {error && <div className="error">⚠ {error}</div>}

      {rawData && (
        <>
          <div className="cc-controls">
            <label>
              Element{" "}
              <select value={element || ""} onChange={(e) => setElement(e.target.value)}>
                {elements.map((el) => (
                  <option key={el.label} value={el.label}>{el.name} ({el.label})</option>
                ))}
              </select>
            </label>
            <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <label className="toggle">
              <input type="checkbox" checked={showLine} onChange={(e) => setShowLine(e.target.checked)} /> Connect points
            </label>
            <label className="toggle">
              Chart style
              <span className="seg" style={{ marginLeft: 6 }}>
                {CHART_STYLES.map((s) => (
                  <button key={s.id} className={chartStyle === s.id ? "on" : ""} onClick={() => chooseChartStyle(s.id)}>{s.label}</button>
                ))}
              </span>
            </label>
            <span className="meta-inline">
              {rawData.batches.length} batches · {rawData.variable} · accepted {rawData.acceptedValue} mg/L
              {runPoints.length > 0 && ` · +${runPoints.length} run point(s)`}
            </span>
          </div>
          {series && <ControlChart series={series} showLine={showLine} chartStyle={chartStyle} title={`${elementName} — Digest LFB control chart`} />}
        </>
      )}
    </>
  );
}
