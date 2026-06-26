// Node-only asset resolver for the engine's bundled templates + prebuilt spec.
// Browser consumers should NOT import this; instead they import the template files
// as URLs (e.g. Vite `?url`) from the package's "./templates/*" subpath and load
// them with the engine's `loadWorkbook`. This module exists for Node hosts (tests,
// scripts, server-side regen) that can read from disk.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);

/** Absolute path to a packaged file (relative to the package root). */
export function assetPath(relative) {
  return fileURLToPath(new URL(relative, root));
}

export const RESULTS_TEMPLATE = assetPath("templates/nals-results-template.xlsx");
export const QC_TEMPLATE = assetPath("templates/nals-qc-template.xlsx");

/** Read a packaged file as a Node Buffer (usable as an ArrayBuffer source). */
export function readAsset(relative) {
  return readFile(assetPath(relative));
}

/** Load the prebuilt, serialized workbook spec index (templates/spec/index.json). */
export async function loadPrebuiltSpecIndex() {
  return JSON.parse(await readFile(assetPath("templates/spec/index.json"), "utf8"));
}
