import { useEffect, useMemo, useRef, useState } from "react";
import { CatalogEditor } from "./CatalogEditor.jsx";
import { normalizeCatalog, planAlternatives, recommend } from "./optimize.js";
import { buildImportedCatalog, fetchTumElectives } from "./tumCatalog.js";

const STORAGE_KEY = "course-picker-v1";
const CATALOG_KEY = "course-picker-catalog";
const TUM_CACHE_KEY = "course-picker-tum";
const HINTS_KEY = "course-picker-hints";
const EXTRA_CREDITS = 10;
const STANDARD_TOTAL = 43;

const PREFERENCES = [
  { value: 0, label: "0", hint: "Skip" },
  { value: 1, label: "1", hint: "Rather not" },
  { value: 2, label: "2", hint: "Not really" },
  { value: 3, label: "3", hint: "Fine" },
  { value: 4, label: "4", hint: "Like it" },
  { value: 5, label: "5", hint: "Favorite" },
];

const SEMESTER_LABEL = {
  winter: "Winter",
  summer: "Summer",
};

const AREA_COLORS = [
  "#60a5fa",
  "#34d399",
  "#f472b6",
  "#fbbf24",
  "#a78bfa",
  "#fb7185",
  "#22d3ee",
  "#a3e635",
  "#fb923c",
  "#e879f9",
  "#94a3b8",
  "#2dd4bf",
];

function readStorage() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function readStoredCatalog(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readDisabledAreas(value) {
  if (!value || typeof value !== "object") return {};
  const disabled = {};
  for (const [id, off] of Object.entries(value)) {
    if (off === true) disabled[id] = true;
  }
  return disabled;
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

function readPenalty(value, fallback) {
  if (typeof value === "number" && value >= 0 && value <= 2) return value;
  return fallback;
}

function formatCredits(value) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function formatScore(value) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function preferenceOf(course, preferences) {
  return preferences[course.id] ?? course.preference;
}

function withStandardTotal(raw) {
  if (!raw) return raw;
  return {
    ...raw,
    requirements: {
      ...(raw.requirements ?? {}),
      totalCredits: STANDARD_TOTAL,
    },
  };
}

function withExtraCredits(requirements, enabled) {
  if (!requirements || !enabled) return requirements;
  return {
    ...requirements,
    totalCredits: requirements.totalCredits + EXTRA_CREDITS,
    totalUnits: requirements.totalUnits + EXTRA_CREDITS * 2,
  };
}

export function App() {
  const stored = useMemo(() => readStorage(), []);
  const [preferences, setPreferences] = useState(() => readPreferences(stored.preferences));
  const [forced, setForced] = useState(() => readForced(stored.forced));
  const [overagePenalty, setOveragePenalty] = useState(() => readPenalty(stored.overagePenalty, 0.75));
  const [theoryPenalty, setTheoryPenalty] = useState(() =>
    readPenalty(stored.theoryPenalty, readPenalty(stored.overagePenalty, 0.75)),
  );
  const [semesters, setSemesters] = useState(() => readSemesters(stored.semesters));
  const [extraElectives, setExtraElectives] = useState(() => stored.extraElectives === true);
  const [catalogSource, setCatalogSource] = useState(() => (stored.catalogSource === "custom" ? "custom" : "tum"));
  const [customRaw, setCustomRaw] = useState(() => readStoredCatalog(CATALOG_KEY));
  const [tumRaw, setTumRaw] = useState(() => readStoredCatalog(TUM_CACHE_KEY));
  const [tumNonce, setTumNonce] = useState(0);
  const [tumState, setTumState] = useState({ status: "idle", message: "" });
  const [disabledAreas, setDisabledAreas] = useState(() => readDisabledAreas(stored.disabledAreas));
  const [collapsedAreas, setCollapsedAreas] = useState({});
  const [query, setQuery] = useState("");
  const [areaFilter, setAreaFilter] = useState("all");
  const [onlyPlan, setOnlyPlan] = useState(false);
  const [onlyTheory, setOnlyTheory] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const settingsRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [planIndex, setPlanIndex] = useState(0);
  const [altPlanIndex, setAltPlanIndex] = useState(null);
  const [hintsOpen, setHintsOpen] = useState(() => {
    try {
      return localStorage.getItem(HINTS_KEY) !== "seen";
    } catch {
      return true;
    }
  });
  const [infoOpen, setInfoOpen] = useState(false);
  const infoRef = useRef(null);

  const activeRaw = catalogSource === "custom" && customRaw ? customRaw : withStandardTotal(tumRaw);
  const catalog = useMemo(() => (activeRaw ? normalizeCatalog(activeRaw) : null), [activeRaw]);
  const requirements = useMemo(
    () => withExtraCredits(catalog?.requirements ?? null, extraElectives),
    [catalog, extraElectives],
  );

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          preferences,
          forced,
          overagePenalty,
          theoryPenalty,
          semesters,
          extraElectives,
          catalogSource,
          disabledAreas,
        }),
      );
    } catch {
      // Private mode can block storage. The session still works.
    }
  }, [preferences, forced, overagePenalty, theoryPenalty, semesters, extraElectives, catalogSource, disabledAreas]);

  useEffect(() => {
    if (catalogSource !== "tum") return undefined;
    let cancelled = false;
    setTumState({ status: "loading", message: "Loading the study plan…" });
    fetchTumElectives((message) => {
      if (!cancelled) setTumState({ status: "loading", message });
    })
      .then((collected) => {
        if (cancelled) return;
        const next = buildImportedCatalog(null, collected);
        setTumRaw(next);
        try {
          localStorage.setItem(TUM_CACHE_KEY, JSON.stringify(next));
        } catch {
          // The fresh list still stays in memory for this visit.
        }
        setTumState({ status: "ready", message: collected.summary });
      })
      .catch((error) => {
        if (cancelled) return;
        setTumState({
          status: "error",
          message: error instanceof Error ? error.message : "The TUM catalog could not be loaded.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [catalogSource, tumNonce]);

  useEffect(() => {
    if (!settingsOpen && !infoOpen) return undefined;
    function onPointer(event) {
      if (settingsOpen && !settingsRef.current?.contains(event.target)) setSettingsOpen(false);
      if (infoOpen && !infoRef.current?.contains(event.target)) setInfoOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        setInfoOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [settingsOpen, infoOpen]);

  useEffect(() => {
    try {
      if (customRaw) localStorage.setItem(CATALOG_KEY, JSON.stringify(customRaw));
      else localStorage.removeItem(CATALOG_KEY);
    } catch {
      // The custom list stays in memory for this session.
    }
  }, [customRaw]);

  const consideredCourses = useMemo(
    () => (catalog ? catalog.courses.filter((course) => !disabledAreas[course.area]) : []),
    [catalog, disabledAreas],
  );

  const result = useMemo(() => {
    if (!requirements) return null;
    return recommend(consideredCourses, requirements, {
      preferences,
      forced,
      overagePenalty,
      theoryPenalty,
      semesters,
    });
  }, [consideredCourses, requirements, preferences, forced, overagePenalty, theoryPenalty, semesters]);

  const plans = result?.plans?.length ? result.plans : [];
  const plan = plans[Math.min(planIndex, plans.length - 1)] ?? null;
  const alternativesByPlan = useMemo(() => {
    if (!requirements) return plans.map(() => []);
    return plans.map((item) => planAlternatives(item, consideredCourses, requirements, semesters));
  }, [plans, consideredCourses, requirements, semesters]);

  useEffect(() => {
    setPlanIndex(0);
  }, [preferences, forced, overagePenalty, theoryPenalty, semesters, extraElectives, activeRaw, disabledAreas]);

  const selectedIds = useMemo(() => new Set(plan?.courses.map((course) => course.id) ?? []), [plan]);

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

  function activateAlternative(swap) {
    const outgoingPreference = preferenceOf(swap.outgoing, preferences);
    const incomingPreference = preferenceOf(swap.incoming, preferences);
    setPreferences((current) => ({
      ...current,
      [swap.incoming.id]: Math.max(incomingPreference, outgoingPreference, 1),
      [swap.outgoing.id]: 0,
    }));
    setForced((current) => {
      const next = { ...current };
      delete next[swap.outgoing.id];
      next[swap.incoming.id] = true;
      return next;
    });
    setPlanIndex(0);
    setAltPlanIndex(0);
  }

  function toggleSemester(id) {
    setSemesters((current) => {
      if (current[id] && Object.values(current).filter(Boolean).length === 1) return current;
      return { ...current, [id]: !current[id] };
    });
  }

  function toggleArea(areaId) {
    setDisabledAreas((current) => {
      const next = { ...current };
      if (next[areaId]) delete next[areaId];
      else next[areaId] = true;
      return next;
    });
  }

  function toggleCollapsed(areaId) {
    setCollapsedAreas((current) => ({ ...current, [areaId]: !current[areaId] }));
  }

  function resetStored() {
    setPreferences({});
    setForced({});
    setOveragePenalty(0.75);
    setTheoryPenalty(0.75);
    setSemesters({ winter: true, summer: true });
    setExtraElectives(false);
    setDisabledAreas({});
  }

  function saveCustom(next) {
    setCustomRaw(next);
    setCatalogSource("custom");
  }

  function dismissHints() {
    setHintsOpen(false);
    try {
      localStorage.setItem(HINTS_KEY, "seen");
    } catch {
      // The hints stay hidden for this visit.
    }
  }

  function exportCatalog() {
    if (!activeRaw) return;
    const courses = (activeRaw.courses ?? []).map((course) => ({
      ...course,
      preference: preferences[course.id] ?? course.preference,
    }));
    const blob = new Blob([JSON.stringify({ ...activeRaw, courses }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "modules.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  function focusCourse(courseId) {
    document.getElementById(`course-${courseId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function copyPlan() {
    if (!plan || !requirements) return;
    try {
      await navigator.clipboard.writeText(planText(plan, requirements, areaById));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const usingCustom = catalogSource === "custom" && Boolean(customRaw);
  const usingTum = catalogSource === "tum";
  const filterCount = [query.trim(), areaFilter !== "all", onlyTheory, onlyPlan, !semesters.winter || !semesters.summer].filter(
    Boolean,
  ).length;

  if (!catalog?.requirements || !requirements || !plan) {
    const waiting = catalogSource !== "custom" && !tumRaw && tumState.status !== "error";
    return (
      <main className="fatal">
        <p className="eyebrow">TUM Informatics</p>
        <h1>{waiting ? "Loading modules" : "This module list cannot be read"}</h1>
        {waiting ? (
          <p className="quiet-fatal">{tumState.message || "Fetching the current catalog from TUMonline."}</p>
        ) : (
          <ul>
            {(catalog?.errors ?? [tumState.message || "The TUM catalog is not available yet."]).map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
        {!waiting && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setCatalogSource("tum");
              setTumNonce((nonce) => nonce + 1);
            }}
          >
            Try again
          </button>
        )}
      </main>
    );
  }

  const { meta } = catalog;
  const areaById = new Map(requirements.areas.map((area) => [area.id, area]));
  const blockSum = requirements.areaQuotas.reduce((sum, quota) => sum + quota, 0);
  const openCredits = Math.max(0, requirements.totalCredits - blockSum - requirements.theoreticalCredits);
  const baseTotal = requirements.totalCredits - (extraElectives ? EXTRA_CREDITS : 0);
  const needle = query.trim().toLowerCase();
  const visibleAreas = requirements.areas.filter((area) => areaFilter === "all" || area.id === areaFilter);

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <p className="eyebrow">TUM Informatics</p>
          <h1>{meta.title && meta.title !== "Kurswahl" ? meta.title : "Course selection"}</h1>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className={filtersOpen ? "toggle on" : "toggle"}
            aria-expanded={filtersOpen}
            aria-controls="filters"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            Filters
            {filterCount > 0 && <span className="count">{filterCount}</span>}
            </button>
          <div className="settings" ref={settingsRef}>
            <button
              type="button"
              className={settingsOpen ? "toggle on" : "toggle"}
              aria-expanded={settingsOpen}
              aria-controls="settings-panel"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              Settings
            </button>
            {settingsOpen && (
              <div className="settings-pop" id="settings-panel" role="dialog" aria-label="Penalties">
                <PenaltySlider
                  label="Credit penalty"
                  hint="Per credit above the total."
                  value={overagePenalty}
                  onChange={setOveragePenalty}
                />
                <PenaltySlider
                  label="Theory penalty"
                  hint="Per theory credit above the minimum."
                  value={theoryPenalty}
                  onChange={setTheoryPenalty}
                />
              </div>
            )}
          </div>
              <button type="button" className="toggle" onClick={() => setEditorOpen(true)}>
                Modules
                {usingCustom && <span className="count">My list</span>}
              </button>
        </div>
      </header>

      <main className="catalog">
        <div className="catalog-inner">
          <ul className="rules">
            <li>{formatCredits(requirements.totalCredits)} ECTS in total</li>
            <li>Blocks {requirements.areaQuotas.map((quota) => formatCredits(quota)).join(" · ")}</li>
            <li>At least {formatCredits(requirements.theoreticalCredits)} theory</li>
            <li className={["rule-open", extraElectives ? "on" : "", infoOpen ? "pop-open" : ""].filter(Boolean).join(" ")}>
                <button
                  type="button"
                  className={extraElectives ? "chip-switch on" : "chip-switch"}
                  aria-pressed={extraElectives}
                  aria-label="Add 10 ECTS instead of the internship"
                  onClick={() => setExtraElectives((enabled) => !enabled)}
                >
                  <span />
                </button>
                {formatCredits(openCredits)} ECTS from any area
                <span className="info" ref={infoRef}>
                  <button
                    type="button"
                    className="info-button"
                    aria-expanded={infoOpen}
                    aria-label="About these credits"
                    onClick={() => setInfoOpen((open) => !open)}
                  >
                    i
                  </button>
                  {infoOpen && (
                    <span className="info-pop" role="dialog">
                      Instead of the internship you can take {EXTRA_CREDITS} more ECTS from any area. The blocks stay the same, so this pool grows by {EXTRA_CREDITS} and the total goes from {formatCredits(baseTotal)} to {formatCredits(baseTotal + EXTRA_CREDITS)}.
                    </span>
                  )}
                </span>
              </li>
          </ul>

          {usingTum && tumState.status === "loading" && (
            <p className="note">Loading the current modules from TUM. {tumState.message}</p>
          )}
          {usingTum && tumState.status === "error" && <p className="note warn">{tumState.message}</p>}

          {hintsOpen && (
            <aside className="hints" aria-label="How to use this">
              <div>
                <p className="eyebrow">Start here</p>
                <ol>
                  <li>Rate a module from 0 to 5. The plan on the side updates.</li>
                  <li>Exclude a whole area, or fold it with the arrow.</li>
                  <li>The free-ECTS chip swaps the internship for 10 more credits. Penalties are under Settings.</li>
                </ol>
              </div>
              <button type="button" className="text-button" onClick={dismissHints}>
                Got it
              </button>
            </aside>
          )}

          {catalog.warnings.length > 0 && (
            <ul className="note warn">
              {catalog.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          {filtersOpen && (
            <div className="toolbar" id="filters">
              <label className="search">
                <span className="sr-only">Search modules</span>
                <input
                  type="search"
                  value={query}
                  placeholder="Name or module id"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <label className="filter">
                <span className="sr-only">Area</span>
                <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
                  <option value="all">All areas</option>
                  {requirements.areas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check">
                <input type="checkbox" checked={onlyTheory} onChange={(event) => setOnlyTheory(event.target.checked)} />
                Theory only
              </label>
              <label className="check">
                <input type="checkbox" checked={onlyPlan} onChange={(event) => setOnlyPlan(event.target.checked)} />
                In this plan
              </label>
              <div className="semester-toggle" role="group" aria-label="Semesters included">
                <button type="button" aria-pressed={semesters.winter} onClick={() => toggleSemester("winter")}>
                  Winter
                </button>
                <button type="button" aria-pressed={semesters.summer} onClick={() => toggleSemester("summer")}>
                  Summer
                </button>
              </div>
            </div>
          )}

          {visibleAreas.map((area) => {
            const tone = requirements.areas.findIndex((item) => item.id === area.id);
            const color = AREA_COLORS[tone % AREA_COLORS.length];
            const courses = catalog.courses.filter((course) => {
              if (course.area !== area.id) return false;
              if (onlyTheory && !course.theoretical) return false;
              if (onlyPlan && !selectedIds.has(course.id)) return false;
              if (needle && !`${course.id} ${course.name}`.toLowerCase().includes(needle)) return false;
              return true;
            });
            const areaCredits = plan.totals.areas[area.id] ?? 0;
            const slot = plan.assignment.find((item) => item.areaId === area.id);
            const met = !slot || slot.missing === 0;
            const excluded = Boolean(disabledAreas[area.id]);
            const collapsed = Boolean(collapsedAreas[area.id]);
            return (
              <section key={area.id} className={excluded ? "area excluded" : "area"}>
                <div className="area-head">
                  <h2>{area.name}</h2>
                  <div className="area-tools">
                    <button
                      type="button"
                      className={excluded ? "area-toggle on" : "area-toggle"}
                      aria-pressed={excluded}
                      onClick={() => toggleArea(area.id)}
                    >
                      {excluded ? "Excluded" : "Exclude"}
                    </button>
                    <p className={excluded ? "area-status idle" : slot ? (met ? "area-status met" : "area-status") : "area-status idle"}>
                      {excluded
                        ? "Left out"
                        : slot
                          ? `${formatCredits(areaCredits)} ECTS · block ${formatCredits(slot.quotaCredits)}`
                          : `${formatCredits(areaCredits)} ECTS`}
                    </p>
                    <button
                      type="button"
                      className={collapsed ? "chevron" : "chevron open"}
                      aria-expanded={!collapsed}
                      aria-label={collapsed ? `Expand ${area.name}` : `Collapse ${area.name}`}
                      onClick={() => toggleCollapsed(area.id)}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M4 6l4 4 4-4" />
                      </svg>
                    </button>
                  </div>
                </div>
                {collapsed ? null : courses.length === 0 ? (
                  <p className="empty">No modules match these filters.</p>
                ) : (
                  <ul className="course-list">
                    {courses.map((course) => (
                      <CourseRow
                        key={course.id}
                        course={course}
                        area={{ ...area, tone, color }}
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

      <aside className="plan" aria-label="Recommended plan">
        <div className="plan-inner">
          <div className="plan-heading">
            <h2>{plan.feasible ? `Plan ${Math.min(planIndex, plans.length - 1) + 1}` : "Closest plan"}</h2>
            <p className="status" aria-live="polite">
              {plan.courses.length} modules · {formatCredits(plan.totals.credits)} ECTS
              {plan.feasible ? "" : " · short"}
            </p>
          </div>
          <nav className="plan-nav" aria-label="Best plans">
            {plans.map((item, index) => {
              const alternativeCount = alternativesByPlan[index]?.length ?? 0;
              const selected = index === Math.min(planIndex, plans.length - 1);
              return (
                <div key={item.courses.map((course) => course.id).join("-") || index} className="plan-row">
                  <button
                    type="button"
                    className="plan-pick"
                    aria-pressed={selected}
                    onClick={() => setPlanIndex(index)}
                  >
                    <span>{index + 1}</span>
                    <span>
                      {formatCredits(item.totals.credits)} ECTS · {formatCredits(item.totals.theoretical)} theory
                    </span>
                    <span>{formatScore(item.score)}</span>
                  </button>
                  <button
                    type="button"
                    className="alt-count"
                    disabled={alternativeCount === 0}
                    aria-label={`${alternativeCount} alternatives`}
                    onClick={() => {
                      setPlanIndex(index);
                      setAltPlanIndex(index);
                    }}
                  >
                    {alternativeCount}
                  </button>
                </div>
              );
            })}
          </nav>

          {!plan.feasible && (
            <div className="banner">
              <strong>The rated modules do not cover the requirements.</strong>
              <ul>
                {deficitLines(plan, requirements).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          <AreaSplit plan={plan} areas={requirements.areas} goal={requirements.totalCredits} />
          <Meter
            label="Theory"
            value={plan.totals.theoretical}
            goal={requirements.theoreticalCredits}
            overage={plan.totals.theoryOverage}
          />

          <p className="score-line">
            Score {formatScore(plan.score)}
            <span>
              Preference {formatScore(plan.preferenceSum)} · penalty −{formatScore(plan.penalty)}
            </span>
          </p>

          <div className="controls">
            <div className="plan-actions">
              <button type="button" className="ghost" onClick={copyPlan}>
                {copied ? "Copied" : "Copy plan"}
              </button>
              <button type="button" className="ghost" onClick={resetStored}>
                Reset choices
              </button>
            </div>
          </div>

          {semesterGroups(catalog.courses, plan.courses).map((semester) => {
            const courses = plan.courses.filter((course) => course.semester === semester.id);
            const credits = courses.reduce((sum, course) => sum + course.credits, 0);
            return (
              <section key={semester.title} className="semester">
                <h3>
                  {semester.title}
                  <span>{courses.length === 0 ? "none" : `${formatCredits(credits)} ECTS`}</span>
                </h3>
                {courses.length === 0 ? (
                  <p className="quiet">Nothing is planned in this semester.</p>
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
                            {course.theoretical ? " · Theory" : ""}
                            {forced[course.id] ? " · pinned" : ""}
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
              Pinned modules stay in the plan even when their semester is excluded:{" "}
              {plan.forcedOutsideSemester.map((course) => course.name).join(", ")}.
            </p>
          )}
          {plan.atOverageLimit && (
            <p className="quiet">
              The search compares plans with at most {formatCredits(plan.maxOverage)} extra credits.
            </p>
          )}
        </div>
      </aside>

      {altPlanIndex != null && plans.length > 0 && (
        <AlternativeDialog
          planNumber={Math.min(altPlanIndex, plans.length - 1) + 1}
          swaps={alternativesByPlan[Math.min(altPlanIndex, plans.length - 1)] ?? []}
          areaById={areaById}
          preferences={preferences}
          onActivate={activateAlternative}
          onClose={() => setAltPlanIndex(null)}
        />
      )}

      <CatalogEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        source={usingCustom ? "custom" : "tum"}
        customRaw={customRaw}
        tumRaw={tumRaw}
        tumStatus={tumState.status}
        tumMessage={tumState.message}
        onUseTum={() => {
          setCatalogSource("tum");
          setTumNonce((nonce) => nonce + 1);
        }}
        onUseCustom={() => customRaw && setCatalogSource("custom")}
        onSaveCustom={saveCustom}
        onExport={exportCatalog}
      />
    </div>
  );
}

function PenaltySlider({ label, hint, value, onChange }) {
  return (
    <label className="penalty">
      <span>
        {label}
        <strong>{formatScore(value)}</strong>
      </span>
      <input
        type="range"
        min="0"
        max="2"
        step="0.05"
        value={value}
        onChange={(event) => onChange(Math.round(Number(event.target.value) * 20) / 20)}
      />
      <small>{hint}</small>
    </label>
  );
}

function CourseRow({ course, area, preference, forced, selected, semesterClosed, onPreference, onToggleForced }) {
  return (
    <li id={`course-${course.id}`} className={selected ? "course selected" : "course"}>
      <div className="course-main">
        <div className="course-title">
          <span className="code">{course.id}</span>
          <h3>{course.name}</h3>
          {selected && <span className="pill">In plan</span>}
          {semesterClosed && !forced && <span className="pill muted">Off</span>}
        </div>
        <p className="meta">
          <span
            className="tag"
            style={{ background: `${area.color}22`, color: area.color }}
          >
            {area.short || area.name}
          </span>
          <span>{formatCredits(course.credits)} ECTS</span>
          <span>{course.semester ? SEMESTER_LABEL[course.semester] : "Either"}</span>
          {course.theoretical && <span>Theory</span>}
        </p>
      </div>
      <div className="course-actions">
        <div className="prefs" role="group" aria-label={`Preference for ${course.name}`}>
          {PREFERENCES.map((level) => (
            <button
              key={level.value}
              type="button"
              aria-pressed={preference === level.value}
              title={level.hint}
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
          title="Always include"
          onClick={() => onToggleForced(course.id)}
        >
          Pin
        </button>
      </div>
    </li>
  );
}

function AreaSplit({ plan, areas, goal }) {
  const parts = areas
    .map((area, index) => ({
      id: area.id,
      short: area.short || area.name,
      credits: plan.totals.areas[area.id] ?? 0,
      color: AREA_COLORS[index % AREA_COLORS.length],
      block: plan.assignment.find((slot) => slot.areaId === area.id)?.quotaCredits ?? 0,
    }))
    .filter((part) => part.credits > 0);
  const total = parts.reduce((sum, part) => sum + part.credits, 0);
  return (
    <div className="split">
      <div className="meter-label">
        <span>Areas</span>
        <span>
          {formatCredits(plan.totals.credits)} / {formatCredits(goal)}
          {plan.totals.overage > 0 ? ` · +${formatCredits(plan.totals.overage)}` : ""}
        </span>
      </div>
      <div
        className="split-track"
        role="img"
        aria-label={
          parts.length === 0
            ? "No credits selected"
            : parts.map((part) => `${part.short} ${formatCredits(part.credits)} ECTS`).join(", ")
        }
      >
        {total > 0 &&
          parts.map((part) => (
            <span key={part.id} style={{ width: `${(part.credits / total) * 100}%`, background: part.color }} />
          ))}
      </div>
      {parts.length > 0 && (
        <ul className="split-legend">
          {parts.map((part) => (
            <li key={part.id}>
              <i style={{ background: part.color }} />
              {part.short} {formatCredits(part.credits)}
              {part.block > 0 ? ` · block ${formatCredits(part.block)}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
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

function semesterGroups(catalogCourses, planCourses) {
  const groups = [
    { id: "winter", title: "Winter" },
    { id: "summer", title: "Summer" },
  ];
  const hasOpen = [...catalogCourses, ...planCourses].some((course) => course.semester == null);
  if (hasOpen) groups.push({ id: null, title: "Either semester" });
  return groups;
}

function deficitLines(plan, requirements) {
  const lines = [];
  const areaById = new Map(requirements.areas.map((area) => [area.id, area]));
  if (plan.deficits.credits > 0) lines.push(`${formatCredits(plan.deficits.credits)} ECTS short of the total`);
  if (plan.deficits.theoretical > 0) lines.push(`${formatCredits(plan.deficits.theoretical)} ECTS of theory`);
  for (const slot of plan.assignment) {
    if (slot.missing <= 0) continue;
    const name = areaById.get(slot.areaId)?.name;
    lines.push(
      name
        ? `${formatCredits(slot.missing)} ECTS in ${name} for the ${formatCredits(slot.quotaCredits)}-ECTS block`
        : `${formatCredits(slot.quotaCredits)} ECTS from another area`,
    );
  }
  if (lines.length === 0) lines.push("No valid plan fits inside the search limit.");
  return lines;
}

function planText(plan, requirements, areaById) {
  const lines = [
    plan.feasible ? "Recommended plan" : "Closest plan",
    `${plan.courses.length} modules, ${formatCredits(plan.totals.credits)} ECTS (goal ${formatCredits(requirements.totalCredits)})`,
    `Theory: ${formatCredits(plan.totals.theoretical)} / ${formatCredits(requirements.theoreticalCredits)} ECTS`,
  ];
  for (const slot of plan.assignment) {
    const name = slot.areaId ? areaById.get(slot.areaId)?.name : "open area";
    lines.push(`${formatCredits(slot.quotaCredits)}-ECTS block: ${name} (${formatCredits(slot.credits)} ECTS)`);
  }
  lines.push("");
  for (const semester of semesterGroups(plan.courses, plan.courses)) {
    lines.push(semester.title);
    const courses = plan.courses.filter((course) => course.semester === semester.id);
    if (courses.length === 0) lines.push("- none");
    for (const course of courses) {
      lines.push(
        `- ${course.id} ${course.name} (${areaById.get(course.area)?.short ?? areaById.get(course.area)?.name}, ${formatCredits(course.credits)} ECTS${course.theoretical ? ", theory" : ""})`,
      );
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function AlternativeDialog({ planNumber, swaps, areaById, preferences, onActivate, onClose }) {
  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = [];
  const byId = new Map();
  for (const swap of swaps) {
    let group = byId.get(swap.outgoing.id);
    if (!group) {
      group = { outgoing: swap.outgoing, swaps: [] };
      byId.set(swap.outgoing.id, group);
      groups.push(group);
    }
    group.swaps.push(swap);
  }

  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div
        className="dialog alternatives"
        role="dialog"
        aria-label={`Alternatives for plan ${planNumber}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <div>
            <p className="eyebrow">Plan {planNumber}</p>
            <h2>Alternatives</h2>
            <p>
              Another module with the same credits can take this place. Picking one pins it and sets the replaced
              module to 0.
            </p>
          </div>
          <button type="button" className="text-button" onClick={onClose}>
            Close
          </button>
        </div>
        {groups.length === 0 ? (
          <p className="form-note">This plan has no swaps.</p>
        ) : (
          groups.map((group) => (
            <section key={group.outgoing.id} className="alt-group">
              <h3>
                Instead of <b>{group.outgoing.id}</b> {group.outgoing.name}
              </h3>
              <ul>
                {group.swaps.map((swap) => {
                  const area = areaById.get(swap.incoming.area);
                  const preference = preferenceOf(swap.incoming, preferences);
                  return (
                    <li key={`${group.outgoing.id}-${swap.incoming.id}`}>
                      <button type="button" onClick={() => onActivate(swap)}>
                        <span>
                          <b>{swap.incoming.id}</b> {swap.incoming.name}
                        </span>
                        <small>
                          {area?.short ?? area?.name} · {formatCredits(swap.incoming.credits)} ECTS
                          {swap.incoming.theoretical ? " · Theory" : ""}
                          {swap.incoming.semester ? ` · ${SEMESTER_LABEL[swap.incoming.semester]}` : ""}
                          {preference > 0 ? ` · preference ${preference}` : " · unrated"}
                        </small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
