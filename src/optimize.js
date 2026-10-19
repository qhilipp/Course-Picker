/** ECTS werden in Halb-Credit-Schritten gerechnet, damit 7,5 Credits exakt bleiben. */
const SCALE = 2;

const SEMESTERS = {
  winter: "winter",
  ws: "winter",
  wintersemester: "winter",
  summer: "summer",
  ss: "summer",
  sommersemester: "summer",
};

function unitsFromCredits(credits) {
  const value = Number(credits);
  if (!Number.isFinite(value) || value <= 0 || value > 60) return null;
  const units = Math.round(value * SCALE);
  if (Math.abs(units / SCALE - value) > 1e-6) return null;
  return units;
}

function creditsFromUnits(units) {
  return units / SCALE;
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function emptyResult(requirements) {
  const areas = {};
  for (const area of requirements?.areas ?? []) areas[area.id] = 0;
  return {
    feasible: false,
    courses: [],
    totals: { credits: 0, theoretical: 0, overage: 0, areas },
    deficits: {
      credits: requirements?.totalCredits ?? 0,
      theoretical: requirements?.theoreticalCredits ?? 0,
    },
    assignment: (requirements?.areaQuotas ?? []).map((quota) => ({
      areaId: null,
      quotaCredits: quota,
      credits: 0,
      missing: quota,
    })),
    preferenceSum: 0,
    penalty: 0,
    score: 0,
    atOverageLimit: false,
    maxOverage: requirements?.maxOverage ?? 24,
    consideredCount: 0,
    forcedOutsideSemester: [],
  };
}

function assignQuotas(creditUnits, areas, quotaUnits) {
  const ranked = areas
    .map((area, index) => ({ area, units: creditUnits[index] ?? 0 }))
    .sort((a, b) => b.units - a.units || a.area.id.localeCompare(b.area.id));
  const quotas = [...quotaUnits].sort((a, b) => b - a);
  let shortfallUnits = 0;
  const assignment = quotas.map((quota, index) => {
    const slot = ranked[index];
    const units = slot?.units ?? 0;
    const missing = Math.max(0, quota - units);
    shortfallUnits += missing;
    return {
      areaId: slot?.area.id ?? null,
      quotaCredits: creditsFromUnits(quota),
      credits: creditsFromUnits(units),
      missing: creditsFromUnits(missing),
    };
  });
  return { assignment, shortfallUnits };
}

export function normalizeCatalog(raw) {
  const errors = [];
  const warnings = [];
  const meta = raw && typeof raw === "object" && raw.meta && typeof raw.meta === "object" ? raw.meta : {};

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      meta,
      requirements: null,
      courses: [],
      errors: ["courses.json hat kein gültiges Objektformat."],
      warnings,
    };
  }

  const req = raw.requirements;
  if (!req || typeof req !== "object" || Array.isArray(req)) {
    return {
      meta,
      requirements: null,
      courses: [],
      errors: ["In courses.json fehlt das Objekt requirements."],
      warnings,
    };
  }

  const totalUnits = unitsFromCredits(req.totalCredits);
  if (totalUnits == null) {
    errors.push("requirements.totalCredits muss eine positive ECTS-Zahl sein (bis 60, in 0,5er-Schritten).");
  }

  let theoryUnits = 0;
  if (req.theoreticalCredits == null) {
    theoryUnits = 0;
  } else if (req.theoreticalCredits === 0) {
    theoryUnits = 0;
  } else {
    theoryUnits = unitsFromCredits(req.theoreticalCredits);
    if (theoryUnits == null) {
      errors.push("requirements.theoreticalCredits muss 0 oder eine positive ECTS-Zahl sein.");
    }
  }

  const overagePenalty = req.overagePenalty == null ? 0.75 : Number(req.overagePenalty);
  if (!Number.isFinite(overagePenalty) || overagePenalty < 0) {
    errors.push("requirements.overagePenalty muss eine Zahl ≥ 0 sein.");
  }

  const maxOverage = req.maxOverage == null ? 24 : Number(req.maxOverage);
  if (!Number.isFinite(maxOverage) || maxOverage < 0 || maxOverage > 120) {
    errors.push("requirements.maxOverage muss eine Zahl zwischen 0 und 120 sein.");
  }

  const areas = [];
  const seenAreas = new Set();
  if (!Array.isArray(req.areas) || req.areas.length === 0) {
    errors.push("requirements.areas braucht mindestens einen Bereich.");
  } else if (req.areas.length > 8) {
    errors.push("Es werden höchstens acht Bereiche unterstützt.");
  } else {
    for (const area of req.areas) {
      if (!area || typeof area.id !== "string" || area.id.trim() === "") {
        errors.push("Jeder Bereich braucht eine id.");
        continue;
      }
      const id = area.id.trim();
      if (seenAreas.has(id)) {
        errors.push(`Bereichs-ID „${id}“ ist doppelt.`);
        continue;
      }
      seenAreas.add(id);
      const name = typeof area.name === "string" && area.name.trim() ? area.name.trim() : id;
      const short = typeof area.short === "string" && area.short.trim() ? area.short.trim() : name;
      areas.push({ id, name, short });
    }
  }

  const areaQuotaUnits = [];
  if (!Array.isArray(req.areaQuotas) || req.areaQuotas.length === 0) {
    errors.push("requirements.areaQuotas braucht die Blockgrößen, zum Beispiel [18, 8, 8].");
  } else {
    for (const quota of req.areaQuotas) {
      if (quota === 0) {
        areaQuotaUnits.push(0);
        continue;
      }
      const units = unitsFromCredits(quota);
      if (units == null) {
        errors.push(`Eine Blockgröße in areaQuotas ist ungültig: ${quota}.`);
      } else {
        areaQuotaUnits.push(units);
      }
    }
  }

  const requirements =
    errors.length > 0
      ? null
      : {
          totalCredits: creditsFromUnits(totalUnits),
          totalUnits,
          theoreticalCredits: creditsFromUnits(theoryUnits ?? 0),
          theoreticalUnits: theoryUnits ?? 0,
          overagePenalty,
          maxOverage,
          areaQuotas: areaQuotaUnits.map(creditsFromUnits),
          areaQuotaUnits,
          areas,
        };

  const courses = [];
  const seenIds = new Set();
  const source = Array.isArray(raw.courses) ? raw.courses : [];
  if (!Array.isArray(raw.courses)) {
    errors.push("courses muss eine Liste sein.");
  }

  for (const course of source) {
    if (!course || typeof course !== "object") {
      warnings.push("Ein Eintrag in courses ist kein Objekt und wurde übersprungen.");
      continue;
    }
    const name = typeof course.name === "string" ? course.name.trim() : "";
    if (!name) {
      warnings.push("Ein Kurs ohne Namen wurde übersprungen.");
      continue;
    }
    let id = typeof course.id === "string" && course.id.trim() ? course.id.trim() : slugify(name);
    if (!id) {
      warnings.push(`„${name}“ hat keine verwendbare ID und wurde übersprungen.`);
      continue;
    }
    if (seenIds.has(id)) {
      warnings.push(`Die ID „${id}“ ist doppelt. „${name}“ wurde übersprungen.`);
      continue;
    }
    const units = unitsFromCredits(course.credits);
    if (units == null) {
      warnings.push(`„${name}“ hat ungültige Credits und wurde übersprungen.`);
      continue;
    }
    let semester = null;
    if (course.semester != null && String(course.semester).trim() !== "") {
      const semesterKey = String(course.semester).trim().toLowerCase();
      semester = SEMESTERS[semesterKey] ?? null;
      if (!semester) {
        warnings.push(`„${name}“ braucht semester „winter“ oder „summer“ und wurde übersprungen.`);
        continue;
      }
    }
    if (requirements && !requirements.areas.some((area) => area.id === course.area)) {
      warnings.push(`„${name}“ verweist auf den unbekannten Bereich „${course.area}“ und wurde übersprungen.`);
      continue;
    }
    if (!requirements && (typeof course.area !== "string" || !course.area.trim())) {
      warnings.push(`„${name}“ hat keinen Bereich und wurde übersprungen.`);
      continue;
    }
    let preference = course.preference;
    if (preference == null) preference = 3;
    if (typeof preference !== "number" || !Number.isFinite(preference)) {
      warnings.push(`Präferenz von „${name}“ ist ungültig und wurde auf 3 gesetzt.`);
      preference = 3;
    }
    const rounded = Math.round(preference);
    if (rounded !== preference || rounded < 0 || rounded > 5) {
      warnings.push(`Präferenz von „${name}“ wurde auf eine ganze Zahl von 0 bis 5 begrenzt.`);
    }
    preference = Math.min(5, Math.max(0, rounded));
    if (typeof course.theoretical !== "boolean" && course.theoretical != null) {
      warnings.push(`„${name}“: theoretical muss true oder false sein und wurde als false gelesen.`);
    }
    const theoretical = course.theoretical === true;
    seenIds.add(id);
    courses.push({
      id,
      name,
      credits: creditsFromUnits(units),
      units,
      semester,
      preference,
      theoretical,
      area: course.area,
    });
  }

  return { meta, requirements, courses, errors, warnings };
}

export function evaluateSelection(courses, requirements, overagePenalty) {
  const areas = {};
  const areaUnits = {};
  for (const area of requirements.areas) {
    areas[area.id] = 0;
    areaUnits[area.id] = 0;
  }
  let totalUnits = 0;
  let theoryUnits = 0;
  let preferenceSum = 0;
  for (const course of courses) {
    totalUnits += course.units;
    areaUnits[course.area] += course.units;
    areas[course.area] = creditsFromUnits(areaUnits[course.area]);
    if (course.theoretical) theoryUnits += course.units;
    preferenceSum += course.preference;
  }

  const deficits = { credits: 0, theoretical: 0 };
  let deficitUnits = Math.max(0, requirements.totalUnits - totalUnits);
  deficits.credits = creditsFromUnits(deficitUnits);
  const theoryShort = Math.max(0, requirements.theoreticalUnits - theoryUnits);
  deficitUnits += theoryShort;
  deficits.theoretical = creditsFromUnits(theoryShort);
  const creditUnits = requirements.areas.map((area) => areaUnits[area.id]);
  const { assignment, shortfallUnits } = assignQuotas(
    creditUnits,
    requirements.areas,
    requirements.areaQuotaUnits,
  );
  deficitUnits += shortfallUnits;

  const excessUnits = Math.max(0, totalUnits - requirements.totalUnits);
  const theoryExcessUnits = Math.max(0, theoryUnits - requirements.theoreticalUnits);
  const penaltyMilli = Math.max(0, Math.round(Number(overagePenalty) * 1000));
  const penalty = (penaltyMilli * (excessUnits + theoryExcessUnits)) / (SCALE * 1000);
  return {
    feasible: deficitUnits === 0,
    totals: {
      credits: creditsFromUnits(totalUnits),
      theoretical: creditsFromUnits(theoryUnits),
      overage: creditsFromUnits(excessUnits),
      theoryOverage: creditsFromUnits(theoryExcessUnits),
      areas,
    },
    deficits,
    assignment,
    deficitUnits,
    preferenceSum,
    penalty,
    score: preferenceSum - penalty,
  };
}

function netMilli(preferenceSum, totalUnits, targetUnits, theoryUnits, theoryTargetUnits, penaltyMilli) {
  const excessUnits = Math.max(0, totalUnits - targetUnits);
  const theoryExcessUnits = Math.max(0, theoryUnits - theoryTargetUnits);
  return preferenceSum * 1000 * SCALE - penaltyMilli * (excessUnits + theoryExcessUnits);
}

function bitCount(bits) {
  let count = 0;
  let value = bits;
  while (value) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}

function solve(courses, requirements, { overagePenalty, maxOverage, semesters, preferences, forced }) {
  const penaltyMilli = Math.max(0, Math.round(Number(overagePenalty) * 1000));
  const allowWinter = semesters?.winter !== false;
  const allowSummer = semesters?.summer !== false;
  const forcedSet = forced ?? {};
  const preferenceMap = preferences ?? {};

  const prepared = courses.map((course) => ({
    ...course,
    preference: Object.prototype.hasOwnProperty.call(preferenceMap, course.id)
      ? preferenceMap[course.id]
      : course.preference,
    forced: Boolean(forcedSet[course.id]),
  }));

  const forcedCourses = [];
  const forcedOutsideSemester = [];
  const optional = [];
  for (const course of prepared) {
    const semesterOpen =
      course.semester == null || (course.semester === "winter" ? allowWinter : allowSummer);
    if (course.forced) {
      forcedCourses.push(course);
      if (!semesterOpen) forcedOutsideSemester.push(course);
      continue;
    }
    if (!semesterOpen || course.preference <= 0) continue;
    optional.push(course);
  }

  const areaIndex = new Map(requirements.areas.map((area, index) => [area.id, index]));
  const credits = requirements.areas.map(() => 0);
  let theoryUnits = 0;
  let totalUnits = 0;
  let score = 0;
  for (const course of forcedCourses) {
    const index = areaIndex.get(course.area);
    credits[index] += course.units;
    totalUnits += course.units;
    if (course.theoretical) theoryUnits += course.units;
    score += course.preference;
  }

  const slackUnits = Math.round(maxOverage * SCALE);
  const capUnits = Math.max(requirements.totalUnits + slackUnits, totalUnits + slackUnits);

  let current = new Map();
  current.set(`${theoryUnits}|${credits.join(",")}`, {
    score,
    bits: 0n,
    credits: credits.slice(),
    theoryUnits,
    totalUnits,
  });

  for (let i = 0; i < optional.length; i++) {
    const course = optional[i];
    const index = areaIndex.get(course.area);
    const next = new Map(current);
    for (const state of current.values()) {
      const nextTotal = state.totalUnits + course.units;
      if (nextTotal > capUnits) continue;
      const nextCredits = state.credits.slice();
      nextCredits[index] += course.units;
      const nextTheory = state.theoryUnits + (course.theoretical ? course.units : 0);
      const key = `${nextTheory}|${nextCredits.join(",")}`;
      const nextScore = state.score + course.preference;
      const existing = next.get(key);
      const bits = state.bits | (1n << BigInt(i));
      const betterScore = !existing || nextScore > existing.score;
      const sameScoreFewerCourses =
        existing && nextScore === existing.score && bitCount(bits) < bitCount(existing.bits);
      if (betterScore || sameScoreFewerCourses) {
        next.set(key, {
          score: nextScore,
          bits,
          credits: nextCredits,
          theoryUnits: nextTheory,
          totalUnits: nextTotal,
        });
      }
    }
    current = next;
  }

  const ranked = [];
  for (const state of current.values()) {
    let deficitUnits = Math.max(0, requirements.totalUnits - state.totalUnits);
    deficitUnits += Math.max(0, requirements.theoreticalUnits - state.theoryUnits);
    deficitUnits += assignQuotas(state.credits, requirements.areas, requirements.areaQuotaUnits).shortfallUnits;
    const net = netMilli(
      state.score,
      state.totalUnits,
      requirements.totalUnits,
      state.theoryUnits,
      requirements.theoreticalUnits,
      penaltyMilli,
    );
    const count = bitCount(state.bits) + forcedCourses.length;
    ranked.push({ ...state, deficitUnits, net, count });
  }
  ranked.sort((a, b) => {
    if (a.deficitUnits !== b.deficitUnits) return a.deficitUnits - b.deficitUnits;
    if (a.net !== b.net) return b.net - a.net;
    if (a.totalUnits !== b.totalUnits) return a.totalUnits - b.totalUnits;
    return a.count - b.count;
  });

  function coursesFor(state) {
    const chosen = [...forcedCourses];
    for (let i = 0; i < optional.length; i++) {
      if ((state.bits & (1n << BigInt(i))) !== 0n) chosen.push(optional[i]);
    }
    return chosen;
  }

  function describe(state) {
    const chosen = coursesFor(state);
    const evaluation = evaluateSelection(chosen, requirements, overagePenalty);
    return {
      ...evaluation,
      courses: chosen,
      atOverageLimit: evaluation.totals.overage >= maxOverage - 1e-9 && evaluation.totals.overage > 0,
      maxOverage,
      consideredCount: optional.length,
      forcedOutsideSemester,
    };
  }

  const plans = [];
  const seen = new Set();
  for (const state of ranked) {
    const plan = describe(state);
    const key = plan.courses
      .map((course) => course.id)
      .sort()
      .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    plans.push(plan);
    if (plans.length === 5) break;
  }

  const best = plans[0] ?? describe(ranked[0]);
  return { ...best, plans };
}

export function recommend(courses, requirements, options = {}) {
  if (!requirements) return emptyResult(null);
  const overagePenalty = options.overagePenalty ?? requirements.overagePenalty ?? 0.75;
  const maxOverage = options.maxOverage ?? requirements.maxOverage ?? 24;
  const base = {
    overagePenalty,
    semesters: options.semesters,
    preferences: options.preferences,
    forced: options.forced,
  };

  const first = solve(courses, requirements, { ...base, maxOverage });
  if (first.feasible || maxOverage >= 60) return first;
  const second = solve(courses, requirements, { ...base, maxOverage: 60 });
  if (second.feasible || second.deficitUnits < first.deficitUnits) return second;
  return first;
}
