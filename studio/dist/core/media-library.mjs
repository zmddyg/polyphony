const COMMONS = 'https://commons.wikimedia.org';
const OPENVERSE = 'https://api.openverse.org';
export const WIKIMEDIA_HOSTS = new Set([
  'commons.wikimedia.org', 'upload.wikimedia.org', 'thumb.wikimedia.org', 'en.wikipedia.org', 'zh.wikipedia.org',
]);
const WIKI_IMAGE_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const JSON_TYPE = new Set(['application/json', 'application/problem+json']);
const MAX_IMAGE_BYTES = 1_500_000;
const MAX_METADATA_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 6000;
const MIN_INTERVAL_MS = 250;
const MAX_RETRY_WAIT_MS = 3000;
const SOURCE_NAMES = { commons: 'Wikimedia Commons', wikipedia: 'Wikipedia', openverse: 'Openverse' };
const MIME_BY_EXTENSION = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

export function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || !/^https:\/\/[^/?#@]+(?:[/?#]|$)/iu.test(value) ||
      /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash ? url : null;
  } catch { return null; }
}

const ENTITIES = Object.freeze({ amp: '&', quot: '"', apos: "'", nbsp: ' ', lt: '<', gt: '>' });
export function plainText(value, limit) {
  return String(value ?? '').slice(0, 8192)
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (_, entity) => {
      if (entity[0] !== '#') return Object.hasOwn(ENTITIES, entity.toLowerCase()) ? ENTITIES[entity.toLowerCase()] : ' ';
      const hex = entity[1].toLowerCase() === 'x';
      const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : ' ';
    })
    .replace(/[<>\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, ' ')
    .replace(/\s+/gu, ' ').trim().slice(0, limit).trim();
}

function openLicense(value) {
  const license = plainText(value, 80);
  if (/^(?:public domain(?: mark 1\.0)?|pdm 1\.0|pd)$/iu.test(license)) return 'Public domain';
  if (/^cc0(?: 1\.0)?$/iu.test(license)) return 'CC0 1.0';
  const match = /^cc by(-sa)? (1\.0|2\.0|2\.5|3\.0|4\.0)(?: ([a-z]{2}))?$/iu.exec(license);
  if (!match) return null;
  return `CC BY${(match[1] ?? '').toUpperCase()} ${match[2]}${match[3] ? ` ${match[3].toUpperCase()}` : ''}`;
}

function matchesLicenseUrl(license, value) {
  if (!value || license === 'Public domain') return true;
  try {
    const url = new URL(value);
    const [kind, version, region] = license.toLowerCase().replace(/^cc /u, '').split(' ');
    const policy = kind === 'cc0' ? '/publicdomain/zero' : `/licenses/${kind}`;
    const path = `${policy}/${version}${region ? `/${region}` : ''}`;
    return ['http:', 'https:'].includes(url.protocol) && url.host === 'creativecommons.org' &&
      !url.username && !url.password && (url.pathname === path || url.pathname.startsWith(`${path}/`));
  } catch { return false; }
}

function withSource(artist, sourceUrl, source) {
  const label = sourceUrl && sourceUrl.length <= 112 ? sourceUrl : SOURCE_NAMES[source] ?? '开源图库';
  return artist ? `${plainText(artist, 157 - label.length)} · ${label}` : label;
}

const acceptableDimensions = (width, height) => Number.isSafeInteger(width) && Number.isSafeInteger(height) &&
  width > 0 && height > 0 && width <= 4096 && height <= 4096 && width * height <= 8_000_000;

const issue = (status, httpStatus) => Object.assign(new Error(status), { status, httpStatus });

export function pause(ms, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function retryDelay(value, retry) {
  const elapsed = /^\d+$/u.test(value ?? '') ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Math.max(500 * 2 ** retry, Number.isFinite(elapsed) ? elapsed : 0);
}

export async function readBounded(response, maxBytes, signal) {
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw issue('unsafe_response');
      chunks.push(value);
    }
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function createRequester({ fetchImpl, requestHeaders, sleep = pause }) {
  const queues = new Map();
  return function get(url, allowedTypes, maxBytes, signal) {
    if (!url) return Promise.reject(issue('network_blocked'));
    const host = url.hostname;
    let state = queues.get(host);
    if (!state) {
      state = { tail: Promise.resolve(), next: 0, throttledUntil: 0 };
      queues.set(host, state);
    }
    const run = state.tail.then(async () => {
      signal?.throwIfAborted();
      for (let attempt = 0; attempt < 3; attempt++) {
        const wait = Math.max(state.next, state.throttledUntil) - performance.now();
        if (wait > MAX_RETRY_WAIT_MS) throw issue('rate_limited', 429);
        if (wait > 0) await sleep(Math.ceil(wait), signal);
        const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
        requestSignal.throwIfAborted();
        state.next = performance.now() + MIN_INTERVAL_MS;
        const response = await fetchImpl(url, {
          method: 'GET', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
          signal: requestSignal, headers: { ...requestHeaders, Accept: [...allowedTypes].join(', ') },
        });
        if (response.status === 429) {
          void response.body?.cancel().catch(() => {});
          state.throttledUntil = performance.now() + retryDelay(response.headers.get('retry-after'), attempt);
          if (attempt === 2) throw issue('rate_limited', 429);
          continue;
        }
        const mime = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
        if (!response.ok || response.redirected || (response.url && response.url !== url.href) ||
            !response.body || !allowedTypes.has(mime) || Number(response.headers.get('content-length')) > maxBytes) {
          void response.body?.cancel().catch(() => {});
          if (!response.ok) {
            throw issue(response.status === 404 ? 'no_hits' : 'upstream_error', response.status);
          }
          throw issue('unsafe_response');
        }
        return { mime, bytes: await readBounded(response, maxBytes, requestSignal) };
      }
    });
    state.tail = run.catch(() => {});
    return run;
  };
}

const scientificTerms = [
  [/双缝干涉/gu, 'double slit interference'], [/单缝衍射/gu, 'single slit diffraction'],
  [/多缝衍射|衍射光栅/gu, 'diffraction grating'], [/物理光学/gu, 'physical optics'],
  [/迈克耳孙干涉仪|迈克尔逊干涉仪/gu, 'Michelson interferometer'], [/牛顿环/gu, 'Newton rings'],
  [/偏振片/gu, 'polarizing filter'], [/琼斯矩阵/gu, 'Jones calculus'],
  [/电光调制|电光效应/gu, 'electro-optic modulation'], [/光电探测器/gu, 'photodetector'],
  [/光纤通信/gu, 'fiber optic communication'], [/傅里叶变换/gu, 'Fourier transform'],
  [/驻波/gu, 'standing wave'], [/衍射/gu, 'diffraction'], [/干涉/gu, 'interference'],
  [/偏振/gu, 'polarization'], [/折射/gu, 'refraction'], [/透镜/gu, 'lens'],
  [/光谱/gu, 'spectrum'], [/光纤/gu, 'optical fiber'], [/激光/gu, 'laser'],
  [/显微镜/gu, 'microscope'], [/正态分布/gu, 'normal distribution'],
  [/电磁波/gu, 'electromagnetic wave'], [/欧姆定律/gu, "Ohm's law"],
  [/半导体/gu, 'semiconductor'], [/晶体管/gu, 'transistor'], [/太阳能电池/gu, 'solar cell'],
  [/光合作用/gu, 'photosynthesis'], [/细胞/gu, 'cell microscopy'],
  [/指针/gu, 'pointer programming'], [/二叉树/gu, 'binary tree'],
];

function reformulatedTerm(term) {
  let translated = term;
  for (const [pattern, english] of scientificTerms) translated = translated.replace(pattern, ` ${english} `);
  if (translated !== term) return plainText(translated.replace(/[\p{Script=Han}·：，。；、（）]+/gu, ' '), 180);
  const compact = plainText(term.replace(
    /实验装置|原理示意图|示意图|高清照片|实物图片|[“”"「」]|\b(?:schematic|diagram|illustration|high[ -]resolution|photo(?:graph)?)\b/giu, ' '
  ), 180);
  if (compact && compact !== term) return compact;
  const words = term.split(/\s+/u);
  return words.length >= 3 ? words.slice(0, -1).join(' ') : '';
}

function commonsUrl(parameters) {
  const url = new URL(`${COMMONS}/w/api.php`);
  url.search = new URLSearchParams({
    action: 'query', prop: 'imageinfo', iiurlwidth: '960',
    iiprop: 'url|mime|thumbmime|size|extmetadata', iiextmetadatalanguage: 'en',
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Attribution|Credit|ImageDescription',
    format: 'json', formatversion: '2', origin: '*', ...parameters,
  }).toString();
  return url.href;
}

function commonsCandidate(page, allowUrl) {
  if (typeof page?.title !== 'string' || !page.title.startsWith('File:') || (page.ns !== undefined && page.ns !== 6)) return null;
  if (/\.(?:pdf|djvu|tiff?|ogg|ogv|oga|webm|mp4|mp3|wav|flac|stl|mid)$/iu.test(page.title) || /\(IA\s+[a-z0-9_.-]+\)/iu.test(page.title)) return null;
  const info = page.imageinfo?.[0];
  if (!info) return null;
  const sourceMime = typeof info.mime === 'string' ? info.mime.toLowerCase() : '';
  if (sourceMime && !IMAGE_TYPES.has(sourceMime) && sourceMime !== 'image/svg+xml') return null;
  const url = allowUrl(info.thumburl ?? info.url);
  const extension = url?.pathname.match(/\.([a-z]+)$/iu)?.[1].toLowerCase();
  const mime = info.thumbmime ?? MIME_BY_EXTENSION[extension] ?? info.mime;
  const width = info.thumbwidth ?? info.width;
  const height = info.thumbheight ?? info.height;
  const license = openLicense(info.extmetadata?.LicenseShortName?.value);
  if (!url || !WIKI_IMAGE_HOSTS.has(url.hostname) || !IMAGE_TYPES.has(mime) || !acceptableDimensions(width, height) ||
      !license || !matchesLicenseUrl(license, info.extmetadata?.LicenseUrl?.value)) return null;
  const title = plainText(page.title.slice(5).replaceAll('_', ' '), 135);
  const description = plainText(info.extmetadata?.ImageDescription?.value, 320);
  const artist = info.extmetadata?.Attribution?.value || info.extmetadata?.Artist?.value || info.extmetadata?.Credit?.value;
  const source = 'commons';
  const sourceUrl = Number.isSafeInteger(page.pageid) && page.pageid > 0 ? `${COMMONS}/?curid=${page.pageid}` :
    `${COMMONS}/wiki/File:${encodeURIComponent(page.title.slice(5).replaceAll(' ', '_'))}`;
  return {
    id: `commons:${page.pageid ?? page.title}`, title, description, alt: title || description.slice(0, 135) || '图库配图',
    credit: withSource(artist, sourceUrl, source), source, license, sourceUrl, thumbnailUrl: url.href, mime, width, height,
  };
}

function commonsFileTitle(value, allowUrl) {
  const url = allowUrl(value);
  if (!url || !WIKI_IMAGE_HOSTS.has(url.hostname)) return null;
  const file = /\/commons\/(?:thumb\/)?[\da-f]\/[\da-f]{2}\/([^/]+)(?:\/|$)/iu.exec(url.pathname)?.[1];
  if (!file) return null;
  try {
    const title = decodeURIComponent(file);
    return /[|#\u0000-\u001f]/u.test(title) ? null : 'File:' + title;
  } catch { return null; }
}

function openverseCandidate(entry, allowUrl) {
  if (!entry || entry.mature || typeof entry.id !== 'string') return null;
  const license = openLicense(['by', 'by-sa'].includes(entry.license) ? `CC ${entry.license} ${entry.license_version}` : entry.license);
  if (!license || !matchesLicenseUrl(license, entry.license_url)) return null;
  const source = 'openverse';
  const thumbnail = allowUrl(entry.thumbnail);
  const thumbnailPath = `/v1/images/${entry.id}/thumb/`;
  const proxy = thumbnail?.origin === OPENVERSE &&
    /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(entry.id) &&
    thumbnail.pathname === thumbnailPath && !thumbnail.search ? thumbnail.href : null;
  const original = allowUrl(entry.url);
  const direct = original && ![OPENVERSE, COMMONS].includes(original.origin) && !original.hostname.endsWith('.wikipedia.org') &&
    (!Number.isFinite(entry.filesize) || entry.filesize <= MAX_IMAGE_BYTES) ? original.href : null;
  if (!proxy && !direct) return null;
  const width = Number(entry.width), height = Number(entry.height);
  if (!proxy && !acceptableDimensions(width, height)) return null;
  const title = plainText(entry.title, 135);
  const sourceUrl = httpsUrl(entry.foreign_landing_url)?.href ?? `https://openverse.org/image/${encodeURIComponent(entry.id)}`;
  return {
    id: `openverse:${entry.id}`, title, description: plainText(entry.attribution, 320), alt: title || '图库配图',
    credit: withSource(entry.creator, sourceUrl, source), source, license, sourceUrl, thumbnailUrl: proxy ?? direct,
    ...(proxy && direct && { fallbackUrl: direct }), ...(!proxy && { mime: MIME_BY_EXTENSION[entry.filetype] }), width, height,
  };
}

const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
function jpegDimensions(bytes, view) {
  if (bytes.length < 12 || view.getUint16(0) !== 0xffd8 || view.getUint16(bytes.length - 2) !== 0xffd9) return [];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) return [];
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) return [];
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const size = view.getUint16(offset);
    if (size < 2 || offset + size > bytes.length) return [];
    if (JPEG_FRAME_MARKERS.has(marker)) return size >= 8 ? [view.getUint16(offset + 5), view.getUint16(offset + 3)] : [];
    offset += size;
  }
  return [];
}

const textAt = (bytes, offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
const uint24LE = (bytes, offset) => bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;

function webpDimensions(bytes, view) {
  if (bytes.length < 25 || textAt(bytes, 0, 4) !== 'RIFF' || view.getUint32(4, true) + 8 !== bytes.length ||
      textAt(bytes, 8, 4) !== 'WEBP') return [];
  const chunk = textAt(bytes, 12, 4);
  if (chunk === 'VP8X' && bytes.length >= 30) return [uint24LE(bytes, 24) + 1, uint24LE(bytes, 27) + 1];
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const size = view.getUint32(21, true);
    return [(size & 0x3fff) + 1, ((size >>> 14) & 0x3fff) + 1];
  }
  if (chunk === 'VP8 ' && bytes.length >= 30 && uint24LE(bytes, 23) === 0x2a019d) {
    return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff];
  }
  return [];
}

function imageDimensions(bytes, mime) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/jpeg') return jpegDimensions(bytes, view);
  if (mime === 'image/webp') return webpDimensions(bytes, view);
  if (mime === 'image/png' && bytes.length >= 45 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a &&
      view.getUint32(8) === 13 && textAt(bytes, 12, 4) === 'IHDR' && view.getUint32(bytes.length - 12) === 0 &&
      textAt(bytes, bytes.length - 8, 4) === 'IEND' && view.getUint32(bytes.length - 4) === 0xae426082) {
    return [view.getUint32(16), view.getUint32(20)];
  }
  if (mime === 'image/gif' && bytes.length >= 14 && /^GIF8[79]a$/u.test(textAt(bytes, 0, 6)) && bytes.at(-1) === 0x3b) {
    return [view.getUint16(6, true), view.getUint16(8, true)];
  }
  return [];
}

function score(candidate) {
  const { width, height } = candidate;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return -3;
  return Math.min(width * height / (960 * 540), 1) - Math.abs(Math.log((width / height) / (16 / 9)));
}

const failureStatus = error => error?.status ?? 'network_blocked';
const countLimit = limit => Number.isInteger(limit) ? Math.max(0, Math.min(12, limit)) : 4;
const jsonPages = result => Object.values(result?.query?.pages ?? {}).slice(0, 24);

export function createMediaLibrary({ fetchImpl, allowUrl, encodeImage, useOpenverse = false, requestHeaders, sleep }) {
  const get = createRequester({ fetchImpl, requestHeaders, sleep });
  async function json(url, signal) {
    const { bytes } = await get(allowUrl(url), JSON_TYPE, MAX_METADATA_BYTES, signal);
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw issue('unsafe_response'); }
  }

  async function commons(term, count, signal) {
    const query = /\bfiletype:/iu.test(term) ? term : `${term} filetype:bitmap|drawing`;
    const result = await json(commonsUrl({
      generator: 'search', gsrnamespace: '6', gsrsearch: query, gsrlimit: String(Math.min(24, count * 3)),
    }), signal);
    if (result?.error) throw issue('upstream_error');
    return jsonPages(result).map(page => commonsCandidate(page, allowUrl)).filter(Boolean);
  }

  async function wikipedia(term, _count, signal) {
    const host = /\p{Script=Han}/u.test(term) ? 'zh.wikipedia.org' : 'en.wikipedia.org';
    const summary = title => json(`https://${host}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/gu, '_'))}`, signal);
    let article;
    try {
      article = await summary(term);
    } catch (error) {
      if (![301, 302, 404].includes(error?.httpStatus) && !(error instanceof TypeError)) throw error;
      const url = new URL(`https://${host}/w/api.php`);
      url.search = new URLSearchParams({
        action: 'query', list: 'search', srsearch: term, srnamespace: '0', srlimit: '1', format: 'json', origin: '*',
      }).toString();
      const title = (await json(url.href, signal))?.query?.search?.[0]?.title;
      if (typeof title !== 'string' || !title) return [];
      article = await summary(title);
    }
    // The article license does not apply to its images. Use only a licensed Commons file.
    const file = commonsFileTitle(article?.originalimage?.source, allowUrl) ?? commonsFileTitle(article?.thumbnail?.source, allowUrl);
    if (!file) return [];
    const [page] = jsonPages(await json(commonsUrl({ titles: file, redirects: '1' }), signal));
    const result = commonsCandidate(page, allowUrl);
    if (!result) return [];
    const title = plainText(article.title, 135);
    return [{ ...result, id: 'wikipedia:' + result.id, source: 'wikipedia', title: title || result.title,
      description: plainText(article.description, 320) || result.description }];
  }

  async function openverse(term, _count, signal) {
    const url = new URL(`${OPENVERSE}/v1/images/`);
    url.search = new URLSearchParams({ q: term, license_type: 'commercial,modification', page_size: '6' }).toString();
    const result = await json(url.href, signal);
    return Array.isArray(result?.results) ? result.results.slice(0, 6).map(entry => openverseCandidate(entry, allowUrl)).filter(Boolean) : [];
  }

  const sources = { commons, wikipedia, ...(useOpenverse && { openverse }) };
  async function search(query, { limit = 4, signal } = {}) {
    const term = typeof query === 'string' ? plainText(query, 180) : '';
    const count = countLimit(limit);
    const diagnostics = Object.fromEntries(Object.keys(sources).map(source => [source, { status: 'no_hits', attempts: [] }]));
    if (!term || !count) return { candidates: [], diagnostics };
    async function attempt(keyword) {
      const groups = await Promise.all(Object.entries(sources).map(async ([source, lookup]) => {
        let matches = [], status;
        try {
          matches = await lookup(keyword, count, signal);
          status = matches.length ? 'ok' : 'no_hits';
        } catch (error) {
          signal?.throwIfAborted();
          status = failureStatus(error);
        }
        const diagnostic = diagnostics[source];
        if (status !== 'no_hits' || diagnostic.status === 'no_hits') diagnostic.status = status;
        diagnostic.attempts.push({ query: keyword, status, count: matches.length });
        return matches;
      }));
      return groups.flat();
    }
    signal?.throwIfAborted();
    let candidates = await attempt(term);
    const alternate = reformulatedTerm(term);
    if (!candidates.length && alternate && alternate !== term) candidates = await attempt(alternate);
    const unique = new Map();
    for (const candidate of candidates) {
      if (!unique.has(candidate.thumbnailUrl)) unique.set(candidate.thumbnailUrl, candidate);
    }
    return { candidates: [...unique.values()].sort((a, b) => score(b) - score(a)).slice(0, count), diagnostics };
  }

  async function download(candidate, signal) {
    const license = openLicense(candidate?.license);
    if (!license) throw issue('unsafe_response');
    let lastError;
    for (const value of [candidate.thumbnailUrl ?? candidate.url, candidate.fallbackUrl].filter(Boolean)) {
      const url = allowUrl(value);
      if (!url) throw issue('unsafe_response');
      try {
        const image = await get(url, IMAGE_TYPES, MAX_IMAGE_BYTES, signal);
        if ((candidate.mime && candidate.mime !== image.mime) ||
            !acceptableDimensions(...imageDimensions(image.bytes, image.mime))) throw issue('unsafe_response');
        const source = Object.hasOwn(SOURCE_NAMES, candidate.source) ? candidate.source : 'commons';
        const sourceUrl = httpsUrl(candidate.sourceUrl)?.href;
        return {
          src: await encodeImage(image, signal), alt: plainText(candidate.alt || candidate.title, 160) || '图库配图',
          credit: plainText(candidate.credit, 160) || withSource('', sourceUrl, source), license, source,
          ...(sourceUrl && { sourceUrl: sourceUrl.slice(0, 1024) }),
        };
      } catch (error) {
        signal?.throwIfAborted();
        lastError = error;
      }
    }
    throw lastError ?? issue('unsafe_response');
  }

  async function searchEmbedded(query, { limit = 4, signal } = {}) {
    const count = countLimit(limit);
    const result = await search(query, { limit: Math.min(12, count * 2), signal });
    const candidates = [];
    const failures = {};
    let attempted = 0;
    while (attempted < result.candidates.length && candidates.length < count) {
      const batch = result.candidates.slice(attempted, attempted + count - candidates.length);
      const images = await Promise.all(batch.map(async candidate => {
        try { return { ...candidate, image: await download(candidate, signal) }; }
        catch (error) {
          signal?.throwIfAborted();
          const status = failureStatus(error);
          failures[status] = (failures[status] ?? 0) + 1;
          return null;
        }
      }));
      candidates.push(...images.filter(Boolean));
      attempted += batch.length;
    }
    return { candidates, diagnostics: { ...result.diagnostics, downloads: {
      status: candidates.length ? 'ok' : failures.network_blocked ? 'network_blocked' :
        failures.rate_limited ? 'rate_limited' : attempted ? 'unavailable' : 'no_hits',
      attempted, embedded: candidates.length, failures,
    } } };
  }

  async function selectAndEmbed(query, { selectCandidate, signal, limit } = {}) {
    const { candidates } = await search(query, { signal, limit });
    if (!candidates.length) return null;
    const choice = selectCandidate ? await selectCandidate(structuredClone(candidates)) : 0;
    const selected = Number.isSafeInteger(choice) ? candidates[choice] :
      candidates.find(candidate => candidate.id === (typeof choice === 'string' ? choice : choice?.id));
    if (!selected) return null;
    for (const candidate of [selected, ...candidates.filter(item => item !== selected)]) {
      signal?.throwIfAborted();
      try { return await download(candidate, signal); }
      catch { signal?.throwIfAborted(); }
    }
    return null;
  }

  return { search, download, searchEmbedded, selectAndEmbed };
}
