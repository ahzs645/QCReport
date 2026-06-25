import React, { useRef, useState } from "react";

export default function DropZone({
  onFiles,
  status,
  label = "Drop the raw ICPOES export here",
  hint,
  accept = ".xlsx,.xls",
  match = /\.xlsx?$/i,
  multiple = true,
}) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);

  const pick = (fileList) => {
    const files = [...fileList].filter((f) => match.test(f.name));
    if (files.length) onFiles(multiple ? files : [files[0]]);
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
        accept={accept}
        multiple={multiple}
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
