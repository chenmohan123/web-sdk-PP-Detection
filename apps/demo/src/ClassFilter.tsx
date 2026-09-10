import type { CSSProperties, ReactElement } from "react";
import type { PPDetectionResult } from "web-sdk-pp-detection";
import { detectionColor } from "./detection-colors";
import { detectionLabel } from "./i18n/detection-labels";
import type { Copy } from "./i18n/zh-CN";

export function ClassFilter({
  detections,
  selected,
  onChange,
  language,
  copy
}: {
  detections: PPDetectionResult["detections"];
  selected: ReadonlySet<string> | null;
  onChange: (selected: ReadonlySet<string> | null) => void;
  language: "zh" | "en";
  copy: Copy;
}): ReactElement {
  const counts = new Map<string, number>();
  for (const detection of detections) {
    counts.set(detection.label, (counts.get(detection.label) ?? 0) + 1);
  }
  // 所选类别暂时离开视频画面时保留选项，显示当前帧的零计数。
  for (const label of selected ?? []) if (!counts.has(label)) counts.set(label, 0);
  const labels = [...counts.keys()].sort();

  return (
    <fieldset className="class-filter">
      <legend>{copy.filterClasses}</legend>
      <button className="text-button" disabled={selected === null} onClick={() => onChange(null)}>
        {copy.showAllClasses}
      </button>
      <div className="class-filter-options">
        {labels.map((label) => (
          <label className="class-filter-option" key={label}>
            <input
              type="checkbox"
              checked={selected === null || selected.has(label)}
              onChange={(event) => {
                const next = new Set(selected ?? labels);
                if (event.target.checked) next.add(label);
                else next.delete(label);
                onChange(next);
              }}
            />
            <span
              className="detection-color-dot"
              style={{ "--detection-color": detectionColor(label) } as CSSProperties}
              aria-hidden="true"
            />
            <span>
              {detectionLabel(label, language)} ({counts.get(label)})
            </span>
          </label>
        ))}
      </div>
      <p className="muted">{copy.classFilterHint}</p>
    </fieldset>
  );
}
