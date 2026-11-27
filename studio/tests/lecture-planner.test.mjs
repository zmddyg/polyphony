import test from 'node:test';
import assert from 'node:assert/strict';
import { lecturePlanKinds, localLecturePlan, validatePlanSuggestions, challengeForFrame } from '../dist/core/lecture-planner.mjs';
import { createDemoMaterial, isDemoDiagram } from '../demo/demo-lesson.mjs';
import { buildLectureScore, isEmbeddedLectureImage } from '../dist/core/lecture-score.mjs';
import { formulaHtml } from '../dist/core/formula-text.mjs';
import { createHash } from 'node:crypto';
import { planLecture } from '../lesson-provider.mjs';
test('three multi-disciplinary decks preserve original pages and select universal interactions', async () => {
  const {SHOWCASE_DECKS}=await import('../demo/demo-lesson.mjs');
  const {rehearseDeckHarness}=await import('../dist/core/deck-harness.mjs');
  assert.deepEqual(SHOWCASE_DECKS.filter(d=>!d.native).map(d=>d.id),['deck-foundation','deck-photonics','deck-seminar']);
  for(const deck of SHOWCASE_DECKS.filter(d=>!d.native)){
    const material=createDemoMaterial(deck.id);
    assert.equal(material.pages.length,deck.id==='deck-seminar'?4:5);
    assert.ok(material.pages.every(p=>isDemoDiagram(p.preview)&&isEmbeddedLectureImage(p.preview)));
    const result=await rehearseDeckHarness(material);
    assert.equal(result.lectureScore.pages[0].interaction,undefined);
    assert.equal(result.lectureScore.pages.at(-1).interaction,undefined);
    assert.ok(result.suggestions.every(s=>s.activityId.endsWith('@1')));
  }
});

test('arbitrary professional concepts stay grounded and no fixed experiment is forced', () => {
  const pages = ['衍射极限为何随数值孔径变化？','色散如何改变群速度？','微环谐振损耗与耦合的折中'].map((title,i) => ({ number:i+1,title,text:'请从给定条件推导结论。' }));
  assert.ok(localLecturePlan(pages).suggestions.every(s => s.kind === 'concept'));
  const raw = { suggestions: [{ pageNumber: 1, kind: 'concept', quote: '衍射极限' }] };
  assert.equal(validatePlanSuggestions(raw, pages)[0].quote, '衍射极限');
  assert.throws(() => validatePlanSuggestions({suggestions:[{...raw.suggestions[0],quote:'不存在的材料'}]},pages));
  assert.throws(() => validatePlanSuggestions({suggestions:[{...raw.suggestions[0],kind:'unsupported'}]},pages));
  const attack = 'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
  assert.equal(isEmbeddedLectureImage(attack), false);
  assert.equal(formulaHtml('V<sub>C</sub>(0⁺)<img src=x onerror=run()>'), 'V<sub>C</sub>(0⁺)&lt;img src=x onerror=run()&gt;');
});

test('configured concept diagnosis receives the actual professional page and rejects fabricated quotations', async () => {
  const page = createDemoMaterial('deck-photonics').pages[3];
  let quote = '行波微波衰减';
  const provider = { baseUrl:'https://provider.example/v1',model:'test',key:'fixture-planner-credential',outputMode:'json_schema',
    fetchImpl:async (_url, request) => {
      const payload = JSON.parse(request.body);
      const input = JSON.parse(payload.messages[1].content);
      assert.equal(input[0].text, page.text);
      assert.deepEqual(payload.response_format.json_schema.schema.properties.suggestions.items.properties.kind.enum,['mzi','rc','aliasing','concept']);
      return Response.json({choices:[{message:{content:JSON.stringify({suggestions:[{pageNumber:4,kind:'concept',quote}]})}}]});
    } };
  const accepted = await planLecture([page],provider);
  assert.equal(accepted.source,'provider'); assert.equal(accepted.suggestions[0].kind,'concept');
  quote = '不存在的速度匹配公式';
  const rejected = await planLecture([page],provider);
  assert.equal(rejected.source,'local'); assert.ok(!JSON.stringify(rejected).includes(quote));
});
