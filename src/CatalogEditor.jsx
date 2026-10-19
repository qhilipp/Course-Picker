import { useEffect, useId, useState } from "react";
import { normalizeCatalog } from "./optimize.js";

const EMPTY_DRAFT = {
  id: "",
  name: "",
  credits: "5",
  semester: "",
  area: "",
  newAreaName: "",
  newAreaShort: "",
  theoretical: false,
  preference: "3",
};

export function CatalogEditor({
  open,
  onClose,
  source,
  defaultRaw,
  customRaw,
  tumRaw,
  tumStatus,
  tumMessage,
  onUseDefault,
  onUseTum,
  onUseCustom,
  onSaveCustom,
}) {
  const titleId = useId();
  const [draft, setDraft] = useState(null);
  const [formError, setFormError] = useState("");
  const [fileError, setFileError] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const viewingCustom = source === "custom" && customRaw;
  const viewingTum = source === "tum" && tumRaw;
  const raw = viewingCustom ? customRaw : viewingTum ? tumRaw : defaultRaw;
  const areas = Array.isArray(raw?.requirements?.areas) ? raw.requirements.areas : [];
  const courses = Array.isArray(raw?.courses) ? raw.courses : [];

  function commit(next) {
    onSaveCustom(next);
    setDraft(null);
    setFormError("");
  }

  function workingCopy() {
    return JSON.parse(JSON.stringify(raw));
  }

  function saveDraft(event) {
    event.preventDefault();
    const id = draft.id.trim();
    const name = draft.name.trim();
    const credits = Number(draft.credits);
    if (!id || !name) {
      setFormError("Enter a module id and a name.");
      return;
    }
    if (!Number.isFinite(credits) || credits <= 0 || credits > 60) {
      setFormError("Credits must be a positive number up to 60.");
      return;
    }
    const preference = Math.min(5, Math.max(0, Math.round(Number(draft.preference) || 0)));
    let areaId = draft.area;
    const next = workingCopy();
    next.requirements = next.requirements && typeof next.requirements === "object" ? next.requirements : {};
    next.requirements.areas = Array.isArray(next.requirements.areas) ? next.requirements.areas : [];
    next.courses = Array.isArray(next.courses) ? next.courses : [];

    if (areaId === "__new") {
      const areaName = draft.newAreaName.trim();
      const areaShort = draft.newAreaShort.trim() || areaName;
      areaId = areaShort.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (!areaName || !areaId) {
        setFormError("A new area needs a name.");
        return;
      }
      if (!next.requirements.areas.some((area) => area.id === areaId)) {
        next.requirements.areas.push({ id: areaId, name: areaName, short: areaShort });
      }
    }
    if (!areaId) {
      setFormError("Choose an area.");
      return;
    }

    const course = {
      id,
      name,
      credits,
      semester: draft.semester || null,
      preference,
      theoretical: draft.theoretical,
      area: areaId,
    };
    if (next.courses.some((item) => item.id === id && item.id !== draft.originalId)) {
      setFormError("That module id is already in the list.");
      return;
    }
    next.courses = next.courses.filter((item) => item.id !== draft.originalId);
    next.courses.push(course);
    commit(next);
  }

  function removeCourse(id) {
    const next = workingCopy();
    next.courses = (next.courses ?? []).filter((item) => item.id !== id);
    commit(next);
  }

  function startEdit(course) {
    setFormError("");
    setDraft({
      originalId: course.id,
      id: course.id,
      name: course.name ?? "",
      credits: String(course.credits ?? ""),
      semester: course.semester ?? "",
      area: course.area ?? "",
      newAreaName: "",
      newAreaShort: "",
      theoretical: course.theoretical === true,
      preference: String(course.preference ?? 3),
    });
  }

  async function uploadFile(file) {
    setFileError("");
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const normalized = normalizeCatalog(parsed);
      if (normalized.errors.length > 0) {
        setFileError(normalized.errors[0]);
        return;
      }
      onSaveCustom(parsed);
      setDraft(null);
    } catch {
      setFileError("That file is not valid JSON.");
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog-head">
          <div>
            <h2 id={titleId}>Modules</h2>
            <p>The TUM catalog is loaded from TUMonline each time you open it. Edits become My list and stay in this browser.</p>
          </div>
          <button type="button" className="text-button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="source-switch" role="group" aria-label="Module list">
          <button type="button" aria-pressed={source === "default"} onClick={onUseDefault}>
            Default list
          </button>
          <button type="button" aria-pressed={source === "tum"} onClick={onUseTum}>
            TUM catalog
          </button>
          <button type="button" aria-pressed={source === "custom"} onClick={onUseCustom} disabled={!customRaw}>
            My list
          </button>
        </div>

        <div className="dialog-actions">
          <label className="upload">
            Upload JSON
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                uploadFile(file);
              }}
            />
          </label>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setFormError("");
              setDraft({ ...EMPTY_DRAFT, originalId: null, area: areas[0]?.id ?? "__new" });
            }}
          >
            Add module
          </button>
          <button type="button" className="text-button" disabled={tumStatus === "loading"} onClick={onUseTum}>
            {tumStatus === "loading" ? "Loading TUM…" : "Refresh TUM catalog"}
          </button>
        </div>
        {fileError && <p className="form-error">{fileError}</p>}
        {tumMessage && <p className={tumStatus === "error" ? "form-error" : "form-note"}>{tumMessage}</p>}

        {draft && (
          <form className="module-form" onSubmit={saveDraft}>
            <label>
              Module id
              <input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} />
            </label>
            <label className="wide">
              Name
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label>
              ECTS
              <input
                inputMode="decimal"
                value={draft.credits}
                onChange={(event) => setDraft({ ...draft, credits: event.target.value })}
              />
            </label>
            <label>
              Semester
              <select value={draft.semester} onChange={(event) => setDraft({ ...draft, semester: event.target.value })}>
                <option value="winter">Winter</option>
                <option value="summer">Summer</option>
                <option value="">Either semester</option>
              </select>
            </label>
            <label>
              Area
              <select value={draft.area} onChange={(event) => setDraft({ ...draft, area: event.target.value })}>
                {areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
                <option value="__new">New area</option>
              </select>
            </label>
            <label>
              Preference
              <input
                inputMode="numeric"
                value={draft.preference}
                onChange={(event) => setDraft({ ...draft, preference: event.target.value })}
              />
            </label>
            {draft.area === "__new" && (
              <>
                <label>
                  Area name
                  <input
                    value={draft.newAreaName}
                    onChange={(event) => setDraft({ ...draft, newAreaName: event.target.value })}
                  />
                </label>
                <label>
                  Short name
                  <input
                    value={draft.newAreaShort}
                    onChange={(event) => setDraft({ ...draft, newAreaShort: event.target.value })}
                  />
                </label>
              </>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={draft.theoretical}
                onChange={(event) => setDraft({ ...draft, theoretical: event.target.checked })}
              />
              Theory module
            </label>
            {formError && <p className="form-error wide">{formError}</p>}
            <div className="form-buttons wide">
              <button type="submit">{draft.originalId ? "Save module" : "Add to my list"}</button>
              <button type="button" className="text-button" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        <ul className="module-list">
          {courses.map((course) => (
            <li key={course.id}>
              <div>
                <b>{course.id}</b> {course.name}
                <small>
                  {course.credits} ECTS
                  {course.area ? ` · ${course.area}` : ""}
                  {course.theoretical ? " · Theory" : ""}
                  {course.semester ? ` · ${course.semester}` : " · Either"}
                </small>
              </div>
              <div className="row-actions">
                <button type="button" className="text-button" onClick={() => startEdit(course)}>
                  Edit
                </button>
                <button type="button" className="text-button danger" onClick={() => removeCourse(course.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
