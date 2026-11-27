import { httpsUrl, pause, plainText, readBounded, retryDelay } from './media-library.mjs';

const WIKI_HOSTS = new Set(['en.wikipedia.org', 'zh.wikipedia.org']);
const SUMMARY_PATH = '/api/rest_v1/page/summary/';
const OPENALEX = 'https://api.openalex.org';
const MAX_JSON_BYTES = 384 * 1024;
const TIMEOUT_MS = 5000;
const MIN_INTERVAL_MS = 400;
const MAX_IN_FLIGHT = 3;
const RETRY_COOLDOWN_MS = 5000;

export function allowReferenceUrl(value) {
  const url = httpsUrl(value);
  if (!url) return null;
  if (WIKI_HOSTS.has(url.hostname) &&
      (url.pathname.startsWith(SUMMARY_PATH) || url.pathname === '/w/api.php')) return url;
  return url.origin === OPENALEX && url.pathname === '/works' ? url : null;
}

const issue = (status, httpStatus) => Object.assign(new Error(status), { status, httpStatus });

function cleanText(value, limit) {
  if (typeof value !== 'string') return '';
  return plainText(value.slice(0, 8192).replace(/<(script|style)(?:\s[^>]*)?>[\s\S]*?(?:<\/\1\s*>|$)/giu, ' '), limit)
    .replace(/[\ud800-\udbff]$/u, '').trimEnd();
}

async function untilAborted(work, signal) {
  let abort;
  const stopped = new Promise((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try { return await Promise.race([work, stopped]); }
  finally { signal.removeEventListener('abort', abort); }
}

async function requestJson(url, signal, fetchImpl, headers, state) {
  const response = await fetchImpl(url, {
    method: 'GET', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer',
    signal, headers: { ...headers, Accept: 'application/json' },
  });
  const discard = () => { void response.body?.cancel().catch(() => {}); };
  if (signal.aborted) {
    discard();
    signal.throwIfAborted();
  }
  if (response.status === 429) {
    discard();
    state.cooldown = performance.now() + Math.max(RETRY_COOLDOWN_MS, retryDelay(response.headers.get('retry-after'), 0));
    throw issue('rate_limited', 429);
  }
  if (!response.ok) {
    discard();
    throw issue(response.status === 404 ? 'no_hits' : 'upstream_error', response.status);
  }
  if (response.redirected || (response.url && response.url !== url.href) || !response.body ||
      !/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '') ||
      Number(response.headers.get('content-length')) > MAX_JSON_BYTES) {
    discard();
    throw issue('unsafe_response');
  }
  return JSON.parse(new TextDecoder().decode(await readBounded(response, MAX_JSON_BYTES, signal)));
}

function createRequester(fetchImpl, headers) {
  const hosts = new Map();
  return async function get(url, signal) {
    signal.throwIfAborted();
    if (!allowReferenceUrl(url.href)) throw issue('network_blocked');
    if (!hosts.has(url.hostname)) hosts.set(url.hostname, { active: 0, next: 0, cooldown: 0 });
    const state = hosts.get(url.hostname);
    const now = performance.now();
    const ready = Math.max(now, state.next);
    if (state.active >= MAX_IN_FLIGHT || state.cooldown > now || ready - now > MAX_IN_FLIGHT * MIN_INTERVAL_MS) {
      throw issue('rate_limited');
    }
    state.next = ready + MIN_INTERVAL_MS;
    state.active++;
    try {
      if (ready > now) await pause(Math.ceil(ready - now), signal);
      if (state.cooldown > performance.now()) throw issue('rate_limited');
      signal.throwIfAborted();
      return await untilAborted(requestJson(url, signal, fetchImpl, headers, state), signal);
    } finally {
      state.active--;
    }
  };
}

const articleSlug = title => encodeURIComponent(title.toWellFormed().replace(/\s+/gu, '_'));

async function wikipedia(term, lang, get, signal) {
  const origin = `https://${lang}.wikipedia.org`;
  const summary = title => get(new URL(origin + SUMMARY_PATH + articleSlug(title)), signal);
  let article;
  try { article = await summary(term); }
  catch (error) {
    if (!(error instanceof TypeError) && ![301, 302, 303, 307, 308, 404].includes(error?.httpStatus)) throw error;
  }
  if (!article?.extract || article.type === 'disambiguation') {
    const url = new URL('/w/api.php', origin);
    url.search = new URLSearchParams({
      action: 'query', list: 'search', srsearch: term, srnamespace: '0', srlimit: '1', format: 'json', origin: '*',
    });
    const title = cleanText((await get(url, signal))?.query?.search?.[0]?.title, 180);
    if (!title || title === '.' || title === '..') return [];
    article = await summary(title);
  }
  const title = cleanText(article?.title, 180);
  const extract = cleanText(article?.extract, 600);
  if (!title || title === '.' || title === '..' || !extract || article.type === 'disambiguation') return [];
  const canonical = httpsUrl(article.content_urls?.desktop?.page);
  const sourceUrl = canonical?.origin === origin && canonical.pathname.startsWith('/wiki/')
    ? canonical.href : `${origin}/wiki/${articleSlug(title)}`;
  return [{ source: 'Wikipedia', title, summary: extract, sourceUrl }];
}

function abstractText(index) {
  if (!index || typeof index !== 'object' || Array.isArray(index)) return '';
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      if (Number.isInteger(position) && position >= 0 && position < 600) words[position] = word;
    }
  }
  return cleanText(words.join(' '), 600);
}

async function openalex(term, get, signal) {
  const url = new URL('/works', OPENALEX);
  url.search = new URLSearchParams({ search: term, 'per-page': '3', select: 'id,display_name,publication_year,abstract_inverted_index' });
  const payload = await get(url, signal);
  if (!Array.isArray(payload?.results)) return [];
  return payload.results.slice(0, 3).flatMap(work => {
    const title = cleanText(work?.display_name ?? work?.title, 180);
    const sourceUrl = work?.id;
    if (!title || typeof sourceUrl !== 'string' || !/^https:\/\/openalex\.org\/W\d{1,24}$/u.test(sourceUrl)) return [];
    const publicationYear = work.publication_year;
    return [{
      source: 'OpenAlex', title, sourceUrl,
      summary: abstractText(work.abstract_inverted_index) || '该索引条目未提供摘要。',
      ...(Number.isInteger(publicationYear) && { publicationYear }),
    }];
  });
}

export function createReferenceLookup({ fetchImpl: systemFetch, headers, unavailableReason }) {
  const requesters = new WeakMap();
  return async function lookupReference(query, { lang, signal, fetchImpl = systemFetch } = {}) {
    signal?.throwIfAborted();
    const term = typeof query === 'string' && query.length <= 180 ? cleanText(query, 180) : '';
    if (!term || term === '.' || term === '..') return { ok: false, reason: '请输入 1–180 字的参考资料检索词。' };
    const language = lang ?? (/\p{Script=Han}/u.test(term) ? 'zh' : 'en');
    if (language !== 'en' && language !== 'zh') return { ok: false, reason: '参考资料语言须为 zh 或 en。' };
    if (!requesters.has(fetchImpl)) requesters.set(fetchImpl, createRequester(fetchImpl, headers));
    const get = requesters.get(fetchImpl);
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
    let results;
    try {
      results = await Promise.allSettled([wikipedia(term, language, get, requestSignal), openalex(term, get, requestSignal)]);
    } finally {
      clearTimeout(timer);
    }
    signal?.throwIfAborted();
    const references = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    if (references.length) return { ok: true, references };
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason?.status);
    if (deadline.signal.aborted) return { ok: false, reason: '参考资料查询超时。' };
    if (failures.includes('rate_limited')) return { ok: false, reason: '参考资料来源暂时限流，请稍后再试。' };
    if (failures.some(status => status !== 'no_hits')) return { ok: false, reason: unavailableReason };
    return { ok: false, reason: '未找到相关参考资料。' };
  };
}
