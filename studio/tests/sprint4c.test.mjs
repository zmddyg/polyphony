import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { suggestCourseLayout } from '../dist/core/agent-spec.mjs';
import { authorSlideBatches, planCourseBlueprint } from '../dist/core/course-agent.mjs';
import { authoringPageSchemas, createCourseTools } from '../dist/core/course-tools.mjs';
import { NATIVE_BLOCK_SCHEMA, createPageModule, validateHarnessLesson } from '../dist/core/deck-harness.mjs';
import { renderDiagramSvg } from '../dist/core/diagram-render.mjs';
import { resolveLectureLayout } from '../dist/core/lecture-score.mjs';
import { createMediaLibrary, httpsUrl } from '../dist/core/media-library.mjs';
import { renderLectureFrame } from '../dist/views/lecture-stage.mjs';
import { renderScienceChart } from '../dist/views/material-science.mjs';
import { authoredPage, modelReply, modelRequest, toolReply, toolResult } from './support/course-model.mjs';

const spec = { course: '物理光学', topic: '单缝衍射与分辨率', pageCount: 10 };
const allPageNumbers = Array.from({ length: spec.pageCount }, (_, index) => index + 1);

function provider(handle) {
  return {
    baseUrl: 'https://api.fixture.example/v1',
    model: 'deepseek-v4-pro',
    key: 'fixture-token-4c',
    outputMode: 'json_schema',
    async fetchImpl(_url, init) {
      const body = JSON.parse(init.body);
      return handle(modelRequest(body), body);
    },
  };
}

test('the blueprint schema locks page count and retries with the prior count error', async () => {
  const expected = await planCourseBlueprint(spec);
  let requests = 0;
  const result = await planCourseBlueprint(spec, { provider: provider(({ name, input }, body) => {
    assert.equal(name, 'course_blueprint');
    const { minItems, maxItems } = input.schema.properties.pagePlans;
    assert.equal(minItems, spec.pageCount);
    assert.equal(maxItems, spec.pageCount);
    assert.deepEqual(body.response_format.json_schema.schema, input.schema);
    assert.match(body.messages[0].content, /pagePlans 数组长度必须严格等于 10/u);
    requests++;
    if (requests === 1) return modelReply({ ...expected, pagePlans: expected.pagePlans.slice(0, -1) });
    assert.match(body.messages.at(-1).content, /修正.*pagePlans.*9 页.*10 页/u);
    return modelReply(expected);
  }) });
  assert.equal(requests, 2);
  assert.deepEqual(result.pagePlans.map(({ pageNumber }) => pageNumber), allPageNumbers);
});

test('a one-page chapter boundary drift is corrected against the complete plans', async () => {
  const expected = await planCourseBlueprint(spec);
  const shifted = structuredClone(expected);
  shifted.chapters[0].endPage++;
  shifted.chapters[1].startPage++;
  let requests = 0;
  const result = await planCourseBlueprint(spec, { provider: provider(() => {
    requests++;
    return modelReply(shifted);
  }) });
  assert.equal(requests, 1);
  assert.deepEqual(result.chapters, expected.chapters);
  assert.deepEqual(result.pagePlans, expected.pagePlans);

  shifted.chapters[0].endPage++;
  shifted.chapters[1].startPage++;
  requests = 0;
  const retried = await planCourseBlueprint(spec, { provider: provider(() => modelReply(++requests === 1 ? shifted : expected)) });
  assert.equal(requests, 2);
  assert.deepEqual(retried.chapters, expected.chapters);
});

for (const ending of ['step exhaustion', 'premature done']) {
  test(`the first batch retries only its uncommitted page after ${ending}`, async () => {
    const blueprint = await planCourseBlueprint(spec);
    const firstPlan = blueprint.pagePlans.find(plan => plan.pageNumber === 5);
    let initialTurns = 0;
    let retryTurns = 0;
    const result = await authorSlideBatches(blueprint, { spec, provider: provider(({ name, input }, body) => {
      assert.equal(name, 'course_slide_batch');
      const numbers = input.pagePlans.map(plan => plan.pageNumber);
      const entries = input.pagePlans.map(plan => authoredPage(plan));
      if (numbers[0] === 1) {
        assert.deepEqual(numbers, [1, 2, 3, 4, 5]);
        initialTurns++;
        if (initialTurns === 1) return toolReply('commit_slides', { pages: entries.slice(0, -1) }, 'partial');
        assert.deepEqual(toolResult(body, 'partial').committed, [1, 2, 3, 4]);
        if (ending === 'premature done') return modelReply({ done: true });
        return toolReply('validate_math_and_diagram', { slide: entries.at(-1) }, `draft_${initialTurns}`);
      }
      if (numbers[0] === 5) {
        assert.deepEqual(input.pagePlans, [firstPlan]);
        retryTurns++;
        if (ending === 'premature done') {
          const feedback = body.messages.filter(message => message.role === 'user').map(({ content }) => content).join('\n');
          assert.match(feedback, /commit_slides/u);
          assert.match(feedback, /第\s*5\s*页/u);
        }
        // The final response lands on the eighth turn in the step exhaustion retry.
        if (ending === 'step exhaustion' && retryTurns < 7) {
          return toolReply('validate_math_and_diagram', { slide: entries[0] }, `retry_draft_${retryTurns}`);
        }
        const committed = toolResult(body, 'finish_page');
        if (!committed) return toolReply('commit_slides', { pages: entries }, 'finish_page');
        assert.deepEqual(committed.committed, [5]);
        return modelReply({ done: true });
      }
      assert.deepEqual(numbers, [6, 7, 8, 9, 10]);
      if (!toolResult(body, 'second_batch')) return toolReply('commit_slides', { pages: entries }, 'second_batch');
      return modelReply({ done: true });
    }) });
    assert.equal(initialTurns, ending === 'step exhaustion' ? 14 : 2);
    assert.equal(retryTurns, ending === 'step exhaustion' ? 8 : 2);
    assert.deepEqual(result.pages.map(({ number }) => number), allPageNumbers);
    assert.deepEqual(result.failures, []);
    assert.equal(result.repairs.length, 1);
    assert(result.batches.every(batch => batch.status === 'complete'));
  });
}

test('the plotting tool accepts named expressions and clamps, rounds, and defaults sample counts', () => {
  const schemas = authoringPageSchemas(NATIVE_BLOCK_SCHEMA);
  const { handlers } = createCourseTools({ spec, context: { credentials: [] }, schemas, pageSchema: schemas.authored });
  const config = { title: '单缝衍射', xLabel: 'x', yLabel: 'I', xMin: -1, xMax: 1 };
  for (const [samples, expected] of [[500, 121], [5, 81], [100.7, 101], [undefined, 101]]) {
    const result = handlers.plot_math_chart({ ...config, samples, curves: [
      { label: '归一化光强', expr: 'I(x) = sinc(x)^2' },
      { label: '强度比', expr: 'I / I0 = sinc(x)^2' },
    ] });
    assert.equal(result.ok, true);
    assert.equal(result.samples, expected);
    for (const { points } of result.block.series) {
      assert.equal(points.length, expected);
      assert.deepEqual(points[(expected - 1) / 2], { x: 0, y: 1 });
    }
  }
  for (const expr of ['sin(x)/x', 'sin(pi*x)/(pi*x)']) {
    const singular = handlers.plot_math_chart({ ...config, curves: [{ label: '光强', expr }] });
    assert.equal(singular.ok, false);
    assert.match(singular.reason, /x=0 处出现 0\/0.*sinc\(u\)/u);
  }
});

const raster = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X7i0AAAAASUVORK5CYII=';

function photograph(title, filename, src = raster) {
  return { title, width: 1200, height: 800, image: {
    src, alt: title, source: 'commons', license: 'CC BY 4.0',
    sourceUrl: `https://commons.wikimedia.org/wiki/File:${filename}.png`,
  } };
}

test('media selected in one batch is filtered by URL, normalized title and bytes in a later batch', async () => {
  const imageSpec = { ...spec, pageCount: 6, enableWebImages: true };
  const blueprint = await planCourseBlueprint(imageSpec);
  const interference = photograph('Laser Interference', 'Laser_Interference');
  const unused = photograph('Diffraction grating spectrum', 'Diffraction_grating_spectrum', 'data:image/png;base64,AA==');
  const firstResults = [interference, unused];
  const laterResults = [
    photograph('Laser experiment', 'Laser_Interference', 'data:image/png;base64,AQ=='),
    photograph('Ｌａｓｅｒ  INTERFERENCE ', 'Other_interference_photo', 'data:image/png;base64,Ag=='),
    photograph('Lab setup', 'Lab_setup'),
    unused,
  ];
  const searched = [];
  const result = await authorSlideBatches(blueprint, {
    spec: imageSpec,
    async searchEmbeddedMedia(query) {
      searched.push(query);
      return { candidates: query === 'laser interference' ? firstResults : laterResults };
    },
    provider: provider(({ input }, body) => {
      const firstBatch = input.pagePlans[0].pageNumber === 1;
      const images = toolResult(body, 'media_options');
      if (!images) return toolReply('search_media', { query: firstBatch ? 'laser interference' : 'diffraction grating spectrum' }, 'media_options');
      assert.equal(images.ok, true);
      assert.deepEqual(images.candidates.map(candidate => candidate.title), firstBatch
        ? firstResults.map(candidate => candidate.title) : [unused.title]);
      const committed = toolResult(body, 'batch_pages');
      if (!committed) return toolReply('commit_slides', { pages: input.pagePlans.map((plan, index) =>
        authoredPage(plan, index === 0 ? { mediaIds: [images.candidates[0].id] } : {}),
      ) }, 'batch_pages');
      assert.equal(committed.ok, true);
      return modelReply({ done: true });
    }),
  });
  const embedded = result.pages.flatMap(page => page.images);
  assert.deepEqual(searched, ['laser interference', 'diffraction grating spectrum']);
  assert.deepEqual(result.failures, []);
  assert.equal(result.pages.length, imageSpec.pageCount);
  assert.deepEqual(embedded.map(image => image.src), [interference.image.src, unused.image.src]);
});

const rayDiagram = {
  type: 'diagram', kind: 'flow', direction: 'LR', title: '远场光路',
  nodes: [{ id: 'slit', label: String.raw`$k d \sin \theta$`, sub: String.raw`\(x_0^2, y^-1\)` },
    { id: 'screen', label: String.raw`\text{屏面} \lambda` }],
  edges: [{ from: 'slit', to: 'screen', label: String.raw`\Delta\varphi` }],
};

test('diagram SVG labels and accessible text display Unicode math without raw LaTeX', () => {
  const html = renderDiagramSvg(rayDiagram);
  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/u)?.[0];
  assert.ok(svg);
  assert.match(svg, /<text\b[^>]*>k d sin θ<\/text>/u);
  assert.match(svg, /<text\b[^>]*>Δφ<\/text>/u);
  assert.match(svg, /x₀², y⁻¹/u);
  assert.match(svg, /屏面 λ/u);
  assert.doesNotMatch(svg, /[\\$]/u);
});

const stageStyles = new URL('../dist/views/lecture-stage.css', import.meta.url);

test('picture covers split by default and the explicit media-top reserves space for the introduction', async () => {
  const root = { innerHTML: '' };
  const cover = { title: '物理光学', archetype: 'cover', images: [{ src: raster }] };
  assert.equal(suggestCourseLayout(cover), 'split-right');
  assert.equal(resolveLectureLayout(cover), 'split-right');
  const blocks = [{ type: 'bullets', items: ['认识衍射条件', '对照实验图样', '验证角分辨极限'] }];
  renderLectureFrame(root, { ...cover, blocks });
  assert.match(root.innerHTML, /data-lecture-layout="split-right" data-archetype="cover"/u);
  assert.match(root.innerHTML, /lecture-frame-layout--split/u);
  assert.match(root.innerHTML, /lecture-frame-copy[\s\S]*?lecture-frame-head[\s\S]*?验证角分辨极限[\s\S]*?lecture-frame-visual/u);
  renderLectureFrame(root, { ...cover, layout: 'media-top', blocks });
  assert.match(root.innerHTML, /data-lecture-layout="media-top" data-archetype="cover"/u);
  assert.match(root.innerHTML, /验证角分辨极限/u);
  const css = await readFile(stageStyles, 'utf8');
  assert.match(css, /\[data-archetype="cover"\]\[data-lecture-layout="media-top"\] \.lecture-frame-visual img\s*\{\s*max-block-size: min\(/u);
});

test('summary diagrams span the copy column when the other split column contains an image', async () => {
  const root = { innerHTML: '' };
  const summary = { title: '推导小结', archetype: 'summary', images: [{ src: raster }], blocks: [
    { type: 'bullets', title: '观察', items: ['由缝宽预测图样变化'] },
    { type: 'bullets', title: '条件', items: ['区分远场与近场'] },
    rayDiagram,
  ] };
  for (const layout of ['split-right', 'split-left']) {
    renderLectureFrame(root, { ...summary, layout });
    assert(root.innerHTML.includes(`data-lecture-layout="${layout}" data-archetype="summary"`));
    assert.match(root.innerHTML, /lecture-frame-layout--split/u);
    assert.match(root.innerHTML, /lecture-frame-copy[\s\S]*?slide-blocks--summary(?:-grid)?"[\s\S]*?class="slide-diagram"/u);
  }
  const css = await readFile(stageStyles, 'utf8');
  assert.match(css, /\[data-archetype="summary"\] \.lecture-frame-layout--split \.slide-blocks > \.slide-diagram\s*\{\s*grid-column: 1 \/ -1;/u);
});

test('validate_math_and_diagram discounts LaTeX markup and treats 341-480 visible chars as non-blocking warnings', () => {
  const schemas = authoringPageSchemas(NATIVE_BLOCK_SCHEMA);
  const { handlers } = createCourseTools({ spec, context: { credentials: [] }, schemas, pageSchema: schemas.authored });
  const latexHeavy = {
    title: '夫琅禾费单缝衍射复振幅积分',
    blocks: [
      {
        type: 'formula',
        title: '惠更斯-菲涅耳叠加与光强分布',
        items: [
          String.raw`\tilde{U}(P) = C \int_{-a/2}^{a/2} \exp\left(-i \frac{2\pi}{\lambda} x \sin\theta\right)\,dx = C a \frac{\sin\alpha}{\alpha}`,
          String.raw`\alpha = \frac{\pi a \sin\theta}{\lambda}, \qquad I(\theta) = \tilde{U}^{*}(P)\tilde{U}(P) = I_0 \left(\frac{\sin\alpha}{\alpha}\right)^2`,
          String.raw`a \sin\theta = \pm m \lambda \quad (m = 1, 2, 3, \dots)`,
        ],
      },
      {
        type: 'bullets',
        title: '物理意义与适用边界',
        items: [
          String.raw`采用时间因子 $e^{-i\omega t}$ 与复振幅 $\tilde{U}(P)=A(P)e^{i\varphi(P)}$，光强取模方。`,
          String.raw`远场条件要求菲涅耳数 $F = a^2 / (\lambda L) \ll 1$，否则需改用菲涅耳衍射积分。`,
        ],
      },
    ],
  };
  const mathCheck = handlers.validate_math_and_diagram({ slide: latexHeavy });
  assert.equal(mathCheck.ok, true);
  assert.deepEqual(mathCheck.issues, []);
  assert.equal(mathCheck.warnings, undefined);
  assert(mathCheck.visibleCharacters < 300, `expected <300 visual chars, got ${mathCheck.visibleCharacters}`);

  const advisory = handlers.validate_math_and_diagram({
    slide: {
      title: '中等篇幅导学',
      blocks: [{ type: 'callout', title: '要点', text: '光学推导说明文字'.repeat(46), tone: 'note' }],
    },
  });
  assert.equal(advisory.ok, true);
  assert.deepEqual(advisory.issues, []);
  assert.equal(advisory.warnings?.length, 1);

  const overflow = handlers.validate_math_and_diagram({
    slide: {
      title: '过密页面',
      blocks: [{ type: 'callout', title: '正文', text: '光学推导说明文字'.repeat(65), tone: 'note' }],
    },
  });
  assert.equal(overflow.ok, false);
  assert.match(overflow.issues[0], /密度|320/u);
});

test('commons media search filters PDF/IA scans and adds bitmap|drawing filetype restriction', async () => {
  const queries = [];
  const library = createMediaLibrary({
    allowUrl: httpsUrl,
    encodeImage: ({ mime }) => `data:${mime};base64,AA==`,
    sleep: async () => {},
    async fetchImpl(url) {
      if (url.hostname === 'commons.wikimedia.org') {
        queries.push(url.searchParams.get('gsrsearch') ?? '');
        return Response.json({
          query: {
            pages: [
              {
                pageid: 101, ns: 6, title: 'File:Optical_diffraction_(IA_book123).pdf',
                imageinfo: [{
                  mime: 'application/pdf', thumbmime: 'image/jpeg',
                  thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/book.pdf/page1-960px-book.pdf.jpg',
                  thumbwidth: 960, thumbheight: 1200,
                  extmetadata: { LicenseShortName: { value: 'Public domain' } },
                }],
              },
              {
                pageid: 102, ns: 6, title: 'File:Single_slit_diffraction_pattern.svg',
                imageinfo: [{
                  mime: 'image/svg+xml', thumbmime: 'image/png',
                  thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b2/Single_slit_diffraction_pattern.svg/960px-Single_slit_diffraction_pattern.svg.png',
                  thumbwidth: 960, thumbheight: 540,
                  extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } },
                }],
              },
            ],
          },
        });
      }
      return Response.json({}, { status: 404 });
    },
  });
  const result = await library.search('single slit diffraction pattern', { limit: 4 });
  assert(queries.some(q => /single slit diffraction pattern filetype:bitmap\|drawing/u.test(q)));
  assert.deepEqual(result.candidates.map(c => c.title), ['Single slit diffraction pattern.svg']);
});

test('validateHarnessLesson snaps formatting-only LaTeX quote diffs to verbatim source while rejecting fabricated quotes', () => {
  const sourceLine = String.raw`光强分布 $I(\theta) = I_0 \left[\mathrm{sinc}(\frac{a}{\lambda}\sin\theta) \right]^2$，极小值满足 $a\sin\theta = m\lambda$。`;
  const page = { number: 3, title: '单缝衍射', text: sourceLine, blocks: [{ id: 'M1', text: sourceLine }] };
  const base = createPageModule(page, 'concept-diagnosis@1');
  const snapped = validateHarnessLesson({
    ...base,
    evidenceIds: ['M1'],
    branches: base.branches.map(b => ({ ...b, evidenceIds: ['M1'] })),
    sourceEvidence: [{ id: 'M1', quote: String.raw`I(\theta)=I_0\left[\mathrm{sinc}(\frac{a}{\lambda}\sin\theta)\right]^2` }],
  }, page);
  assert(sourceLine.includes(snapped.sourceEvidence[0].quote));
  const tabCorrupted = '$k_1\\lambda/\text{NA}$';
  const tabPage = { number: 9, title: '光刻分辨', text: tabCorrupted, blocks: [{ id: 'M1', text: tabCorrupted }] };
  const tabBase = createPageModule(tabPage, 'concept-diagnosis@1');
  const tabSnapped = validateHarnessLesson({
    ...tabBase,
    evidenceIds: ['M1'],
    branches: tabBase.branches.map(b => ({ ...b, evidenceIds: ['M1'] })),
    sourceEvidence: [{ id: 'M1', quote: String.raw`$k_1\lambda/\text{NA}$` }],
  }, tabPage);
  assert(tabCorrupted.includes(tabSnapped.sourceEvidence[0].quote));
  assert.throws(() => validateHarnessLesson({
    ...base,
    evidenceIds: ['M1'],
    branches: base.branches.map(b => ({ ...b, evidenceIds: ['M1'] })),
    sourceEvidence: [{ id: 'M1', quote: '完全编造的结论句子' }],
  }, page), /逐字原文：M1/u);
});

test('chart axis labels with bare LaTeX commands render through offline KaTeX', () => {
  const html = renderScienceChart({
    title: '单缝衍射',
    xLabel: String.raw`u = \frac{a\sin(\theta)}{\lambda}`,
    yLabel: String.raw`I / I_0`,
    points: [{ x: -1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }],
  });
  assert.match(html, /<p class="psci-x-label"><span class="katex">/u);
  assert.match(html, /class="mfrac"/u);
  assert.doesNotMatch(html, /<p class="psci-x-label">[^<]*\\frac/u);
});
