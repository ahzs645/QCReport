import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
// Scoped component styles for the shared qcreport/ui components (every rule sits
// under `.qcreport-ui`, so it only styles elements inside such a wrapper).
import "../../ui/styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
