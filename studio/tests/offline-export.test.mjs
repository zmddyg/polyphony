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

test('the offline platform omits the competition decks and the demo exports them with shared runtime', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'polyphony-offline-'));
  const studio = join(dir, 'studio.html');
  const playlab = join(dir, 'playlab.html');
  try {
    await run(process.execPath, [exporter, studio]);
    await run(process.execPath, [exporter, '--demo', playlab]);
    const [studioHtml, playlabHtml] = await Promise.all([
      readFile(studio, 'utf8'), readFile(playlab, 'utf8'),
    ]);
    const modules = embeddedModules(studioHtml);
    assert.match(modules['@polyphony/app.mjs'], /import\('@polyphony\/views\/material-workspace\.mjs'\)/);
    for (const source of Object.values(modules)) {
      for (const [, , name] of source.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1(?=\s*[,)])/g)) {
        assert.ok(Object.hasOwn(modules, name), `lazy dependency ${name} is embedded`);
      }
    }
    assert.deepEqual([...studioHtml.matchAll(/<template data-view-style="([^"]+)"/g)].map(([, name]) => name),
      viewStyles.filter(name => name !== 'lab'));
    assert.doesNotMatch(studioHtml, /<script[^>]+src=|<link[^>]+rel="stylesheet"/);
    assert.doesNotMatch(studioHtml, /QR Code Generator for JavaScript/);

    assert.doesNotMatch(studioHtml, /id="polyphony-(?:architecture|demo-decks)"/);
    assert.ok(!Object.keys(modules).some(name => name.startsWith('@polyphony/demo/')));
    assert.ok(!modules['@polyphony/core/deck-harness.mjs'].includes('deck-c-pointers'));

    const diagram = playlabHtml.match(/id="polyphony-architecture"[^>]*>([^<]+)<\/script>/)?.[1];
    assert.ok(diagram);
    const svg = await readFile(new URL('../demo/architecture.svg', import.meta.url), 'utf8');
    assert.equal(Buffer.from(diagram, 'base64').toString('utf8'), svg.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'));
    assert.ok(!modules['@polyphony/app.mjs'].includes(diagram), 'the app does not contain another copy of the diagram');

    assert.ok(embeddedModules(playlabHtml)['@polyphony/demo/lab.mjs']);
    const data = playlabHtml.match(/id="polyphony-demo-decks"[^>]*>([^<]+)<\/script>/)?.[1];
    const decks = JSON.parse(data);
    assert.deepEqual(decks.map(({ score }) => score.pages.length), [12, 10, 10]);
    assert.deepEqual(decks.map(({ score }) => score.pages.filter(page => page.interaction).length), [3, 3, 3]);
  } finally {
    await Promise.all([rm(studio, {force:true}), rm(playlab, {force:true})]);
    await rmdir(dir);
  }
});
