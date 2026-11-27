import { createMediaLibrary, httpsUrl, WIKIMEDIA_HOSTS } from './media-library.mjs';

export const BROWSER_MEDIA_FALLBACK = '浏览器直连开源图库受限，建议双击「启动V4共演.cmd」使用本地多源搜图，或切换声明式示意图。';

function allowUrl(value) {
  const url = httpsUrl(value);
  return url && WIKIMEDIA_HOSTS.has(url.hostname) ? url : null;
}

function encodeImage({ mime, bytes }, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.onabort = () => reject(signal?.reason ?? new Error('已取消配图。'));
    reader.onloadend = () => signal?.removeEventListener('abort', abort);
    signal?.addEventListener('abort', abort, { once: true });
    reader.readAsDataURL(new Blob([bytes], { type: mime }));
  });
}

const browserFetch = (url, options) => fetch(url, options);
const productionLibrary = createMediaLibrary({ fetchImpl: browserFetch, allowUrl, encodeImage });
const libraryFor = ({ fetchImpl, sleep }) => fetchImpl
  ? createMediaLibrary({ fetchImpl, sleep, allowUrl, encodeImage }) : productionLibrary;

export function searchEmbeddedMedia(query, options = {}) {
  return libraryFor(options).searchEmbedded(query, options);
}

export function createBrowserMediaSearch(options = {}) {
  const library = libraryFor(options);
  let searchId = 0;
  let cache = new Map();
  return async function searchMedia(input = {}, { signal, verify } = {}) {
    verify?.(input);
    const { action, query, candidate } = input;
    if (action === 'embed') {
      const entry = cache.get(candidate?.id);
      const result = entry?.expiresAt > Date.now() ? { image: entry.image }
        : { image: null, message: '这张候选图片已失效，请重新搜索。' };
      verify?.(result);
      return result;
    }
    if (action !== 'search' || typeof query !== 'string' || !query.trim() || query.length > 180) {
      throw new Error('请输入 1–180 字的配图检索词。');
    }
    const revision = ++searchId;
    const { candidates, diagnostics } = await library.searchEmbedded(query, { signal, limit: 4 });
    const entries = new Map();
    const expiresAt = Date.now() + 5 * 60_000;
    const previews = candidates.map(({ title, description, width, height, image }, index) => {
      const id = `${revision}:${index}`;
      entries.set(id, { image, expiresAt });
      const { src: preview, ...attribution } = image;
      return { id, title, description, width, height, preview, ...attribution };
    });
    const networkBlocked = Object.values(diagnostics).some(({ status }) => status === 'network_blocked');
    const rateLimited = Object.values(diagnostics).some(({ status }) => status === 'rate_limited');
    const message = previews.length ? undefined : networkBlocked ? BROWSER_MEDIA_FALLBACK : rateLimited
      ? '开源图库请求暂时受限，请稍后重试或切换声明式示意图。'
      : '未找到可内嵌的开源图片，可以调整关键词或使用声明式示意图。';
    const result = { candidates: previews, diagnostics, ...(message && { message }) };
    verify?.(result);
    if (revision === searchId) cache = entries;
    return result;
  };
}

export async function searchAndEmbedMedia(query, options = {}) {
  try { return await libraryFor(options).selectAndEmbed(query, options); }
  catch { return null; }
}
