import assert from "node:assert/strict";
import test from "node:test";
import { collectElectives, parsePlanNodes, parseStudyYear } from "./tumCatalog.js";

const AREA = `
<tr class="coRow z0 hi coTableR" id="kn1517594">
<td><span class="KnotenText" title="Wahlfach [Regelknoten] ">Algorithmen (ALG)</span></td>
<td><span></span></td><td><span></span></td><td><span>1</span></td>
</tr>`;

const MODULES = `
<tr class="coRow z0 hi coTableR" id="kn1">
<td><span class="KnotenText" title="Modulknoten ">[IN99540] Anerkennung aus dem Bereich Algorithmen</span></td>
<td><span></span></td><td><span></span></td><td><span>1</span></td>
</tr>
<tr class="coRow z1 hi coTableR" id="kn2">
<td><span class="KnotenText" title="Wahlfach [Modulknoten] ">[IN3410] Ausgew&auml;hlte Themen</span></td>
<td><span></span></td><td><span>5</span></td><td><span>1</span></td>
</tr>
<tr class="coRow z0 hi coTableR invisible" id="kn9">
<td><span class="KnotenText" title="Modulknoten ">[IN0000] Hidden</span></td>
<td><span></span></td><td><span>5</span></td><td><span>1</span></td>
</tr>
<tr class="coRow z0 hi coTableR" id="kn3">
<td><span class="KnotenText" title="Wahlfach [Regelknoten] ">Theorie</span></td>
<td><span></span></td><td><span></span></td><td><span>1</span></td>
</tr>`;

const THEORY = `
<tr class="coRow z0 hi coTableR" id="kn4">
<td><span class="KnotenText" title="Wahlfach [Modulknoten] ">[CIT423011] Topics in Computational Social Choice</span></td>
<td><span></span></td><td><span>5</span></td><td><span>1</span></td>
</tr>`;

test("Studienplan-Zeilen liefern Name, Art und ECTS", () => {
  const nodes = parsePlanNodes(MODULES);
  assert.equal(nodes.length, 3);
  assert.equal(nodes[1].name, "[IN3410] Ausgewählte Themen");
  assert.equal(nodes[1].credits, "5");
  assert.equal(parseStudyYear('new CO.Url("wbStpCs.cbSpoTree?pSJNr=1623&pCaller=")'), "1623");
});

test("der Import übernimmt Module, markiert Theorie und lässt Anerkennungen weg", async () => {
  const pages = {
    10: AREA,
    1517594: MODULES,
    3: THEORY,
  };
  const result = await collectElectives(async (id) => pages[id], "10");
  assert.deepEqual(
    result.courses.map((course) => [course.id, course.theoretical, course.preference, course.area]),
    [
      ["IN3410", false, 0, "alg"],
      ["CIT423011", true, 0, "alg"],
    ],
  );
  assert.equal(result.areas[0].short, "ALG");
  assert.match(result.summary, /2 modules/);
});
