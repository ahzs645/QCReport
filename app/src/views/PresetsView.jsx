// Presets tab — a thin host wrapper around the shared <PresetsReference> component
// in qcreport/ui, fed by the light, engine-free qcreport/presets subpath. The page
// itself lives in ui/PresetsReference.jsx so this app and the NALS report app render
// exactly the same reference page from the same constants (they can't drift).
//
// The `qcreport-ui` class is what scopes ui/styles.css (imported in main.jsx) to
// these elements.
import * as presets from "../../../engine/presets.mjs";
import { PresetsReference } from "../../../ui/index.mjs";

export default function PresetsView() {
  return (
    <div className="qcreport-ui">
      <PresetsReference presets={presets} />
    </div>
  );
}
