import React, { useRef, useState } from "react";

export default function DropZone({ onFiles, status, label = "Drop the raw ICPOES export here", hint }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);

  const pick = (fileList) => {
    const files = [...fileList].filter((f) => /\.xlsx?$/i.test(f.name));
    if (files.length) onFiles(files);
  };

  return (
    <div
      className={`dropzone${over ? " over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        pick(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        multiple
        hidden
        onChange={(e) => pick(e.target.files)}
      />
      {status === "working" ? (
        <p>Analyzing…</p>
      ) : (
        <>
          <p className="big">{label}</p>
          <p className="hint">{hint || "…or click to choose."}</p>
        </>
      )}
    </div>
  );
}
