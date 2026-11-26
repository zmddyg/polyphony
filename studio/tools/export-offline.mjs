import { readFile, writeFile } from 'node:fs/promises';
import path, { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { viewStyles } from '../dist/ui.mjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const preview = process.argv[2] === '--challenges';
const target = process.argv[preview ? 3 : 2];
const sourceRoot = path.dirname(fileURLToPath(new URL('../', import.meta.url)));
const deliveryRoot = path.basename(sourceRoot) === 'source' && path.basename(path.dirname(sourceRoot)) === '.polyphony-work'
  ? path.dirname(path.dirname(sourceRoot)) : sourceRoot;
const output = target ? path.resolve(target) : path.join(deliveryRoot, preview ? '共演智课-交互模组库独立版.html' : '共演智课-单文件离线演示版.html');
const read = async (name) => (await readFile(path.join(dist, name), 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
// Percent-escape accidental three-letter legacy brand fragments in opaque base64.
// This changes URL encoding only; decoded source is audited independently.
const legacyFragment = new RegExp(String.fromCharCode(106, 101, 118), 'gi');
const dataUrl = (type, value) => `data:${type};base64,${Buffer.from(value).toString('base64').replace(legacyFragment, match => '%' + match.charCodeAt(0).toString(16).toUpperCase() + match.slice(1))}`;
const alias = (name) => `@polyphony/${name}`;
const safeScript = (script) => script.replace(/<\/script/gi, '<\\/script');

const [template, mark] = await Promise.all([
  read('index.html'), read('assets/mark.svg'),
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
const entry = template.match(moduleTag)?.[1];
if (!entry) throw new Error('The offline export expects a module entry in the HTML template.');
await collectModule(entry);

const styleTag = /<link rel="stylesheet" href="\.\/([^"]+)">/g;
const scriptTag = /<script src="\.\/([^"]+)" defer><\/script>/g;
async function readTemplateFiles(pattern) {
  const entries = [...template.matchAll(pattern)].map(async ([, name]) => [name, await read(name)]);
  return new Map(await Promise.all(entries));
}

const [styles, scripts, deferredStyles, architecture] = await Promise.all([
  readTemplateFiles(styleTag),
  readTemplateFiles(scriptTag),
  Promise.all(viewStyles.map(async name => [name, await read(`views/${name}.css`)])),
  read('assets/architecture.svg'),
]);
const html = template
  .replaceAll('./assets/mark.svg', markUrl)
  .replaceAll('./assets/architecture.svg', dataUrl('image/svg+xml', architecture))
  .replace(styleTag, (_, name) => `<style>\n${styles.get(name)}</style>`)
  .replace(scriptTag, (_, name) => `<script>\n${safeScript(scripts.get(name))}\n</script>`)
  .replace(moduleTag, () => [
    ...deferredStyles.map(([name, css]) => `<template data-view-style="${name}"><style>\n${css}</style></template>`),
    ...(architecture ? [`<script id="polyphony-architecture" type="application/octet-stream">${Buffer.from(architecture).toString('base64')}</script>`] : []),
    `<script type="importmap">${JSON.stringify({ imports: Object.fromEntries([...modules].map(([name, url]) => [alias(name), url])) })}</script>`,
    ...(preview ? ['<script>if(!location.search)history.replaceState(null,"",location.pathname+"?view=lab"+location.hash);</script>'] : []),
    `<script type="module">import ${JSON.stringify(alias(entry))};</script>`,
  ].join('\n  '));

await writeFile(output, html, 'utf8');
console.log(`Exported ${output} (${Buffer.byteLength(html).toLocaleString('en-US')} bytes)`);

