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
      errors: ["The catalog is not a valid JSON object."],
      warnings,
    };
  }

  const req = raw.requirements;
  if (!req || typeof req !== "object" || Array.isArray(req)) {
    return {
      meta,
      requirements: null,
      courses: [],
      errors: ["The catalog is missing the requirements object."],
      warnings,
    };
  }

  const totalUnits = unitsFromCredits(req.totalCredits);
  if (totalUnits == null) {
    errors.push("requirements.totalCredits must be a positive ECTS value (up to 60, in steps of 0.5).");
  }

  let theoryUnits = 0;
  if (req.theoreticalCredits == null) {
    theoryUnits = 0;
  } else if (req.theoreticalCredits === 0) {
    theoryUnits = 0;
  } else {
    theoryUnits = unitsFromCredits(req.theoreticalCredits);
    if (theoryUnits == null) {
      errors.push("requirements.theoreticalCredits must be 0 or a positive ECTS value.");
    }
  }

  const overagePenalty = req.overagePenalty == null ? 0.75 : Number(req.overagePenalty);
  if (!Number.isFinite(overagePenalty) || overagePenalty < 0) {
    errors.push("requirements.overagePenalty must be a number ≥ 0.");
  }

  const maxOverage = req.maxOverage == null ? 24 : Number(req.maxOverage);
  if (!Number.isFinite(maxOverage) || maxOverage < 0 || maxOverage > 120) {
    errors.push("requirements.maxOverage must be a number from 0 to 120.");
  }

  const areas = [];
  const seenAreas = new Set();
  if (!Array.isArray(req.areas) || req.areas.length === 0) {
    errors.push("requirements.areas needs at least one area.");
  } else if (req.areas.length > 16) {
    errors.push("At most sixteen areas are supported.");
  } else {
    for (const area of req.areas) {
      if (!area || typeof area.id !== "string" || area.id.trim() === "") {
        errors.push("Every area needs an id.");
        continue;
      }
      const id = area.id.trim();
      if (seenAreas.has(id)) {
        errors.push(`Area id “${id}” is duplicated.`);
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
    errors.push("requirements.areaQuotas needs the block sizes, for example [18, 8, 8].");
  } else {
    for (const quota of req.areaQuotas) {
      if (quota === 0) {
        areaQuotaUnits.push(0);
        continue;
      }
      const units = unitsFromCredits(quota);
      if (units == null) {
        errors.push(`A block size in areaQuotas is invalid: ${quota}.`);
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
    errors.push("courses must be a list.");
  }

  for (const course of source) {
    if (!course || typeof course !== "object") {
      warnings.push("A courses entry is not an object and was skipped.");
      continue;
    }
    const name = typeof course.name === "string" ? course.name.trim() : "";
    if (!name) {
      warnings.push("A course without a name was skipped.");
      continue;
    }
    let id = typeof course.id === "string" && course.id.trim() ? course.id.trim() : slugify(name);
    if (!id) {
      warnings.push(`“${name}” has no usable id and was skipped.`);
      continue;
    }
    if (seenIds.has(id)) {
      warnings.push(`The id “${id}” is duplicated. “${name}” was skipped.`);
      continue;
    }
    const units = unitsFromCredits(course.credits);
    if (units == null) {
      warnings.push(`“${name}” has invalid credits and was skipped.`);
      continue;
    }
    let semester = null;
    if (course.semester != null && String(course.semester).trim() !== "") {
      const semesterKey = String(course.semester).trim().toLowerCase();
      semester = SEMESTERS[semesterKey] ?? null;
      if (!semester) {
        warnings.push(`“${name}” needs semester “winter” or “summer” and was skipped.`);
        continue;
      }
    }
    if (requirements && !requirements.areas.some((area) => area.id === course.area)) {
      warnings.push(`“${name}” points at the unknown area “${course.area}” and was skipped.`);
      continue;
    }
    if (!requirements && (typeof course.area !== "string" || !course.area.trim())) {
      warnings.push(`“${name}” has no area and was skipped.`);
      continue;
    }
    let preference = course.preference;
    if (preference == null) preference = 3;
    if (typeof preference !== "number" || !Number.isFinite(preference)) {
      warnings.push(`The preference of “${name}” is invalid and was set to 3.`);
      preference = 3;
    }
    const rounded = Math.round(preference);
    if (rounded !== preference || rounded < 0 || rounded > 5) {
      warnings.push(`The preference of “${name}” was limited to a whole number from 0 to 5.`);
    }
    preference = Math.min(5, Math.max(0, rounded));
    if (typeof course.theoretical !== "boolean" && course.theoretical != null) {
      warnings.push(`“${name}”: theoretical must be true or false and was read as false.`);
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

function penaltyMilli(value) {
  return Math.max(0, Math.round(Number(value) * 1000));
}

export function evaluateSelection(courses, requirements, overagePenalty, theoryPenalty) {
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
  const overMilli = penaltyMilli(overagePenalty);
  const theoryMilli = theoryPenalty == null ? overMilli : penaltyMilli(theoryPenalty);
  const penalty = (overMilli * excessUnits + theoryMilli * theoryExcessUnits) / (SCALE * 1000);
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

function netMilli(preferenceSum, totalUnits, targetUnits, theoryUnits, theoryTargetUnits, overMilli, theoryMilli) {
  const excessUnits = Math.max(0, totalUnits - targetUnits);
  const theoryExcessUnits = Math.max(0, theoryUnits - theoryTargetUnits);
  return preferenceSum * 1000 * SCALE - overMilli * excessUnits - theoryMilli * theoryExcessUnits;
}

const PLAN_LIMIT = 5;

function buildAreaOptions(forcedCourses, optionalCourses, capUnits) {
  let credits = 0;
  let theory = 0;
  let preference = 0;
  const base = [];
  for (const course of forcedCourses) {
    credits += course.units;
    if (course.theoretical) theory += course.units;
    preference += course.preference;
    base.push(course);
  }

  let states = new Map([
    [
      credits * 100000 + theory,
      { credits, theory, preference, count: base.length, picks: base },
    ],
  ]);

  for (const course of optionalCourses) {
    const next = new Map(states);
    for (const state of states.values()) {
      const nextCredits = state.credits + course.units;
      if (nextCredits > capUnits) continue;
      const nextTheory = state.theory + (course.theoretical ? course.units : 0);
      const candidate = {
        credits: nextCredits,
        theory: nextTheory,
        preference: state.preference + course.preference,
        count: state.count + 1,
        picks: state.picks.concat(course),
      };
      const key = nextCredits * 100000 + nextTheory;
      const existing = next.get(key);
      if (
        !existing ||
        candidate.preference > existing.preference ||
        (candidate.preference === existing.preference && candidate.count < existing.count)
      ) {
        next.set(key, candidate);
      }
    }
    states = next;
  }

  const options = [...states.values()];
  options.sort((a, b) => a.credits - b.credits || a.theory - b.theory);
  return options;
}

function fillTop(source, real, credit, quotaCount, out) {
  let size = 0;
  let placed = false;
  for (let index = 0; index < real; index++) {
    if (!placed && credit > source[index]) {
      if (size < quotaCount) out[size++] = credit;
      placed = true;
    }
    if (size < quotaCount) out[size++] = source[index];
    else if (placed) break;
  }
  if (!placed && size < quotaCount) out[size++] = credit;
  while (size < quotaCount) out[size++] = 0;
}

function packKey(total, theory, top) {
  if (top.length > 4) return `${total}|${theory}|${top.join(",")}`;
  let key = total + theory * 1024;
  let multiplier = 1048576;
  for (let index = 0; index < top.length; index++) {
    key += top[index] * multiplier;
    multiplier *= 256;
  }
  return key;
}

const RANK_POOL = 24;

function betterCandidate(candidate, other) {
  if (candidate.deficitUnits !== other.deficitUnits) return candidate.deficitUnits < other.deficitUnits;
  if (candidate.net !== other.net) return candidate.net > other.net;
  if (candidate.total !== other.total) return candidate.total < other.total;
  return candidate.count < other.count;
}

function insertRanked(ranked, candidate) {
  let place = ranked.length;
  for (let index = 0; index < ranked.length; index++) {
    if (betterCandidate(candidate, ranked[index])) {
      place = index;
      break;
    }
  }
  if (place >= RANK_POOL) return;
  ranked.splice(place, 0, candidate);
  if (ranked.length > RANK_POOL) ranked.pop();
}

function solve(courses, requirements, { overagePenalty, theoryPenalty, maxOverage, semesters, preferences, forced }) {
  const overMilli = penaltyMilli(overagePenalty);
  const theoryMilli = theoryPenalty == null ? overMilli : penaltyMilli(theoryPenalty);
  const allowWinter = semesters?.winter !== false;
  const allowSummer = semesters?.summer !== false;
  const forcedSet = forced ?? {};
  const preferenceMap = preferences ?? {};
  const quotaUnits = [...requirements.areaQuotaUnits].sort((a, b) => b - a);
  const quotaCount = quotaUnits.length;
  const maxQuotaUnits = quotaUnits[0] ?? 0;

  const prepared = courses.map((course) => ({
    ...course,
    preference: Object.prototype.hasOwnProperty.call(preferenceMap, course.id)
      ? preferenceMap[course.id]
      : course.preference,
    forced: Boolean(forcedSet[course.id]),
  }));

  const forcedOutsideSemester = [];
  const grouped = requirements.areas.map(() => ({ forced: [], optional: [] }));
  const areaIndex = new Map(requirements.areas.map((area, index) => [area.id, index]));
  let forcedUnits = 0;
  let consideredCount = 0;
  for (const course of prepared) {
    const semesterOpen =
      course.semester == null || (course.semester === "winter" ? allowWinter : allowSummer);
    const group = grouped[areaIndex.get(course.area)];
    if (course.forced) {
      group.forced.push(course);
      forcedUnits += course.units;
      if (!semesterOpen) forcedOutsideSemester.push(course);
      continue;
    }
    if (!semesterOpen || course.preference <= 0) continue;
    group.optional.push(course);
    consideredCount += 1;
  }

  const slackUnits = Math.round(maxOverage * SCALE);
  const capUnits = Math.max(requirements.totalUnits + slackUnits, forcedUnits + slackUnits);
  const areaOptions = grouped.map((group) => buildAreaOptions(group.forced, group.optional, capUnits));

  function combineAreas(optionLists, slots) {
    let states = [
      {
        total: 0,
        theory: 0,
        top: Array(slots).fill(0),
        sols: [{ preference: 0, count: 0, prev: -1, solIndex: -1, optionIndex: -1 }],
      },
    ];
    const layers = [states];
    const scratch = Array(slots);
    for (let area = 0; area < optionLists.length; area++) {
      const options = optionLists[area];
      const next = [];
      const indexByKey = new Map();
      const real = Math.min(area, slots);
      for (let stateIndex = 0; stateIndex < states.length; stateIndex++) {
        const state = states[stateIndex];
        const baseSol = state.sols[0];
        for (let optionIndex = 0; optionIndex < options.length; optionIndex++) {
          const option = options[optionIndex];
          const total = state.total + option.credits;
          if (total > capUnits) break;
          const theory = state.theory + option.theory;
          const preference = baseSol.preference + option.preference;
          const count = baseSol.count + option.count;
          const clamped = option.credits > maxQuotaUnits ? maxQuotaUnits : option.credits;
          fillTop(state.top, real, clamped, slots, scratch);
          const key = packKey(total, theory, scratch);
          let targetIndex = indexByKey.get(key);
          if (targetIndex === undefined) {
            const top = Array(slots);
            for (let index = 0; index < slots; index++) top[index] = scratch[index];
            targetIndex = next.length;
            next.push({
              total,
              theory,
              top,
              sols: [{ preference, count, prev: stateIndex, solIndex: 0, optionIndex }],
            });
            indexByKey.set(key, targetIndex);
            continue;
          }
          const target = next[targetIndex];
          if (
            preference > target.sols[0].preference ||
            (preference === target.sols[0].preference && count < target.sols[0].count)
          ) {
            target.sols[0] = { preference, count, prev: stateIndex, solIndex: 0, optionIndex };
          }
        }
      }
      states = next;
      layers.push(states);
    }
    return { layers, states };
  }

  function coursesFrom(layers, optionLists, stateIndex, solIndex) {
    const chosen = [];
    let layer = layers.length - 1;
    while (layer > 0) {
      const sol = layers[layer][stateIndex].sols[solIndex];
      const picks = optionLists[layer - 1][sol.optionIndex].picks;
      for (let index = 0; index < picks.length; index++) chosen.push(picks[index]);
      stateIndex = sol.prev;
      solIndex = sol.solIndex;
      layer -= 1;
    }
    return chosen;
  }

  const rightCount = Math.max(0, areaOptions.length - quotaCount);
  const split = rightCount > 0 && rightCount <= 2;
  const leftLists = split ? areaOptions.slice(0, quotaCount) : areaOptions;
  const rightLists = split ? areaOptions.slice(quotaCount) : [];
  const left = combineAreas(leftLists, quotaCount);
  const right = split ? combineAreas(rightLists, rightCount) : null;

  const ranked = [];
  const scratch = Array(quotaCount);
  const second = Array(quotaCount);

  if (!right) {
    for (let stateIndex = 0; stateIndex < left.states.length; stateIndex++) {
      const state = left.states[stateIndex];
      let deficitUnits = Math.max(0, requirements.totalUnits - state.total);
      deficitUnits += Math.max(0, requirements.theoreticalUnits - state.theory);
      for (let index = 0; index < quotaCount; index++) {
        deficitUnits += Math.max(0, quotaUnits[index] - (state.top[index] ?? 0));
      }
      for (let solIndex = 0; solIndex < state.sols.length; solIndex++) {
        const sol = state.sols[solIndex];
        insertRanked(ranked, {
          deficitUnits,
          net: netMilli(
            sol.preference,
            state.total,
            requirements.totalUnits,
            state.theory,
            requirements.theoreticalUnits,
            overMilli,
            theoryMilli,
          ),
          total: state.total,
          count: sol.count,
          leftState: stateIndex,
          leftSol: solIndex,
          rightState: -1,
          rightSol: -1,
        });
      }
    }
  } else {
    const rightOrder = right.states
      .map((state, index) => ({ state, index }))
      .sort((a, b) => a.state.total - b.state.total);
    const leftOrder = left.states
      .map((state, index) => ({ state, index }))
      .sort(
        (a, b) =>
          b.state.sols[0].preference - a.state.sols[0].preference || a.state.total - b.state.total,
      );

    for (let leftCursor = 0; leftCursor < leftOrder.length; leftCursor++) {
      const leftState = leftOrder[leftCursor].state;
      const leftSol = leftState.sols[0];
      for (let rightCursor = 0; rightCursor < rightOrder.length; rightCursor++) {
        const rightState = rightOrder[rightCursor].state;
        const total = leftState.total + rightState.total;
        if (total > capUnits) break;
        const rightSol = rightState.sols[0];
        const preference = leftSol.preference + rightSol.preference;
        const theory = leftState.theory + rightState.theory;
        const net = netMilli(
          preference,
          total,
          requirements.totalUnits,
          theory,
          requirements.theoreticalUnits,
          overMilli,
          theoryMilli,
        );
        const limit = ranked.length === RANK_POOL ? ranked[RANK_POOL - 1] : null;
        if (limit && limit.deficitUnits === 0 && net < limit.net) continue;
        if (limit && limit.deficitUnits === 0 && net === limit.net && total > limit.total) continue;
        let top = leftState.top;
        let output = scratch;
        for (let index = 0; index < rightCount; index++) {
          fillTop(top, quotaCount, rightState.top[index], quotaCount, output);
          top = output;
          output = output === scratch ? second : scratch;
        }
        let deficitUnits = Math.max(0, requirements.totalUnits - total);
        deficitUnits += Math.max(0, requirements.theoreticalUnits - theory);
        for (let index = 0; index < quotaCount; index++) {
          deficitUnits += Math.max(0, quotaUnits[index] - top[index]);
        }
        const count = leftSol.count + rightSol.count;
        if (limit && !betterCandidate({ deficitUnits, net, total, count }, limit)) continue;
        insertRanked(ranked, {
          deficitUnits,
          net,
          total,
          count,
          leftState: leftOrder[leftCursor].index,
          leftSol: 0,
          rightState: rightOrder[rightCursor].index,
          rightSol: 0,
        });
      }
    }
  }

  function coursesFor(candidate) {
    const chosen = coursesFrom(left.layers, leftLists, candidate.leftState, candidate.leftSol);
    if (candidate.rightState >= 0) {
      const extra = coursesFrom(right.layers, rightLists, candidate.rightState, candidate.rightSol);
      for (let index = 0; index < extra.length; index++) chosen.push(extra[index]);
    }
    return chosen;
  }

  function describe(candidate) {
    const chosen = coursesFor(candidate);
    const evaluation = evaluateSelection(chosen, requirements, overagePenalty, theoryPenalty);
    return {
      ...evaluation,
      courses: chosen,
      atOverageLimit: evaluation.totals.overage >= maxOverage - 1e-9 && evaluation.totals.overage > 0,
      maxOverage,
      consideredCount,
      forcedOutsideSemester,
    };
  }

  const plans = [];
  const seen = new Set();
  for (const candidate of ranked) {
    const plan = describe(candidate);
    const key = plan.courses
      .map((course) => course.id)
      .sort()
      .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    plans.push(plan);
    if (plans.length === PLAN_LIMIT) break;
  }

  if (plans.length === 0) {
    const empty = evaluateSelection([], requirements, overagePenalty, theoryPenalty);
    const plan = {
      ...empty,
      courses: [],
      atOverageLimit: false,
      maxOverage,
      consideredCount,
      forcedOutsideSemester,
    };
    return { ...plan, plans: [plan] };
  }

  return { ...plans[0], plans };
}

export function recommend(courses, requirements, options = {}) {
  if (!requirements) return emptyResult(null);
  const overagePenalty = options.overagePenalty ?? requirements.overagePenalty ?? 0.75;
  const theoryPenalty = options.theoryPenalty ?? overagePenalty;
  const maxOverage = options.maxOverage ?? requirements.maxOverage ?? 24;
  const base = {
    overagePenalty,
    theoryPenalty,
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
