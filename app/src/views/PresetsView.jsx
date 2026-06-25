import React from "react";
import { DEFAULT_FLAGS, HARDNESS_COEFFICIENTS, REPORTABLE_RULES } from "../../../scripts/lib/formula-engine.mjs";
import { DEFAULT_QC_CRITERIA, QC_CHECKS, QC_KINDS, QC_ROLE_LABELS } from "../../../scripts/lib/qc-engine.mjs";
import { CONTROL_CHART_INFO } from "../../../scripts/lib/control-chart.mjs";
import { MATCH_INFO } from "../../../scripts/lib/sample-match.mjs";

const range = (r) => (Array.isArray(r) ? `${r[0]} – ${r[1]} %` : "—");

export default function PresetsView() {
  const c = DEFAULT_QC_CRITERIA;
  return (
    <div className="presets">
      <p className="sub">
        Everything the calculations use, read straight from the code (no hidden values). Detection
        limits, units and CDWQ guidelines come from each workbook's CODES sheet; the constants below
        are the encoded defaults (editable in <code>scripts/lib/</code>).
      </p>

      <section>
        <h2>Reportable value — per analyte cell</h2>
        <table className="preset-table">
          <thead><tr><th>When</th><th>Result</th><th>Applies</th></tr></thead>
          <tbody>
            {REPORTABLE_RULES.map((r, i) => (
              <tr key={i}><td>{r.when}</td><td><b>{r.result}</b></td><td>{r.note || "all instrument sheets"}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="hint">
          Flags (from CODES): over-range = {DEFAULT_FLAGS.over.map((f) => `"${f}"`).join(" / ")} → “{DEFAULT_FLAGS.overLabel}”;
          uncalibrated = “{DEFAULT_FLAGS.uncal}”; blank → “{DEFAULT_FLAGS.noData}”.
        </p>
      </section>

      <section>
        <h2>Hardness (mg CaCO₃/L)</h2>
        <p className="formula">{HARDNESS_COEFFICIENTS.ca} × Ca + {HARDNESS_COEFFICIENTS.mg} × Mg <span className="hint">(from ICPOES Ca &amp; Mg, mg/L)</span></p>
      </section>

      <section>
        <h2>Quality-check equations &amp; per-role settings</h2>
        <table className="preset-table">
          <thead><tr><th>QC role</th><th>Check</th><th>Equation</th><th>True value (mg/L)</th><th>Accept</th><th>Ref. blank</th></tr></thead>
          <tbody>
            {Object.entries(QC_CHECKS).map(([key, def]) => {
              const kind = QC_KINDS[def.kind] || {};
              return (
                <tr key={key}>
                  <td><b>{QC_ROLE_LABELS[key] || key}</b></td>
                  <td>{kind.label || def.kind}</td>
                  <td className="formula">{kind.formula}</td>
                  <td>{def.trueKey ? c.trueValues[def.trueKey] : "—"}</td>
                  <td>{def.range ? range(c.ranges[def.range]) : "—"}</td>
                  <td>{def.blankKey ? QC_ROLE_LABELS[def.blankKey] : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="two-col">
        <div>
          <h3>QC true values (mg/L)</h3>
          <table className="preset-table">
            <tbody>
              {Object.entries(c.trueValues).map(([k, v]) => (<tr key={k}><td>{k}</td><td><b>{v}</b></td></tr>))}
            </tbody>
          </table>
          <h3>Element overrides</h3>
          {c.elementOverrides?.length ? (
            <ul>{c.elementOverrides.map((o, i) => (
              <li key={i}><code>{o.match}</code> → {o.trueKey} true value = <b>{o.value}</b> <span className="hint">(µg/L unit)</span></li>
            ))}</ul>
          ) : <p className="hint">none</p>}
        </div>
        <div>
          <h3>Acceptance ranges (% recovery / RPD)</h3>
          <table className="preset-table">
            <tbody>
              {Object.entries(c.ranges).map(([k, r]) => (<tr key={k}><td>{k}</td><td>{range(r)}</td></tr>))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Control charts (Shewhart, Digest LFB)</h2>
        <ul className="kv">
          <li><span>Center line</span><b>{CONTROL_CHART_INFO.centerLine}</b></li>
          <li><span>Spread</span><b>{CONTROL_CHART_INFO.spread}</b></li>
          <li><span>Control limits</span><b className="formula">{CONTROL_CHART_INFO.limitFormula}</b></li>
          <li><span>RPD</span><b className="formula">{CONTROL_CHART_INFO.rpdFormula}</b></li>
          <li><span>Performance</span><b>{CONTROL_CHART_INFO.performanceRule}</b></li>
          <li><span>Defaults</span><b>accepted {CONTROL_CHART_INFO.defaults.acceptedValue} mg/L · criterion {CONTROL_CHART_INFO.defaults.criterion}% <span className="hint">(overridden by the loaded workbook)</span></b></li>
        </ul>
      </section>

      <section>
        <h2>Matching &amp; parsing</h2>
        <ul className="kv">
          <li><span>Analyte</span><b>{MATCH_INFO.analyte}</b></li>
          <li><span>Dilution</span><b>{MATCH_INFO.dilution}</b></li>
        </ul>
        <h3>Sample matching (in order)</h3>
        <ol>
          {MATCH_INFO.sampleStrategies.map((s) => (<li key={s.reason}><code>{s.reason}</code> — {s.description}</li>))}
        </ol>
      </section>
    </div>
  );
}
