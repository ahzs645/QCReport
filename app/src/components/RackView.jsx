import React, { useMemo } from "react";

// Experimental view: the physical autosampler layout + prep cross-reference,
// assembled from the HotBlock digestion and/or Labels workbooks (joined on the
// NALS id + position). Off by default — purely informational.

const ROLE_LABEL = { blank: "Method Blank", duplicate: "Duplicate", lfmSpike: "Matrix Spike", icv: "ICV" };

export default function RackView({ prep }) {
  const entries = prep?.entries || [];
  const withRack = useMemo(
    () => entries.filter((e) => e.rack && e.rack.column != null && e.rack.row != null),
    [entries],
  );

  // Group rack positions by column for a simple grid (column = a rack, rows stack).
  const columns = useMemo(() => {
    const byCol = new Map();
    for (const e of withRack) {
      const c = e.rack.column;
      if (!byCol.has(c)) byCol.set(c, []);
      byCol.get(c).push(e);
    }
    for (const list of byCol.values()) list.sort((a, b) => a.rack.row - b.rack.row);
    return [...byCol.entries()].sort((a, b) => a[0] - b[0]);
  }, [withRack]);

  if (!entries.length) {
    return <p className="hint">No prep cross-reference loaded. Drop the HotBlock digestion and/or Labels workbook to populate this.</p>;
  }

  const rows = [...entries].sort((a, b) => {
    if (a.rack && b.rack) return a.rack.column - b.rack.column || a.rack.row - b.rack.row;
    return String(a.position).localeCompare(String(b.position));
  });

  return (
    <div className="rackview">
      {columns.length > 0 && (
        <div className="rack-grid">
          {columns.map(([col, list]) => (
            <div key={col} className="rack-col">
              <div className="rack-col-head">Rack {col}</div>
              {list.map((e) => (
                <div key={e.key} className={`rack-cell ${e.prepRole ? "is-prep" : ""}`} title={`${e.id}${e.acid ? ` · ${e.acid}` : ""}`}>
                  <span className="rack-pos">{e.position || `${col}:${e.rack.row}`}</span>
                  <span className="rack-name">{e.sampleName || e.id}</span>
                  {e.prepRole && <span className="rack-role">{ROLE_LABEL[e.prepRole] || e.prepRole}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="table-scroll" style={{ marginTop: 14 }}>
        <table className="cc-table">
          <thead>
            <tr><th>Position</th><th>NALS id</th><th>Sample name</th><th>Role</th><th>Rack</th><th>Amount</th><th>Acid</th></tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.key} className={e.prepRole ? "row-diluted" : ""}>
                <td>{e.position || "—"}</td>
                <td title={e.comments || ""}>{e.id}</td>
                <td>{e.sampleName || "—"}</td>
                <td>{e.prepRole ? ROLE_LABEL[e.prepRole] || e.prepRole : "client"}</td>
                <td>{e.rack ? `${e.rack.column}:${e.rack.row}` : "—"}</td>
                <td>{e.amount ?? "—"}</td>
                <td>{e.acid || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
