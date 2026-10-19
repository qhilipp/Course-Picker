import { useEffect, useMemo, useState } from "react";
import rawCatalog from "../courses.json";
import { normalizeCatalog, recommend } from "./optimize.js";

const STORAGE_KEY = "course-picker-v1";

const PREFERENCES = [
  { value: 0, label: "0", hint: "Nicht einplanen" },
  { value: 1, label: "1", hint: "Ungern" },
  { value: 2, label: "2", hint: "Eher nicht" },
  { value: 3, label: "3", hint: "Gerne" },
  { value: 4, label: "4", hint: "Sehr gerne" },
  { value: 5, label: "5", hint: "Am liebsten" },
];

const SEMESTER_LABEL = {
  winter: "WiSe",
  summer: "SoSe",
};

function readStorage() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function readPreferences(value) {
  if (!value || typeof value !== "object") return {};
  const preferences = {};
  for (const [id, preference] of Object.entries(value)) {
    if (typeof preference === "number" && preference >= 0 && preference <= 5) {
      preferences[id] = Math.round(preference);
    }
  }
  return preferences;
}

function readForced(value) {
  if (!value || typeof value !== "object") return {};
  const forced = {};
  for (const [id, pinned] of Object.entries(value)) {
    if (pinned === true) forced[id] = true;
  }
  return forced;
}

function readSemesters(value) {
  const semesters = {
    winter: value?.winter !== false,
    summer: value?.summer !== false,
  };
  if (!semesters.winter && !semesters.summer) return { winter: true, summer: true };
  return semesters;
}

function formatCredits(value) {
  return Number(value).toLocaleString("de-DE", { maximumFractionDigits: 1 });
}

function formatScore(value) {
  return Number(value).toLocaleString("de-DE", { maximumFractionDigits: 2 });
}

function preferenceOf(course, preferences) {
  return preferences[course.id] ?? course.preference;
}

export function App() {
  const catalog = useMemo(() => normalizeCatalog(rawCatalog), []);
  const [preferences, setPreferences] = useState(() => readPreferences(readStorage().preferences));
  const [forced, setForced] = useState(() => readForced(readStorage().forced));
  const [overagePenalty, setOveragePenalty] = useState(() => {
    const saved = readStorage().overagePenalty;
    if (typeof saved === "number" && saved >= 0 && saved <= 2) return saved;
    return catalog.requirements?.overagePenalty ?? 0.75;
  });
  const [semesters, setSemesters] = useState(() => readSemesters(readStorage().semesters));
  const [query, setQuery] = useState("");
  const [areaFilter, setAreaFilter] = useState("all");
  const [onlyPlan, setOnlyPlan] = useState(false);
  const [onlyTheory, setOnlyTheory] = useState(false);
  const [copied, setCopied] = useState(false);
  const [planIndex, setPlanIndex] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ preferences, forced, overagePenalty, semesters }),
      );
    } catch {
      // Privater Modus kann den Speicher blockieren. Die Sitzung funktioniert trotzdem.
    }
  }, [preferences, forced, overagePenalty, semesters]);

  const result = useMemo(() => {
    if (!catalog.requirements) return null;
    return recommend(catalog.courses, catalog.requirements, {
      preferences,
      forced,
      overagePenalty,
      semesters,
    });
  }, [catalog, preferences, forced, overagePenalty, semesters]);

  const plans = result?.plans?.length ? result.plans : [];
  const plan = plans[Math.min(planIndex, plans.length - 1)] ?? null;

  useEffect(() => {
    setPlanIndex(0);
  }, [preferences, forced, overagePenalty, semesters]);

  const selectedIds = useMemo(() => new Set(plan?.courses.map((course) => course.id) ?? []), [plan]);

  if (!catalog.requirements) {
    return (
      <main className="fatal">
        <h1>courses.json lässt sich nicht lesen</h1>
        <ul>
          {catalog.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      </main>
    );
  }

  const { requirements, meta } = catalog;
  const areaById = new Map(requirements.areas.map((area) => [area.id, area]));

  function setPreference(courseId, value) {
    setPreferences((current) => ({ ...current, [courseId]: value }));
  }

  function toggleForced(courseId) {
    setForced((current) => {
      const next = { ...current };
      if (next[courseId]) delete next[courseId];
      else next[courseId] = true;
      return next;
    });
  }

  function toggleSemester(id) {
    setSemesters((current) => {
      if (current[id] && Object.values(current).filter(Boolean).length === 1) return current;
      return { ...current, [id]: !current[id] };
    });
  }

  function resetStored() {
    setPreferences({});
    setForced({});
    setOveragePenalty(requirements.overagePenalty);
    setSemesters({ winter: true, summer: true });
  }

  function focusCourse(courseId) {
    document.getElementById(`course-${courseId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function copyPlan() {
    const lines = planText(plan, requirements, areaById);
    try {
      await navigator.clipboard.writeText(lines);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const visibleAreas = requirements.areas.filter((area) => areaFilter === "all" || area.id === areaFilter);

  return (
    <div className="app">
      <main className="catalog">
        <div className="catalog-inner">
          <header className="masthead">
            <h1>{meta.title || "Kurswahl"}</h1>
            <p className="rules-line">
              {formatCredits(requirements.totalCredits)} ECTS · mind. {formatCredits(requirements.theoreticalCredits)} Theorie,
              Strafe darüber · Blöcke {formatQuotaList(requirements.areaQuotas)} aus verschiedenen Bereichen. 0 plant einen
              Kurs nicht ein, 5 am liebsten. Fix hält ihn fest.
            </p>
          </header>

          {catalog.warnings.length > 0 && (
            <ul className="note warn">
              {catalog.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          <div className="toolbar">
            <label className="search">
              <span className="sr-only">Kurse suchen</span>
              <input
                type="search"
                value={query}
                placeholder="Name oder Nummer"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className="filter">
              <span className="sr-only">Bereich</span>
              <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
                <option value="all">Alle Bereiche</option>
                {requirements.areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={onlyTheory}
                onChange={(event) => setOnlyTheory(event.target.checked)}
              />
              Nur Theorie
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={onlyPlan}
                onChange={(event) => setOnlyPlan(event.target.checked)}
              />
              Nur im Plan
            </label>
          </div>

          {visibleAreas.map((area) => {
            const tone = requirements.areas.findIndex((item) => item.id === area.id);
            const courses = catalog.courses.filter((course) => {
              if (course.area !== area.id) return false;
              if (onlyTheory && !course.theoretical) return false;
              if (onlyPlan && !selectedIds.has(course.id)) return false;
              if (needle && !`${course.id} ${course.name}`.toLowerCase().includes(needle)) return false;
              return true;
            });
            const areaCredits = plan?.totals.areas[area.id] ?? 0;
            const slot = plan.assignment.find((item) => item.areaId === area.id);
            const met = !slot || slot.missing === 0;
            return (
              <section key={area.id} className="area" data-area={area.id}>
                <div className="area-head">
                  <h2>{area.name}</h2>
                  <p className={slot ? (met ? "area-status met" : "area-status") : "area-status idle"}>
                    {slot
                      ? `${formatCredits(areaCredits)} ECTS · Block ${formatCredits(slot.quotaCredits)}`
                      : `${formatCredits(areaCredits)} ECTS`}
                  </p>
                </div>
                {courses.length === 0 ? (
                  <p className="empty">Keine Kurse für diesen Filter.</p>
                ) : (
                  <ul className="course-list">
                    {courses.map((course) => (
                      <CourseRow
                        key={course.id}
                        course={course}
                        area={{ ...area, tone }}
                        preference={preferenceOf(course, preferences)}
                        forced={Boolean(forced[course.id])}
                        selected={selectedIds.has(course.id)}
                        semesterClosed={course.semester != null && !semesters[course.semester]}
                        onPreference={setPreference}
                        onToggleForced={toggleForced}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </main>

      <aside className="plan" aria-label="Empfohlener Plan">
        <div className="plan-inner">
          <div className="plan-heading">
            <h2>{plan.feasible ? `Plan ${Math.min(planIndex, plans.length - 1) + 1}` : "Nächster Versuch"}</h2>
            <p className="status" aria-live="polite">
              {plan.courses.length} Kurse · {formatCredits(plan.totals.credits)} ECTS
              {plan.feasible ? "" : " · offen"}
            </p>
          </div>
          <nav className="plan-nav" aria-label="Beste Pläne">
            {plans.map((item, index) => (
              <button
                key={item.courses.map((course) => course.id).join("-") || index}
                type="button"
                aria-pressed={index === Math.min(planIndex, plans.length - 1)}
                onClick={() => setPlanIndex(index)}
              >
                <span>{index + 1}</span>
                <span>
                  {formatCredits(item.totals.credits)} ECTS · {formatCredits(item.totals.theoretical)} Theo
                </span>
                <span>{formatScore(item.score)}</span>
              </button>
            ))}
          </nav>

          {!plan.feasible && (
            <div className="banner">
              <strong>So reichen die bewerteten Kurse nicht.</strong>
              <ul>
                {deficitLines(plan, requirements).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="meters">
            <Meter
              label="Gesamt"
              value={plan.totals.credits}
              goal={requirements.totalCredits}
              overage={plan.totals.overage}
            />
            {plan.assignment.map((slot, index) => (
              <Meter
                key={`${slot.quotaCredits}-${index}`}
                label={
                  slot.areaId
                    ? `${areaById.get(slot.areaId)?.short ?? areaById.get(slot.areaId)?.name} · ${formatCredits(slot.quotaCredits)}`
                    : `${formatCredits(slot.quotaCredits)} aus einem Bereich`
                }
                value={slot.credits}
                goal={slot.quotaCredits}
              />
            ))}
            <Meter
              label="Theorie"
              value={plan.totals.theoretical}
              goal={requirements.theoreticalCredits}
              overage={plan.totals.theoryOverage}
            />
          </div>

          <p className="score-line">
            Nutzen {formatScore(plan.score)}
            <span>
              Präferenz {formatScore(plan.preferenceSum)} · Strafe −{formatScore(plan.penalty)}
            </span>
          </p>

          {semesterGroups(catalog.courses, plan.courses).map((semester) => {
            const courses = plan.courses.filter((course) => course.semester === semester.id);
            const credits = courses.reduce((sum, course) => sum + course.credits, 0);
            return (
              <section key={semester.title} className="semester">
                <h3>
                  {semester.title}
                  <span>{courses.length === 0 ? "keine Kurse" : `${formatCredits(credits)} ECTS`}</span>
                </h3>
                {courses.length === 0 ? (
                  <p className="quiet">In diesem Semester ist nichts eingeplant.</p>
                ) : (
                  <ul>
                    {courses.map((course) => (
                      <li key={course.id}>
                        <button type="button" className="plan-course" onClick={() => focusCourse(course.id)}>
                          <span>
                            <b>{course.id}</b> {course.name}
                          </span>
                          <small>
                            {areaById.get(course.area)?.short ?? areaById.get(course.area)?.name} ·{" "}
                            {formatCredits(course.credits)}
                            {course.theoretical ? " · Theo" : ""}
                            {forced[course.id] ? " · fix" : ""}
                          </small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          {plan.forcedOutsideSemester.length > 0 && (
            <p className="quiet">
              Fixierte Kurse bleiben im Plan, auch wenn ihr Semester gerade ausgeschaltet ist:{" "}
              {plan.forcedOutsideSemester.map((course) => course.name).join(", ")}.
            </p>
          )}
          {plan.atOverageLimit && (
            <p className="quiet">
              Die Suche betrachtet höchstens {formatCredits(plan.maxOverage)} Extra-Credits. Pläne mit noch mehr
              Credits werden nicht verglichen.
            </p>
          )}

          <div className="controls">
            <fieldset>
              <legend>Semester in der Suche</legend>
              <div className="semester-toggle">
                <button
                  type="button"
                  aria-pressed={semesters.winter}
                  onClick={() => toggleSemester("winter")}
                >
                  Winter
                </button>
                <button
                  type="button"
                  aria-pressed={semesters.summer}
                  onClick={() => toggleSemester("summer")}
                >
                  Sommer
                </button>
              </div>
            </fieldset>
            <label className="penalty">
              <span>
                Strafe pro Extra-Credit
                <strong>{formatScore(overagePenalty)}</strong>
              </span>
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={overagePenalty}
                onChange={(event) => setOveragePenalty(Math.round(Number(event.target.value) * 20) / 20)}
              />
              <small>Gilt für Credits über 53 und für Theorie über 10.</small>
            </label>
            <div className="plan-actions">
              <button type="button" className="ghost" onClick={copyPlan}>
                {copied ? "Kopiert" : "Plan kopieren"}
              </button>
              <button type="button" className="ghost" onClick={resetStored}>
                Angaben zurücksetzen
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function CourseRow({ course, area, preference, forced, selected, semesterClosed, onPreference, onToggleForced }) {
  return (
    <li
      id={`course-${course.id}`}
      className={selected ? "course selected" : "course"}
      data-area={area.id}
      data-selected={selected ? "true" : "false"}
    >
      <div className="course-main">
        <div className="course-title">
          <span className="code">{course.id}</span>
          <h3>{course.name}</h3>
          {selected && <span className="pill">Plan</span>}
          {semesterClosed && !forced && <span className="pill muted">aus</span>}
        </div>
        <p className="meta">
          <span className={`tag tone-${area.tone}`}>{area.short || area.name}</span>
          <span>{formatCredits(course.credits)} ECTS</span>
          <span>{course.semester ? SEMESTER_LABEL[course.semester] : "offen"}</span>
          {course.theoretical && <span>Theo</span>}
        </p>
      </div>
      <div className="course-actions">
        <div className="prefs" role="group" aria-label={`Präferenz für ${course.name}`}>
          {PREFERENCES.map((level) => (
            <button
              key={level.value}
              type="button"
              aria-pressed={preference === level.value}
              title={level.hint}
              data-preference={level.value}
              onClick={() => onPreference(course.id, level.value)}
            >
              {level.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={forced ? "pin on" : "pin"}
          aria-pressed={forced}
          title="Immer einplanen"
          onClick={() => onToggleForced(course.id)}
        >
          Fix
        </button>
      </div>
    </li>
  );
}

function Meter({ label, value, goal, overage = 0 }) {
  const met = goal <= 0 || value >= goal;
  const width = goal <= 0 ? (value > 0 ? 100 : 0) : Math.min(100, (value / goal) * 100);
  return (
    <div className={met ? "meter met" : "meter"}>
      <div className="meter-label">
        <span>{label}</span>
        <span>
          {formatCredits(value)} / {formatCredits(goal)}
          {overage > 0 ? ` · +${formatCredits(overage)}` : ""}
        </span>
      </div>
      <div className="track" aria-hidden="true">
        <div className="fill" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function formatQuotaList(quotas) {
  const labels = quotas.map((quota) => formatCredits(quota));
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} und ${labels.at(-1)}`;
}

function semesterGroups(catalogCourses, planCourses) {
  const groups = [
    { id: "winter", title: "WiSe" },
    { id: "summer", title: "SoSe" },
  ];
  const hasOpen = [...catalogCourses, ...planCourses].some((course) => course.semester == null);
  if (hasOpen) groups.push({ id: null, title: "Offen" });
  return groups;
}

function deficitLines(plan, requirements) {
  const lines = [];
  const areaById = new Map(requirements.areas.map((area) => [area.id, area]));
  if (plan.deficits.credits > 0) {
    lines.push(`${formatCredits(plan.deficits.credits)} ECTS bis zum Gesamtziel`);
  }
  if (plan.deficits.theoretical > 0) {
    lines.push(`${formatCredits(plan.deficits.theoretical)} ECTS Theorie`);
  }
  for (const slot of plan.assignment) {
    if (slot.missing <= 0) continue;
    const name = areaById.get(slot.areaId)?.name;
    lines.push(
      name
        ? `${formatCredits(slot.missing)} ECTS in ${name} für den ${formatCredits(slot.quotaCredits)}-ECTS-Block`
        : `${formatCredits(slot.quotaCredits)} ECTS aus einem weiteren Bereich`,
    );
  }
  if (lines.length === 0) {
    lines.push("Innerhalb der Suchgrenze ist kein gültiger Plan erreichbar.");
  }
  return lines;
}

function planText(plan, requirements, areaById) {
  const lines = [
    plan.feasible ? "Empfohlener Plan" : "Nächster Versuch",
    `${plan.courses.length} Kurse, ${formatCredits(plan.totals.credits)} ECTS (Ziel ${formatCredits(requirements.totalCredits)})`,
    `Theorie: ${formatCredits(plan.totals.theoretical)} / ${formatCredits(requirements.theoreticalCredits)} ECTS`,
  ];
  for (const slot of plan.assignment) {
    const name = slot.areaId ? areaById.get(slot.areaId)?.name : "offener Bereich";
    lines.push(
      `${formatCredits(slot.quotaCredits)}-ECTS-Block: ${name} (${formatCredits(slot.credits)} ECTS)`,
    );
  }
  lines.push("");
  for (const semester of semesterGroups(plan.courses, plan.courses)) {
    lines.push(semester.title);
    const courses = plan.courses.filter((course) => course.semester === semester.id);
    if (courses.length === 0) lines.push("- keine");
    for (const course of courses) {
      lines.push(
        `- ${course.id} ${course.name} (${areaById.get(course.area)?.short ?? areaById.get(course.area)?.name}, ${formatCredits(course.credits)} ECTS${course.theoretical ? ", Theo" : ""})`,
      );
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
