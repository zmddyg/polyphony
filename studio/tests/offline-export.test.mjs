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
    return [name, Buffer.from(url.split(',')[1], 'base64').toString('utf8')];
  }));
}

test('standalone exports include lazy dependencies and route styles', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'polyphony-offline-'));
  const studio = join(dir, 'studio.html');
  const playlab = join(dir, 'playlab.html');
  try {
    await run(process.execPath, [exporter, studio]);
    await run(process.execPath, [exporter, '--challenges', playlab]);
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
    assert.deepEqual([...studioHtml.matchAll(/<template data-view-style="([^"]+)"/g)].map(([, name]) => name), viewStyles);
    assert.doesNotMatch(studioHtml, /<script[^>]+src=|<link[^>]+rel="stylesheet"/);
    assert.doesNotMatch(studioHtml, /QR Code Generator for JavaScript/);

    const diagram = studioHtml.match(/id="polyphony-architecture"[^>]*>([^<]+)<\/script>/)?.[1];
    assert.ok(diagram);
    const svg = await readFile(new URL('../dist/assets/architecture.svg', import.meta.url), 'utf8');
    assert.equal(Buffer.from(diagram, 'base64').toString('utf8'), svg.replace(/^\uFEFF/, ''));
    assert.ok(!modules['@polyphony/app.mjs'].includes(diagram), 'the app does not contain another copy of the diagram');

    assert.ok(embeddedModules(playlabHtml)['@polyphony/views/challenge-preview.mjs']);
    assert.match(playlabHtml, /href="#rc"/);
    assert.doesNotMatch(playlabHtml, /data-view-style|polyphony-architecture/);
  } finally {
    await Promise.all([rm(studio, {force:true}), rm(playlab, {force:true})]);
    await rmdir(dir);
  }
});
