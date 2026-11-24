import { readFile, writeFile } from 'node:fs/promises';
import path, { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { viewStyles } from '../dist/ui.mjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const preview = process.argv[2] === '--challenges';
const target = process.argv[preview ? 3 : 2];
const output = target ? path.resolve(target) : fileURLToPath(new URL(preview ? '../../Polyphony-Playlab.html' : '../../共演演示室.html', import.meta.url));
const read = async (name) => (await readFile(path.join(dist, name), 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const dataUrl = (type, value) => `data:${type};base64,${Buffer.from(value).toString('base64')}`;
const alias = (name) => `@polyphony/${name}`;
const safeScript = (script) => script.replace(/<\/script/gi, '<\\/script');

const [template, mark] = await Promise.all([
  read(preview ? 'challenges.html' : 'index.html'), read('assets/mark.svg'),
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
  preview ? [] : Promise.all(viewStyles.map(async name => [name, await read(`views/${name}.css`)])),
  preview ? null : read('assets/architecture.svg'),
]);
const html = template
  .replaceAll('./assets/mark.svg', markUrl)
  .replace(styleTag, (_, name) => `<style>\n${styles.get(name)}</style>`)
  .replace(scriptTag, (_, name) => `<script>\n${safeScript(scripts.get(name))}\n</script>`)
  .replace(moduleTag, () => [
    ...deferredStyles.map(([name, css]) => `<template data-view-style="${name}"><style>\n${css}</style></template>`),
    ...(architecture ? [`<script id="polyphony-architecture" type="application/octet-stream">${Buffer.from(architecture).toString('base64')}</script>`] : []),
    `<script type="importmap">${JSON.stringify({ imports: Object.fromEntries([...modules].map(([name, url]) => [alias(name), url])) })}</script>`,
    `<script type="module">import ${JSON.stringify(alias(entry))};</script>`,
  ].join('\n  '));

await writeFile(output, html, 'utf8');
console.log(`Exported ${output} (${Buffer.byteLength(html).toLocaleString('en-US')} bytes)`);

