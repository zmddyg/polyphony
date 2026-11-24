import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib';

const compressGzip = promisify(gzip);
const compressBrotli = promisify(brotliCompress);
const types = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json'], ['.svg', 'image/svg+xml'], ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'], ['.woff2', 'font/woff2'], ['.mp3', 'audio/mpeg'], ['.mp4', 'video/mp4'],
]);
const compressible = new Set(['.html', '.mjs', '.js', '.css', '.json', '.svg']);
const error = (status, message) => Object.assign(new Error(message), { status });

function selectEncoding(header = '', canCompress) {
  const weights = new Map();
  for (const entry of header.toLowerCase().split(',')) {
    const match = /^\s*(br|gzip|identity|\*)\s*(?:;\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*$/.exec(entry);
    if (match) weights.set(match[1], Number(match[2] ?? 1));
  }
  const zipped = canCompress ? weights.get('gzip') ?? weights.get('*') ?? 0 : 0;
  const brotli = canCompress ? weights.get('br') ?? 0 : 0;
  const plain = weights.get('identity') ?? (weights.get('*') === 0 ? 0 : undefined);
  if (brotli > zipped && brotli > 0 && (plain === undefined || brotli >= plain)) return 'br';
  if (zipped > 0 && (plain === undefined || zipped >= plain)) return 'gzip';
  if (plain !== 0) return 'identity';
  throw error(406, 'No acceptable representation.');
}

function isFresh(headers, tag, modified) {
  const tags = headers['if-none-match'];
  if (tags !== undefined) {
    return tags.split(',').some(value => {
      const candidate = value.trim();
      return candidate === '*' || candidate.replace(/^W\//, '') === tag.slice(2);
    });
  }
  return Math.floor(modified / 1000) <= Math.floor(Date.parse(headers['if-modified-since']) / 1000);
}

export function createStaticHandler(directory) {
  const root = resolve(directory);
  const cache = new Map();

  // Share the first compression across concurrent clients. Only small text assets enter this cache.
  function compressed(filename, tag, encoding) {
    const cacheKey = `${filename}:${encoding}`;
    let entry = cache.get(cacheKey);
    cache.delete(cacheKey);
    if (entry?.tag !== tag) {
      const data = readFile(filename).then(bytes => encoding === 'br'
        ? compressBrotli(bytes, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } })
        : compressGzip(bytes, { level: 4 }));
      entry = { tag, data };
      data.catch(() => { if (cache.get(cacheKey) === entry) cache.delete(cacheKey); });
    }
    cache.set(cacheKey, entry);
    if (cache.size > 96) cache.delete(cache.keys().next().value);
    return entry.data;
  }

  return async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw error(405, 'Method not allowed.');
    let relative;
    try { relative = decodeURIComponent(pathname).replace(/^\/+/, ''); }
    catch { throw error(400, 'Invalid file path.'); }
    const filename = resolve(root, relative || 'index.html');
    if (!filename.startsWith(root + sep) || filename.includes('\0')) throw error(404, 'File not found.');
    const info = await stat(filename).catch(cause => {
      if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR') return null;
      throw cause;
    });
    if (!info?.isFile()) throw error(404, 'File not found.');
    const extension = extname(filename).toLowerCase();
    const canCompress = compressible.has(extension) && info.size >= 1024 && info.size <= 512 * 1024;
    const encoding = selectEncoding(req.headers['accept-encoding'], canCompress);
    const tag = 'W/"' + [info.size, info.mtimeMs, info.ctimeMs].map(n => n.toString(36)).join('-') + '-' + encoding + '"';
    const headers = {
      'Content-Type': types.get(extension) ?? 'application/octet-stream',
      'Cache-Control': 'no-cache', 'Last-Modified': info.mtime.toUTCString(), ETag: tag,
      ...(canCompress && { Vary: 'Accept-Encoding' }),
      ...(encoding !== 'identity' && { 'Content-Encoding': encoding }),
    };
    if (isFresh(req.headers, tag, info.mtimeMs)) {
      res.writeHead(304, headers);
      return res.end();
    }
    if (encoding === 'identity') headers['Content-Length'] = info.size;
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      return res.end();
    }
    if (encoding !== 'identity') {
      const data = await compressed(filename, tag, encoding);
      res.writeHead(200, { ...headers, 'Content-Length': data.length });
      return res.end(data);
    }
    res.writeHead(200, headers);
    const input = createReadStream(filename);
    res.once('close', () => input.destroy());
    input.on('error', () => res.destroy()).pipe(res);
  };
}
