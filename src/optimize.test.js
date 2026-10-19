import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateSelection, normalizeCatalog, recommend } from "./optimize.js";

const baseRequirements = {
  totalCredits: 10,
  theoreticalCredits: 0,
  overagePenalty: 1,
  maxOverage: 20,
  areaQuotas: [6, 4],
  areas: [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
  ],
};

function course(partial) {
  return {
    semester: "winter",
    theoretical: false,
    preference: 1,
    ...partial,
  };
}

test("Strafe für Extra-Credits schlägt einen beliebteren, zu großen Kurs", () => {
  const { requirements } = normalizeCatalog({
    requirements: baseRequirements,
    courses: [
      course({ id: "knapp", name: "Knapp", area: "a", credits: 6, preference: 2 }),
      course({ id: "rest", name: "Rest", area: "b", credits: 4, preference: 2 }),
      course({ id: "riesig", name: "Riesig", area: "a", credits: 16, preference: 5 }),
    ],
  });
  const courses = normalizeCatalog({
    requirements: baseRequirements,
    courses: [
      course({ id: "knapp", name: "Knapp", area: "a", credits: 6, preference: 2 }),
      course({ id: "rest", name: "Rest", area: "b", credits: 4, preference: 2 }),
      course({ id: "riesig", name: "Riesig", area: "a", credits: 16, preference: 5 }),
    ],
  }).courses;

  const plan = recommend(courses, requirements, { overagePenalty: 1 });
  assert.equal(plan.feasible, true);
  assert.deepEqual(plan.courses.map((item) => item.id).sort(), ["knapp", "rest"]);
  assert.equal(plan.totals.credits, 10);
  assert.equal(plan.totals.overage, 0);
});

test("bei kleiner Strafe darf ein sehr gewünschter Kurs über das Ziel hinaus", () => {
  const raw = {
    requirements: { ...baseRequirements, overagePenalty: 0.5 },
    courses: [
      course({ id: "klein", name: "Klein", area: "a", credits: 6, preference: 1 }),
      course({ id: "rest", name: "Rest", area: "b", credits: 4, preference: 1 }),
      course({ id: "lieb", name: "Lieb", area: "a", credits: 9, preference: 5 }),
    ],
  };
  const { courses, requirements } = normalizeCatalog(raw);
  const plan = recommend(courses, requirements, { overagePenalty: 0.5 });
  assert.equal(plan.feasible, true);
  assert.ok(plan.courses.some((item) => item.id === "lieb"));
  assert.ok(plan.totals.overage > 0);
  assert.ok(plan.score > 2);
});

test("theoretische Credits werden erzwungen", () => {
  const raw = {
    requirements: {
        totalCredits: 10,
        theoreticalCredits: 6,
        overagePenalty: 1,
        maxOverage: 10,
        areaQuotas: [10],
        areas: [{ id: "a", name: "A" }],
    },
    courses: [
      course({ id: "praxis", name: "Praxis", area: "a", credits: 10, preference: 5, theoretical: false }),
      course({ id: "theorie", name: "Theorie", area: "a", credits: 6, preference: 1, theoretical: true }),
      course({ id: "fuellung", name: "Füllung", area: "a", credits: 4, preference: 1, theoretical: false }),
    ],
  };
  const { courses, requirements } = normalizeCatalog(raw);
  const plan = recommend(courses, requirements);
  assert.equal(plan.feasible, true);
  assert.deepEqual(plan.courses.map((item) => item.id).sort(), ["fuellung", "theorie"]);
  assert.equal(plan.totals.theoretical, 6);
});

test("die Blöcke dürfen in beliebigen Bereichen liegen, aber nicht im selben", () => {
  const raw = {
    requirements: {
      totalCredits: 18,
      theoreticalCredits: 0,
      overagePenalty: 2,
      maxOverage: 12,
      areaQuotas: [10, 4, 4],
      areas: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
        { id: "c", name: "C" },
        { id: "d", name: "D" },
      ],
    },
    courses: [
      course({ id: "nur-a", name: "Nur A", area: "a", credits: 3, preference: 5 }),
      course({ id: "block-b", name: "Block B", area: "b", credits: 10, preference: 2 }),
      course({ id: "block-c", name: "Block C", area: "c", credits: 4, preference: 2 }),
      course({ id: "block-d", name: "Block D", area: "d", credits: 4, preference: 2 }),
      course({ id: "stapel", name: "Stapel", area: "b", credits: 18, preference: 5 }),
    ],
  };
  const { courses, requirements } = normalizeCatalog(raw);
  const plan = recommend(courses, requirements);
  assert.equal(plan.feasible, true);
  assert.deepEqual(plan.courses.map((item) => item.id).sort(), ["block-b", "block-c", "block-d"]);
  assert.equal(plan.assignment.find((slot) => slot.quotaCredits === 10).areaId, "b");
  assert.deepEqual(
    plan.assignment.map((slot) => slot.areaId).sort(),
    ["b", "c", "d"],
  );
});

test("ein Bereich kann nicht zwei Blöcke gleichzeitig füllen", () => {
  const raw = {
    requirements: {
      totalCredits: 16,
      theoreticalCredits: 0,
      overagePenalty: 1,
      maxOverage: 20,
      areaQuotas: [10, 6],
      areas: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
    },
    courses: [
      course({ id: "gross", name: "Groß", area: "a", credits: 16, preference: 5 }),
      course({ id: "klein", name: "Klein", area: "b", credits: 6, preference: 1 }),
    ],
  };
  const { courses, requirements } = normalizeCatalog(raw);
  const plan = recommend(courses, requirements);
  assert.equal(plan.feasible, true);
  assert.equal(plan.courses.some((item) => item.id === "klein"), true);
});

test("fixierte Kurse bleiben im Plan", () => {
  const raw = {
    requirements: baseRequirements,
    courses: [
      course({ id: "pflicht", name: "Pflicht", area: "a", credits: 6, preference: 1 }),
      course({ id: "rest", name: "Rest", area: "b", credits: 4, preference: 1 }),
      course({ id: "besser", name: "Besser", area: "a", credits: 6, preference: 5 }),
    ],
  };
  const { courses, requirements } = normalizeCatalog(raw);
  const plan = recommend(courses, requirements, {
    overagePenalty: 2,
    forced: { pflicht: true },
  });
  assert.equal(plan.feasible, true);
  assert.equal(plan.courses.some((item) => item.id === "pflicht"), true);
  assert.equal(plan.courses.some((item) => item.id === "besser"), false);
});

test("Präferenz 0 schließt einen Kurs aus", () => {
  const raw = {
    requirements: {
      totalCredits: 6,
      theoreticalCredits: 0,
      overagePenalty: 1,
      maxOverage: 6,
      areaQuotas: [6],
      areas: [{ id: "a", name: "A" }],
    },
    courses: [
      course({ id: "nein", name: "Nein", area: "a", credits: 6, preference: 5 }),
      course({ id: "ja", name: "Ja", area: "a", credits: 6, preference: 1 }),
    ],
  };
  const { courses, requirements } = normalizeCatalog(raw);
  const plan = recommend(courses, requirements, { preferences: { nein: 0 } });
  assert.deepEqual(plan.courses.map((item) => item.id), ["ja"]);
});

test("ohne genug Credits bleibt der Plan unerfüllbar und nennt das Defizit", () => {
  const raw = {
    requirements: baseRequirements,
    courses: [course({ id: "winzig", name: "Winzig", area: "a", credits: 3, preference: 5 })],
  };
  const { courses, requirements } = normalizeCatalog(raw);
  const plan = recommend(courses, requirements);
  assert.equal(plan.feasible, false);
  assert.ok(plan.deficits.credits > 0);
  assert.ok(plan.assignment.some((slot) => slot.missing > 0));
});

test("halbe Credits bleiben exakt", () => {
  const raw = {
    requirements: {
      totalCredits: 10,
      theoreticalCredits: 5.5,
      overagePenalty: 1,
      maxOverage: 2,
      areaQuotas: [5.5, 4.5],
      areas: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
    },
    courses: [
      course({ id: "halb", name: "Halb", area: "a", credits: 5.5, preference: 3, theoretical: true }),
      course({ id: "rest", name: "Rest", area: "b", credits: 4.5, preference: 3 }),
    ],
  };
  const { courses, requirements } = normalizeCatalog(raw);
  const plan = recommend(courses, requirements);
  assert.equal(plan.feasible, true);
  assert.equal(plan.totals.credits, 10);
  assert.equal(plan.totals.theoretical, 5.5);
});

test("Sommersemester lässt sich aus der Suche nehmen", () => {
  const raw = {
    requirements: {
      totalCredits: 6,
      theoreticalCredits: 0,
      overagePenalty: 1,
      maxOverage: 0,
      areaQuotas: [6],
      areas: [{ id: "a", name: "A" }],
    },
    courses: [
      course({ id: "sommer", name: "Sommer", area: "a", credits: 6, preference: 5, semester: "summer" }),
      course({ id: "winter", name: "Winter", area: "a", credits: 6, preference: 1, semester: "winter" }),
    ],
  };
  const { courses, requirements } = normalizeCatalog(raw);
  const plan = recommend(courses, requirements, { semesters: { winter: true, summer: false } });
  assert.deepEqual(plan.courses.map((item) => item.id), ["winter"]);
});

function mulberry32(seed) {
  let value = seed;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bruteBest(courses, requirements, overagePenalty) {
  const cap = requirements.totalCredits + requirements.maxOverage;
  let best = null;
  const n = courses.length;
  const totalMasks = 1 << n;
  for (let mask = 0; mask < totalMasks; mask++) {
    const chosen = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) chosen.push(courses[i]);
    }
    const evaluation = evaluateSelection(chosen, requirements, overagePenalty);
    if (evaluation.totals.credits > cap + 1e-9) continue;
    const candidate = { evaluation, count: chosen.length };
    if (
      !best ||
      evaluation.deficitUnits < best.evaluation.deficitUnits ||
      (evaluation.deficitUnits === best.evaluation.deficitUnits &&
        evaluation.score > best.evaluation.score) ||
      (evaluation.deficitUnits === best.evaluation.deficitUnits &&
        evaluation.score === best.evaluation.score &&
        evaluation.totals.credits < best.evaluation.totals.credits) ||
      (evaluation.deficitUnits === best.evaluation.deficitUnits &&
        evaluation.score === best.evaluation.score &&
        evaluation.totals.credits === best.evaluation.totals.credits &&
        candidate.count < best.count)
    ) {
      best = candidate;
    }
  }
  return best;
}

test("der Optimierer trifft die vollständige Suche auf zufälligen kleinen Katalogen", () => {
  const random = mulberry32(7);
  for (let round = 0; round < 12; round++) {
    const courses = [];
    const count = 12;
    for (let i = 0; i < count; i++) {
      const credits = [3, 4, 5, 6, 8][Math.floor(random() * 5)];
      courses.push(
        course({
          id: `c${round}-${i}`,
          name: `Kurs ${i}`,
          area: ["a", "b", "c"][i % 3],
          credits,
          preference: 1 + Math.floor(random() * 5),
          theoretical: random() < 0.35,
          semester: random() < 0.5 ? "winter" : "summer",
        }),
      );
    }
    const raw = {
      requirements: {
        totalCredits: 24,
        theoreticalCredits: 6,
        overagePenalty: 0.75,
        maxOverage: 12,
        areaQuotas: [8, 6, 4],
        areas: [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
          { id: "c", name: "C" },
        ],
      },
      courses,
    };
    const normalized = normalizeCatalog(raw);
    const plan = recommend(normalized.courses, normalized.requirements);
    const oracle = bruteBest(normalized.courses, normalized.requirements, 0.75);
    assert.equal(plan.feasible, oracle.evaluation.feasible);
    assert.equal(plan.score, oracle.evaluation.score);
    assert.equal(plan.totals.credits, oracle.evaluation.totals.credits);
    assert.equal(plan.deficitUnits, oracle.evaluation.deficitUnits);
  }
});

test("Theorie über dem Minimum wird bestraft", () => {
  const raw = {
    requirements: {
      totalCredits: 10,
      theoreticalCredits: 4,
      overagePenalty: 1,
      maxOverage: 10,
      areaQuotas: [10],
      areas: [{ id: "a", name: "A" }],
    },
    courses: [
      course({ id: "viel-theorie", name: "Viel", area: "a", credits: 10, preference: 5, theoretical: true }),
      course({ id: "genau", name: "Genau", area: "a", credits: 4, preference: 2, theoretical: true }),
      course({ id: "rest", name: "Rest", area: "a", credits: 6, preference: 2, theoretical: false }),
    ],
  };
  const { courses, requirements } = normalizeCatalog(raw);
  const plan = recommend(courses, requirements, { overagePenalty: 1 });
  assert.equal(plan.feasible, true);
  assert.deepEqual(plan.courses.map((item) => item.id).sort(), ["genau", "rest"]);
  assert.equal(plan.totals.theoretical, 4);
  assert.equal(plan.totals.theoryOverage, 0);
});

test("die Theorie-Strafe ist unabhängig von der Credit-Strafe", () => {
  const raw = {
    requirements: {
      totalCredits: 10,
      theoreticalCredits: 4,
      overagePenalty: 0,
      maxOverage: 0,
      areaQuotas: [10],
      areas: [{ id: "a", name: "A" }],
    },
    courses: [
      course({ id: "viel-theorie", name: "Viel", area: "a", credits: 10, preference: 5, theoretical: true }),
      course({ id: "genau", name: "Genau", area: "a", credits: 4, preference: 2, theoretical: true }),
      course({ id: "rest", name: "Rest", area: "a", credits: 6, preference: 2, theoretical: false }),
    ],
  };
  const { courses, requirements } = normalizeCatalog(raw);
  const strict = recommend(courses, requirements, { overagePenalty: 0, theoryPenalty: 2 });
  assert.deepEqual(strict.courses.map((item) => item.id).sort(), ["genau", "rest"]);
  const loose = recommend(courses, requirements, { overagePenalty: 0, theoryPenalty: 0 });
  assert.deepEqual(loose.courses.map((item) => item.id), ["viel-theorie"]);
});

test("der Beispielkatalog liefert einen gültigen Plan", () => {
  const raw = JSON.parse(readFileSync(new URL("../courses.json", import.meta.url), "utf8"));
  const catalog = normalizeCatalog(raw);
  assert.deepEqual(catalog.errors, []);
  assert.equal(catalog.requirements.totalCredits, 53);
  assert.deepEqual(catalog.requirements.areaQuotas, [18, 8, 8]);
  assert.equal(catalog.requirements.theoreticalCredits, 10);
  assert.ok(catalog.courses.length >= 15);

  const started = performance.now();
  const plan = recommend(catalog.courses, catalog.requirements);
  const elapsed = performance.now() - started;

  assert.equal(plan.feasible, true, JSON.stringify({ deficits: plan.deficits, assignment: plan.assignment }));
  assert.ok(plan.totals.credits >= 53);
  assert.ok(plan.totals.theoretical >= 10);
  const blockAreas = plan.assignment.map((slot) => slot.areaId);
  assert.equal(new Set(blockAreas).size, 3);
  assert.deepEqual(
    plan.assignment.map((slot) => slot.quotaCredits).sort((a, b) => b - a),
    [18, 8, 8],
  );
  for (const slot of plan.assignment) {
    assert.ok(slot.credits >= slot.quotaCredits);
  }
  assert.ok(plan.plans.length >= 1 && plan.plans.length <= 5);
  for (let index = 1; index < plan.plans.length; index++) {
    assert.ok(plan.plans[index - 1].score >= plan.plans[index].score - 1e-9);
  }
  assert.ok(elapsed < 1000, `Optimierung dauerte ${elapsed.toFixed(0)} ms`);
  console.log(
    `Beispielplan: ${plan.courses.length} Kurse, ${plan.totals.credits} ECTS, Nutzen ${plan.score}, ${elapsed.toFixed(0)} ms`,
  );
});
