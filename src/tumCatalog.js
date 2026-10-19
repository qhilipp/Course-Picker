const PLAN_PAGE =
  "/tumonline/wbstpcs.showSpoTree?pStpStpNr=4731&pFilterType=1&pStartSemester=W";
const CATALOG_NAMES = ["Wahlmodulkatalog Informatik", "Elective Modules Informatics"];
const SOURCE_URL = "https://campus.tum.de/tumonline/wbstpcs.showSpoTree?pStpStpNr=4731";

const NAMED_ENTITIES = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  eacute: "é",
  egrave: "è",
  aacute: "á",
  uacute: "ú",
};

export function decodeEntities(value) {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, entity) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, entity) ? NAMED_ENTITIES[entity] : all;
  });
}

export function parseStudyYear(html) {
  const match = String(html).match(/pSJNr=(\d+)/);
  return match ? match[1] : null;
}

export function parsePlanNodes(html) {
  const nodes = [];
  const pattern = /<tr class="coRow([^"]*)" id="kn(\d+)">(.*?)<\/tr>/gs;
  for (const match of String(html).matchAll(pattern)) {
    const [, className, id, body] = match;
    if (className.includes("invisible")) continue;
    const text = body.match(/class="KnotenText[^"]*"([^>]*)>([^<]+)/);
    if (!text) continue;
    const titleMatch = text[1].match(/title="([^"]*)"/);
    const spans = [...body.matchAll(/<span>([^<]*)<\/span>/g)].map((item) =>
      decodeEntities(item[1]).trim(),
    );
    nodes.push({
      id,
      kind: decodeEntities(titleMatch?.[1] ?? "").trim(),
      name: decodeEntities(text[2]).trim(),
      semester: spans[0] ?? "",
      credits: spans[1] ?? "",
    });
  }
  return nodes;
}

function areaIdentity(name) {
  const match = name.match(/\(([A-Za-z0-9]+)\)\s*$/);
  if (!match) return { id: "other", name, short: "OTHER" };
  const short = match[1].toUpperCase();
  return { id: short.toLowerCase(), name: name.slice(0, match.index).trim(), short };
}

function isGroup(kind) {
  const value = kind.toLowerCase();
  return value.includes("regelknoten") || value.includes("rule node");
}

function isModule(kind) {
  const value = kind.toLowerCase();
  return value.includes("modulknoten") || value.includes("module node");
}

function isPlaceholder(name) {
  const value = name.toLowerCase();
  return value.startsWith("anerkennung") || value.startsWith("accepted elective");
}

function creditsOf(value) {
  if (!value) return 0;
  const credits = Number(String(value).replace(",", "."));
  return Number.isFinite(credits) ? credits : 0;
}

export async function collectElectives(loadNode, rootId, onProgress) {
  const areas = [];
  const courses = [];
  const seenIds = new Set();
  let duplicates = 0;
  const rootChildren = parsePlanNodes(await loadNode(rootId));
  let index = 0;
  for (const child of rootChildren) {
    if (!isGroup(child.kind)) continue;
    index += 1;
    const identity = areaIdentity(child.name);
    let areaId = identity.id;
    if (areas.some((area) => area.id === areaId)) areaId = `${areaId}-${index}`;
    onProgress?.(`Loading ${identity.name} (${index})…`);
    const found = await walkArea(loadNode, child.id, areaId, []);
    if (found.length === 0) continue;
    areas.push({ id: areaId, name: identity.name, short: identity.short });
    for (const course of found) {
      if (seenIds.has(course.id)) {
        duplicates += 1;
        continue;
      }
      seenIds.add(course.id);
      courses.push(course);
    }
  }
  if (courses.length === 0) {
    throw new Error("The elective catalog did not contain any modules.");
  }
  const theory = courses.filter((course) => course.theoretical).length;
  const notes = [
    `Imported ${courses.length} modules in ${areas.length} areas.`,
    "Unrated modules stay out of the plan until you set a preference.",
    "The study plan does not list winter or summer, so every module counts in both semesters.",
    `${theory} modules sit under a theory group and are marked as theory.`,
  ];
  if (duplicates > 0) {
    notes.push(
      `${duplicates} ${duplicates === 1 ? "module was listed" : "modules were listed"} in more than one area and kept in the first one.`,
    );
  }
  return { areas, courses, summary: notes.join(" ") };
}

async function walkArea(loadNode, nodeId, areaId, ancestors) {
  const courses = [];
  const children = parsePlanNodes(await loadNode(nodeId));
  for (const child of children) {
    if (isGroup(child.kind)) {
      const nested = await walkArea(loadNode, child.id, areaId, [...ancestors, child.name]);
      for (const course of nested) courses.push(course);
      continue;
    }
    if (!isModule(child.kind)) continue;
    const codeMatch = child.name.match(/^\[([^\]]+)\]\s*(.*)$/);
    const name = (codeMatch?.[2] ?? child.name).trim();
    if (isPlaceholder(name)) continue;
    const credits = creditsOf(child.credits);
    if (credits <= 0) continue;
    courses.push({
      id: (codeMatch?.[1] ?? child.id).trim(),
      name,
      credits,
      semester: null,
      preference: 0,
      theoretical: ancestors.some((ancestor) => ancestor.toLowerCase().includes("theor")),
      area: areaId,
    });
  }
  return courses;
}

export function buildImportedCatalog(baseRaw, collected) {
  const base = baseRaw?.requirements ?? {};
  return {
    meta: {
      title: collected.title || CATALOG_NAMES[0],
      source: SOURCE_URL,
    },
    requirements: {
      totalCredits: base.totalCredits ?? 53,
      theoreticalCredits: base.theoreticalCredits ?? 10,
      overagePenalty: base.overagePenalty ?? 0.75,
      maxOverage: base.maxOverage ?? 24,
      areaQuotas: base.areaQuotas ?? [18, 8, 8],
      areas: collected.areas,
    },
    courses: collected.courses,
  };
}

function subtreeUrl(year, nodeId) {
  const params = new URLSearchParams({
    pStStudiumNr: "",
    pStpStpNr: "4731",
    pStPersonNr: "",
    pSJNr: year,
    pIsStudSicht: "FALSE",
    pShowErg: "J",
    pHideInactive: "TRUE",
    pCaller: "",
    pAction: "0",
    pStartSemester: "W",
    pStpKnotenNr: nodeId,
    pId: `kn${nodeId}`,
  });
  return `/tumonline/wbStpCs.cbSpoTree?${params.toString()}`;
}

async function loadPage(url) {
  let response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error("The TUM study plan could not be loaded. Run the app with npm run dev and try again.");
  }
  if (!response.ok) {
    throw new Error("The TUM study plan could not be loaded. Run the app with npm run dev and try again.");
  }
  return response.text();
}

export async function fetchTumElectives(onProgress) {
  onProgress?.("Loading the study plan…");
  const page = await loadPage(PLAN_PAGE);
  const year = parseStudyYear(page);
  if (!year) throw new Error("The study plan did not include a study year.");
  const catalog = parsePlanNodes(page).find((node) => CATALOG_NAMES.includes(node.name));
  if (!catalog) throw new Error("The informatics elective catalog was not found on the study plan.");
  const collected = await collectElectives(
    (nodeId) => loadPage(subtreeUrl(year, nodeId)),
    catalog.id,
    onProgress,
  );
  collected.title = catalog.name;
  return collected;
}
