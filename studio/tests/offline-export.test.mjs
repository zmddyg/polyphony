import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { viewStyles } from '../dist/ui.mjs';

const run = promisify(execFile);
const exporter = fileURLToPath(new URL('../tools/export-offline.mjs', import.meta.url));

function embeddedModules(html) {
  const match = html.match(/<script type="importmap">([^<]+)<\/script>/);
  assert.ok(match, 'the HTML includes an import map');
  const { imports } = JSON.parse(match[1]);
  return Object.fromEntries(Object.entries(imports).map(([name, url]) => {
    assert.match(url, /^data:text\/javascript;charset=utf-8;base64,/);
    return [name, Buffer.from(decodeURIComponent(url.split(',')[1]), 'base64').toString('utf8')];
  }));
}

function assertEmbeddedKaTeX(html, modules) {
  const vendor = modules['@polyphony/vendor/katex/katex.mjs'];
  assert.ok(vendor?.includes('0.19.1'), 'the official KaTeX module is present');
  assert.match(modules['@polyphony/core/math-render.mjs'], /from ['"]@polyphony\/vendor\/katex\/katex\.mjs['"]/u);
  const fonts = [...html.matchAll(/url\(["']?data:font\/woff2;base64,([^)"']+)["']?\)/gu)];
  const faces = html.match(/@font-face\b/gu) ?? [];
  assert.ok(fonts.length >= 15);
  assert.equal(fonts.length, faces.length, 'each font face has exactly one embedded WOFF2 source');
  for (const [, payload] of fonts) {
    assert.equal(Buffer.from(decodeURIComponent(payload), 'base64').subarray(0, 4).toString('ascii'), 'wOF2');
  }
  assert.doesNotMatch(html, /url\(["']?fonts\/KaTeX_|format\(["'](?:woff|truetype)["']\)/u);
}

test('the offline platform omits the competition decks and the demo exports them with shared runtime', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'polyphony-offline-'));
  const studio = join(dir, 'studio.html');
  const demo = join(dir, 'demo.html');
  try {
    await run(process.execPath, [exporter, studio]);
    await run(process.execPath, [exporter, '--demo', demo]);
    const [studioHtml, demoHtml] = await Promise.all([
      readFile(studio, 'utf8'), readFile(demo, 'utf8'),
    ]);
    const modules = embeddedModules(studioHtml);
    const demoModules = embeddedModules(demoHtml);
    assertEmbeddedKaTeX(studioHtml, modules);
    assertEmbeddedKaTeX(demoHtml, demoModules);
    assert.match(modules['@polyphony/app.mjs'], /import\('@polyphony\/views\/material-workspace\.mjs'\)/);
    for (const source of Object.values(modules)) {
      for (const [, , name] of source.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1(?=\s*[,)])/g)) {
        assert.ok(Object.hasOwn(modules, name), `lazy dependency ${name} is embedded`);
      }
    }
    assert.deepEqual([...studioHtml.matchAll(/<template data-view-style="([^"]+)"/g)].map(([, name]) => name),
      viewStyles);
    assert.doesNotMatch(studioHtml, /<script[^>]+src=|<link[^>]+rel="stylesheet"/);
    assert.doesNotMatch(studioHtml, /QR Code Generator for JavaScript/);

    assert.ok(studioHtml.includes('id="polyphony-architecture"'));
    assert.doesNotMatch(studioHtml, /id="polyphony-demo-decks"/);
    assert.ok(modules['@polyphony/views/lab.mjs']);
    for(const source of Object.values(modules))assert.doesNotMatch(source,/combat-decks|deck-c-pointers|deck-optics|deck-english-seminar|polyphony-demo-decks/);
    assert.ok(!Object.keys(modules).some(name => name.startsWith('@polyphony/demo/')));
    assert.ok(!modules['@polyphony/core/deck-harness.mjs'].includes('deck-c-pointers'));

    const diagram = demoHtml.match(/id="polyphony-architecture"[^>]*>([^<]+)<\/script>/)?.[1];
    assert.ok(diagram);
    const svg = await readFile(new URL('../dist/assets/architecture.svg', import.meta.url), 'utf8');
    assert.equal(Buffer.from(diagram, 'base64').toString('utf8'), svg.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'));
    assert.ok(!modules['@polyphony/app.mjs'].includes(diagram), 'the app does not contain another copy of the diagram');

    assert.ok(demoModules['@polyphony/views/lab.mjs']);
    const data = demoHtml.match(/id="polyphony-demo-decks"[^>]*>([^<]+)<\/script>/)?.[1];
    const decks = JSON.parse(data);
    assert.deepEqual(decks.map(({ score }) => score.pages.length), [12, 10, 10]);
    assert.deepEqual(decks.map(({ score }) => score.pages.filter(page => page.interaction).length), [3, 3, 3]);
  } finally {
    await Promise.all([rm(studio, {force:true}), rm(demo, {force:true})]);
    await rmdir(dir);
  }
});
