import assert from 'node:assert/strict';
import test from 'node:test';
import katex from '../dist/vendor/katex/katex.mjs';
import { latexToMathML, recoverJsonEscapedLatex, renderRichMathHtml, validateMathSource } from '../dist/core/math-render.mjs';
import { NATIVE_BLOCK_SCHEMA, reviseSlide } from '../dist/core/deck-harness.mjs';
import { createBrowserMediaSearch } from '../dist/core/browser-media-search.mjs';
import {
  buildLectureScore, inferSlideArchetype, lectureFrame, LECTURE_ARCHETYPES, resolveLectureLayout, validateSlideBlocks,
} from '../dist/core/lecture-score.mjs';
import { suggestCourseLayout } from '../dist/core/agent-spec.mjs';
import { renderLectureFrame, renderSlideBlocks } from '../dist/views/lecture-stage.mjs';
import { normalizeEditedSlide } from '../dist/views/page-editor.mjs';
import { fetchSafeEmbeddedImage, isPublicMediaAddress, searchEmbeddedMedia, searchMediaCandidates } from '../media-search.mjs';
import { request, roomTestServer, startLoopbackServer } from './support/integration.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X7i0AAAAASUVORK5CYII=';
const pngResponse = () => new Response(Buffer.from(png, 'base64'), { headers: { 'Content-Type': 'image/png' } });
const thumb = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.png/960px-Example.png';
const originals = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.png';
const flickr = 'https://live.staticflickr.com/1234/fixture.jpg';
const raster = 'data:image/png;base64,' + png;
const noDelay = async () => {};

function commonsImage(url = thumb) {
  return { query: { pages: [{ pageid: 17, ns: 6, title: 'File:Example.png', imageinfo: [{
    thumburl: url, thumbmime: 'image/png', thumbwidth: 960, thumbheight: 600, url: originals,
    extmetadata: { LicenseShortName: { value: 'CC BY 4.0' }, Artist: { value: '<b>Optics &amp; Lab</b>' } },
  }] }] } };
}

test('vendored KaTeX 0.19.1 renders visual HTML and semantic MathML for advanced and multi-line TeX', () => {
  assert.equal(katex.version, '0.19.1');
  for (const tex of [
    '\\mathbb{R}', '\\mathcal{F}', '\\boldsymbol{\\beta}', '\\begin{aligned}a&=b\\\\c&=d\\end{aligned}',
    '\\binom{n}{k}', '\\boxed{x=1}', '\\sinc(x)', '45\\degree',
  ]) {
    assert.match(latexToMathML(tex), /class="katex-html".*/s);
    assert.match(latexToMathML(tex), /<math\b/);
    assert.equal(validateMathSource(tex, { block: true }).ok, true, tex);
  }
  const rows = renderRichMathHtml('a&=b\\\\\nc&=d（第二行继续推导）', { block: true });
  assert.match(rows, /<math[^>]*display="block"[^>]*>.*<mtable\b/s);
  assert.match(rows, /第二行继续推导/);
  assert.match(renderRichMathHtml('约定：$E=mc^2$（真空情形）', { block: true }), /约定[：:].*display="block".*真空情形/s);
  assert.match(renderRichMathHtml('$x^2$', { block: true }), /display="block"/);
  assert.doesNotMatch(renderRichMathHtml('$x^2$'), /display="block"/);
});

test('JSON control-character recovery keeps normal prose line breaks and restores TeX commands', () => {
  const corrupted = JSON.parse('"\\frac{1}{2}+\\theta+\\beta+\\nabla\\right)"');
  assert.equal(recoverJsonEscapedLatex(corrupted), '\\frac{1}{2}+\\theta+\\beta+\\nabla\\right)');
  const tex = JSON.parse('"\\forall x \\ne 0, \\text{x} \\times \\rho \\to \\boxed{1}"');
  assert.equal(recoverJsonEscapedLatex(tex), '\\forall x \\ne 0, \\text{x} \\times \\rho \\to \\boxed{1}');
  assert.equal(recoverJsonEscapedLatex('前提\n第二行\t列二'), '前提\n第二行\t列二');
  assert.match(renderRichMathHtml('$' + JSON.parse('"\\frac{\\theta}{\\beta}"') + '$'), /<mfrac>/);
});

test('failed or refused formula delimiters are consumed as a pair and leave following prose and math intact', () => {
  const bad = '\\missingCommand{1}';
  const html = renderRichMathHtml('$' + bad + '$ 前提仍在 $x+1$');
  assert.match(html, /前提仍在/);
  assert.equal((html.match(/<math\b/g) ?? []).length, 1);
  assert.deepEqual(validateMathSource('已知 $x=1$'), { ok: true, errors: [] });
  const invalid = validateMathSource('$' + bad + '$ 前提仍在 $x+1$');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.length, 1);
  assert.equal(invalid.errors[0].tex, bad);
  assert.ok(invalid.errors[0].message);
  assert.equal(validateMathSource('\\frac{x}{', { block: true }).ok, false);
  assert.equal(validateMathSource('式子见右栏', { block: true }).ok, true);
});

test('rich math escapes HTML and rejects untrusted TeX while supporting safe inline Markdown', () => {
  const source = '<script>bad()</script> **粗体** *斜体* `<img onerror=bad()> $literal$` $x\\times y$';
  const html = renderRichMathHtml(source);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(html, /<strong>粗体<\/strong> <em>斜体<\/em>/);
  assert.match(html, /<code class="inline-code">&lt;img onerror=bad\(\)&gt; \$literal\$<\/code>/);
  assert.equal((html.match(/<math\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<script\b|<img\b/);
  const untrusted = '\\href{javascript:alert(1)}{x}';
  const blocked = renderRichMathHtml('$' + untrusted + '$ 后续 $y$');
  assert.doesNotMatch(blocked, /href=["']javascript:|<a\b/i);
  assert.match(blocked, /后续/);
  assert.equal((blocked.match(/<math\b/g) ?? []).length, 1);
  assert.equal(validateMathSource('$' + untrusted + '$').ok, false);
});

const bullets = { type: 'bullets', title: '条件', items: ['**小角近似**要求 $\\theta\\ll 1$。'] };
const formula = { type: 'formula', title: '强度式', items: ['I=I_0\\sinc^2(u)'] };
const chart = { type: 'chart', title: '光强', xLabel: '$u$', yLabel: '$I(u)$', points: [{ x: 0, y: 1 }, { x: 1, y: 0.4 }] };
const makeScore = pages => buildLectureScore({ name: '光学讲义', title: '光学讲义', type: 'native', pages });

test('all six visual archetypes survive score validation and render on standard lecture frames', () => {
  const types = ['cover', 'section', 'derivation', 'split-compare', 'example', 'summary'];
  assert.deepEqual([...LECTURE_ARCHETYPES].sort(), types.toSorted());
  const score = makeScore(types.map((archetype, i) => ({
    number: i + 1, title: '页 ' + (i + 1), archetype, blocks: [bullets, formula],
    text: '条件\n**小角近似**要求 $\\theta\\ll 1$。\n强度式\nI=I_0\\sinc^2(u)',
  })));
  for (const [i, type] of types.entries()) {
    const element = {};
    const frame = lectureFrame(score, i);
    assert.equal(frame.archetype, type);
    renderLectureFrame(element, frame);
    assert.match(element.innerHTML, new RegExp('data-[a-z-]*archetype="' + type + '"'));
    assert.doesNotMatch(element.innerHTML, /查看原页文字/);
  }
  assert.throws(() => makeScore([{ number: 1, title: '无效原型', archetype: 'unlisted', blocks: [bullets] }]));
});

test('older pages infer archetypes and choose a wide layout for complementary blocks', () => {
  assert.equal(inferSlideArchetype({ title: '物理光学', blocks: [bullets] }, 0, 8), 'cover');
  assert.equal(inferSlideArchetype({ title: '第二章 干涉与衍射' }, 1, 8), 'section');
  assert.equal(inferSlideArchetype({ title: '积分式推导', blocks: [bullets, formula] }, 2, 8), 'derivation');
  assert.equal(inferSlideArchetype({ title: '两种解法的比较', blocks: [bullets, formula] }, 3, 8), 'split-compare');
  assert.equal(inferSlideArchetype({ title: '例题：计算第一暗纹位置', blocks: [bullets, formula] }, 4, 8), 'example');
  assert.equal(inferSlideArchetype({ title: '本节总结', blocks: [bullets] }, 7, 8), 'summary');
  const complementary = { layout: 'auto', blocks: [bullets, chart], images: [] };
  assert.equal(resolveLectureLayout(complementary), 'content-columns');
  assert.ok(['auto', 'content-columns'].includes(suggestCourseLayout(complementary)));
  assert.equal(resolveLectureLayout({ ...complementary, images: [{ src: raster }] }), 'split-right');
});

test('statistical titles, values, and labels use rich math; structural chart schemas support points and series', () => {
  const stats = { type: 'stat-grid', title: '**系统参数** $n$', items: [{ value: '$\\sqrt{2}$', label: '角度 $\\theta$' }] };
  const html = renderSlideBlocks([stats]);
  assert.match(html, /<strong>系统参数<\/strong>/);
  assert.match(html, /<msqrt>/);
  assert.match(html, /角度 /);
  assert.equal((html.match(/<math\b/g) ?? []).length, 3);
  assert.match(renderSlideBlocks([chart]), /slide-chart/);
  const variants = NATIVE_BLOCK_SCHEMA.anyOf.filter(schema => schema.properties.type.const === 'chart');
  const pointVariant = variants.find(schema => schema.properties.points);
  const seriesVariant = variants.find(schema => schema.properties.series);
  for (const key of ['title', 'xLabel', 'yLabel']) assert.ok(pointVariant.properties[key] && seriesVariant.properties[key]);
  assert.deepEqual(pointVariant.properties.points.items.required, ['x', 'y']);
  assert.deepEqual(seriesVariant.properties.series.items.required, ['label', 'points']);
  assert.deepEqual(validateSlideBlocks([chart])[0].points, chart.points);
  assert.throws(() => validateSlideBlocks([{ ...chart, points: [{ x: Infinity, y: 1 }] }]));
});

test('normalizing a single slide revision persists typed blocks, synchronized body and the chosen prototype', () => {
  const title = '更清楚的 $I(u)$';
  const revised = normalizeEditedSlide({ title: '  ' + title + '  ', archetype: 'derivation', blocks: [bullets, formula] });
  assert.equal(revised.title, title);
  assert.match(revised.text, /小角近似.*\n强度式\nI=I_0/s);
  const original = { number: 1, title: '旧标题', blocks: [bullets], text: '旧正文' };
  const other = { number: 2, title: '后续页', blocks: [bullets] };
  const restored = JSON.parse(JSON.stringify(makeScore([{ ...original, ...revised }, other])));
  assert.deepEqual(restored.pages[0].blocks, revised.blocks);
  assert.equal(restored.pages[0].body.join('\n'), revised.text);
  assert.equal(restored.pages[0].archetype, 'derivation');
  assert.equal(restored.pages[1].title, other.title);
  assert.equal(original.title, '旧标题');
});

test('Commons accepts thumb.wikimedia.org and embeds a raster image with cleaned attribution', async () => {
  const fetchImpl = async url => url.href === thumb ? pngResponse() :
    Response.json(url.hostname === 'commons.wikimedia.org' ? commonsImage() : {});
  const { candidates, diagnostics } = await searchEmbeddedMedia('diffraction pattern', { fetchImpl, sleep: noDelay });
  assert.equal(candidates[0].thumbnailUrl, thumb);
  assert.equal(candidates[0].image.src, raster);
  assert.equal(candidates[0].image.source, 'commons');
  assert.match(candidates[0].image.credit, /Optics & Lab/);
  assert.doesNotMatch(candidates[0].image.credit, /[<>]/);
  assert.equal(diagnostics.downloads.embedded, 1);
});

test('media retries an upstream 429 twice with a minimum interval and honors Retry-After', async () => {
  let attempts = 0;
  const waits = [];
  const { candidates } = await searchMediaCandidates('diffraction', {
    sleep: async delay => { waits.push(delay); },
    fetchImpl: async url => {
      if (url.hostname !== 'commons.wikimedia.org') return Response.json({});
      if (++attempts < 3) return new Response(null, { status: 429, headers: { 'Retry-After': '1' } });
      return Response.json(commonsImage());
    },
  });
  assert.equal(attempts, 3);
  assert.ok(waits.filter(delay => delay >= 950).length >= 2, waits);
  assert.equal(candidates[0].source, 'commons');
  const exhausted = await searchMediaCandidates('diffraction', {
    sleep: noDelay, fetchImpl: async () => new Response(null, { status: 429 }),
  });
  assert.deepEqual(exhausted.candidates, []);
  assert.equal(exhausted.diagnostics.commons.status, 'rate_limited');
});

test('structured diagnostics distinguish Wikipedia and Openverse fallback and the translated query', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.hostname === 'commons.wikimedia.org' && url.searchParams.get('titles')) {
      return Response.json(commonsImage('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.png/960px-Example.png'));
    }
    if (url.hostname === 'en.wikipedia.org' && /diffraction/i.test(url.pathname)) {
      return Response.json({ title: 'Diffraction', thumbnail: { source: thumb, width: 960, height: 600 }, originalimage: { source: originals } });
    }
    if (url.hostname === 'api.openverse.org' && /diffraction/i.test(url.searchParams.get('q') ?? '')) {
      return Response.json({ results: [{
        id: '2aff67ae-ca4c-46c2-a0a7-4b9c86fcbde2', source: 'flickr', url: flickr,
        title: 'Diffraction pattern', creator: 'Open Lab', license: 'by', license_version: '4.0',
        filetype: 'jpg', width: 1600, height: 900,
      }] });
    }
    return Response.json({});
  };
  const { candidates, diagnostics } = await searchMediaCandidates('衍射图样', { fetchImpl, sleep: noDelay });
  assert.ok(calls.some(url => /diffraction/i.test(url.searchParams.get('gsrsearch') ?? '')));
  assert.deepEqual(new Set(candidates.map(candidate => candidate.source)), new Set(['wikipedia', 'openverse']));
  assert.ok(candidates.every(candidate => candidate.license === 'CC BY 4.0'));
  assert.equal(diagnostics.commons.status, 'no_hits');
  assert.ok(diagnostics.wikipedia.attempts.length);
  assert.ok(diagnostics.openverse.attempts.length);
});

test('media safety rejects private, deceptive and unapproved URLs before any request', async () => {
  assert.equal(isPublicMediaAddress('1.1.1.1'), true);
  assert.equal(isPublicMediaAddress('2606:4700:4700::1111'), true);
  for (const address of ['127.0.0.1', '10.2.3.4', '192.168.0.2', '198.18.0.1', '::1', 'fc00::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicMediaAddress(address), false, address);
  }
  for (const url of [
    'http://thumb.wikimedia.org/a.png', 'https://127.1/a.png', 'https://10.8.0.2/a.png', 'https://[::1]/a.png',
    'https://login@thumb.wikimedia.org/a.png', 'https://thumb.wikimedia.org.example.com/a.png', 'https://cdn.example.com/a.png',
  ]) {
    let called = false;
    const result = await fetchSafeEmbeddedImage({ thumbnailUrl: url, license: 'CC BY 4.0', source: 'openverse' }, {
      fetchImpl: async () => { called = true; return pngResponse(); },
    });
    assert.equal(result, null, url);
    assert.equal(called, false, url);
  }
});

test('file browser media handles a failed CORS fetch with per-source diagnostics and local-start guidance', async () => {
  const search = createBrowserMediaSearch({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); }, sleep: noDelay });
  const result = await search({ action: 'search', query: 'diffraction' });
  assert.deepEqual(result.candidates, []);
  assert.equal(result.diagnostics.commons.status, 'network_blocked');
  assert.equal(result.diagnostics.wikipedia.status, 'network_blocked');
  assert.equal(result.message, '浏览器直连开源图库受限，建议双击「启动V4共演.cmd」使用本地多源搜图，或切换声明式示意图。');
});

test('single-slide model revision returns only normalized page content and rejects broken math', async () => {
  const base = { page: { number: 3, title: '原始页', blocks: [bullets], text: '原始讲授条件' }, instruction: '用一条强度式收束本页。' };
  let output = { title: '局部改写', blocks: [formula], images: [{ src: 'https://example.com/image.png' }] };
  const provider = { baseUrl: 'https://fixture.example/v1', model: 'fixture', key: 'fixture-secret', outputMode: 'json_schema',
    fetchImpl: async (url, init) => {
      const requestBody = JSON.parse(init.body);
      assert.equal(url.pathname, '/v1/chat/completions');
      assert.equal(requestBody.response_format.json_schema.name, 'slide_revision');
      assert.match(requestBody.messages[1].content, /原始讲授条件/);
      return Response.json({ choices: [{ message: { content: JSON.stringify(output) } }] });
    } };
  assert.deepEqual(await reviseSlide({ ...base, provider }), {
    title: '局部改写', blocks: [formula], text: '强度式\nI=I_0\\sinc^2(u)', source: 'provider',
  });
  output = { ...output, blocks: [{ ...formula, items: ['\\frac{1}{'] }] };
  await assert.rejects(reviseSlide({ ...base, provider }), /公式/);
  await assert.rejects(reviseSlide(base), /先连接模型/);
});

test('teacher-only revise-slide route runs through the configured provider and returns a single checked slide', async t => {
  const origin = await startLoopbackServer(t, async (req, res) => {
    for await (const chunk of req) void chunk;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: '课堂改写', blocks: [formula] }) } }] }));
  });
  if (!origin) return;
  const roomServer = await roomTestServer(t);
  if (!roomServer) return;
  const { origin: classroom } = roomServer;
  const created = await request(classroom, '/api/rooms', { data: { demo: false } });
  const { room } = await created.json();
  const path = '/api/rooms/' + room.code + '/';
  const cookie = created.headers.get('set-cookie').split(';', 1)[0];
  const input = { page: { title: '原页', blocks: [bullets] }, instruction: '加上一个公式。' };
  assert.equal((await request(classroom, path + 'revise-slide', { data: input })).status, 403);
  assert.equal((await request(classroom, path + 'provider', { cookie, data: {
    baseUrl: origin + '/v1', model: 'revision-fixture', key: 'loopback-fixture-token',
  } })).status, 200);
  const response = await request(classroom, path + 'revise-slide', { cookie, data: input });
  assert.equal(response.status, 200);
  const revised = await response.json();
  assert.equal(revised.title, '课堂改写');
  assert.deepEqual(revised.blocks, [formula]);
  assert.equal(revised.source, 'provider');
});
