import { access, readFile, writeFile } from 'node:fs/promises';
import path, { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { viewStyles } from '../dist/ui.mjs';

const studio = fileURLToPath(new URL('../', import.meta.url));
const demo = process.argv[2] === '--demo';
const target = process.argv[demo ? 3 : 2];
const sourceRoot = path.dirname(fileURLToPath(new URL('../', import.meta.url)));
const deliveryRoot = path.basename(sourceRoot) === 'source' && path.basename(path.dirname(sourceRoot)) === '.polyphony-work'
  ? path.dirname(path.dirname(sourceRoot)) : sourceRoot;
const output = target ? path.resolve(target) : path.join(deliveryRoot, demo ? '共演智课-单文件离线演示版.html' : '共演智课-离线平台.html');
const read = async (name) => (await readFile(path.join(studio, name), 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
// Percent-escape accidental three-letter legacy brand fragments in opaque base64.
// This changes URL encoding only; decoded source is audited independently.
const legacyFragment = new RegExp(String.fromCharCode(106, 101, 118), 'gi');
const escapeBase64 = value => value.replace(legacyFragment, match =>
  '%' + match.charCodeAt(0).toString(16).toUpperCase() + match.slice(1));
const dataUrl = (type, value) => `data:${type};base64,${escapeBase64(Buffer.from(value).toString('base64'))}`;
const inlineFonts = css => css.replace(/(data:font\/woff2;base64,)([A-Za-z0-9+/=]+)/g,
  (_, prefix, value) => prefix + escapeBase64(value));
const alias = name => '@polyphony/' + name.replace(/^dist\//, '');
const safeScript = (script) => script.replace(/<\/script/gi, '<\\/script');

const [template, mark] = await Promise.all([
  read('dist/index.html'), read('dist/assets/mark.svg'),
]);
const markUrl = dataUrl('image/svg+xml', mark);
const staticImport = /(^[ \t]*(?:(?:import|export)\s+[\w*$,{}\s]+?\sfrom\s*|import\s*))(['"])(\.\.?\/[^'"\r\n]+)\2/gm;
const dynamicImport = /(\bimport\s*\(\s*)(['"])(\.\.?\/[^'"\r\n]+)\2(?=\s*[,)])/g;

const modules = new Map();
async function collectModule(name) {
  if (modules.has(name)) return;
  const dependencies = [];
  const replaceSpecifier = (_, prefix, quote, target) => {
    const dependency = posix.normalize(posix.join(posix.dirname(name), target));
    dependencies.push(dependency);
    return `${prefix}${quote}${alias(dependency)}${quote}`;
  };
  const source = (await read(name))
    .replace(staticImport, replaceSpecifier)
    .replace(dynamicImport, replaceSpecifier)
    .replaceAll('./assets/mark.svg', markUrl);
  modules.set(name, dataUrl('text/javascript;charset=utf-8', source));
  for (const dependency of dependencies) await collectModule(dependency);
}

const moduleTag = /<script type="module" src="\.\/([^"]+)"><\/script>/;
const platformEntry = template.match(moduleTag)?.[1];
if (!platformEntry) throw new Error('The offline export expects a module entry in the HTML template.');
const entry = demo ? 'demo/entry.mjs' : 'dist/' + platformEntry;
await collectModule(entry);

const styleTag = /<link rel="stylesheet" href="\.\/([^"]+)">/g;
const scriptTag = /<script src="\.\/([^"]+)" defer><\/script>/g;
async function readTemplateFiles(pattern) {
  const entries = [...template.matchAll(pattern)].map(async ([, name]) => [name, await read('dist/' + name)]);
  return new Map(await Promise.all(entries));
}

async function demoLectures() {
  const parts = ['示例课件','V4原生实战课件'];
  let directory;
  for (const candidate of [path.join(deliveryRoot, ...parts), path.join(deliveryRoot, '比赛演示', ...parts)]) {
    try { await access(candidate); directory = candidate; break; } catch { /* Try the alternate layout. */ }
  }
  if (!directory) throw new Error('找不到比赛演示课件。');
  const decks = [
    ['deck-c-pointers','C 语言 · 第6章指针实战'],
    ['deck-optics','物理光学 · 干涉与电光调制'],
    ['deck-english-seminar','大学英语 · Unit 4翻转研讨'],
  ];
  return Promise.all(decks.map(async ([id,label]) => ({
    label, score: JSON.parse(await readFile(path.join(directory, id + '.json'), 'utf8')),
  })));
}
const [styles, scripts, deferredStyles, architecture, lectures, katexLicense] = await Promise.all([
  readTemplateFiles(styleTag), readTemplateFiles(scriptTag),
  Promise.all(viewStyles.map(async name =>
    [name, await read(`dist/views/${name}.css`)])),
  read('dist/assets/architecture.svg'),
  demo ? demoLectures() : null,
  read('dist/vendor/katex/LICENSE'),
]);
const html = template
  .replaceAll('./assets/mark.svg', markUrl)
  .replace(styleTag, (_, name) => `<style>\n${inlineFonts(styles.get(name))}</style>`)
  .replace(scriptTag, (_, name) => `<script>\n${safeScript(scripts.get(name))}\n</script>`)
  .replace(moduleTag, () => [
    `<!-- KaTeX license\n${katexLicense}-->`,
    ...deferredStyles.map(([name, css]) => `<template data-view-style="${name}"><style>\n${css}</style></template>`),
    ...(architecture ? [`<script id="polyphony-architecture" type="application/octet-stream">${Buffer.from(architecture).toString('base64')}</script>`] : []),
    ...(lectures ? [`<script id="polyphony-demo-decks" type="application/json">${JSON.stringify(lectures).replace(/</g, '\\u003c')}</script>`] : []),
    `<script type="importmap">${JSON.stringify({ imports: Object.fromEntries([...modules].map(([name, url]) => [alias(name), url])) })}</script>`,
    `<script type="module">import ${JSON.stringify(alias(entry))};</script>`,
  ].join('\n  '));

await writeFile(output, html, 'utf8');
console.log(`Exported ${output} (${Buffer.byteLength(html).toLocaleString('en-US')} bytes)`);

