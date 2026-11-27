import { createPinnedHttpsFetch, isPublicAddress } from './public-https.mjs';
import { createMediaLibrary, httpsUrl, WIKIMEDIA_HOSTS } from './dist/core/media-library.mjs';

const HOSTS = new Set([
  ...WIKIMEDIA_HOSTS, 'api.openverse.org',
  // Exact public image origins from established Openverse collection providers.
  'live.staticflickr.com', 'c1.staticflickr.com', 'c2.staticflickr.com',
  ...Array.from({ length: 9 }, (_, index) => `farm${index + 1}.staticflickr.com`),
  'ids.si.edu', 'images.metmuseum.org', 'cdn.loc.gov', 'tile.loc.gov',
  'images-assets.nasa.gov', 'images.nasa.gov', 'science.nasa.gov', 'svs.gsfc.nasa.gov',
  'cdn.esahubble.org', 'cdn.eso.org',
]);
const HEADERS = { 'User-Agent': 'Polyphony-Classroom/4.0 (open-licensed classroom image lookup)' };

function allowedMediaHost(hostname) {
  if (typeof hostname !== 'string') return false;
  const host = hostname.toLowerCase();
  if (!HOSTS.has(host)) return false;
  const allowed = process.env.POLYPHONY_MEDIA_SEARCH_ALLOWLIST?.trim().toLowerCase();
  return !allowed || allowed.split(/[,\s]+/u).includes(host);
}

function safeUrl(value) {
  const url = httpsUrl(value);
  return url && allowedMediaHost(url.hostname) ? url : null;
}

export function isPublicMediaAddress(address, hostname) {
  if (hostname === undefined) return isPublicAddress(address);
  return allowedMediaHost(hostname) && isPublicAddress(address, true);
}

function createServerLibrary(fetchImpl, sleep) {
  return createMediaLibrary({
    fetchImpl, sleep, allowUrl: safeUrl, useOpenverse: true, requestHeaders: HEADERS,
    encodeImage: ({ mime, bytes }) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
  });
}

const productionLibrary = createServerLibrary(createPinnedHttpsFetch(safeUrl));
const injectedLibraries = new WeakMap();
function mediaLibrary({ fetchImpl, sleep }) {
  if (!fetchImpl) return productionLibrary;
  let library = injectedLibraries.get(fetchImpl);
  if (!library || library.sleep !== sleep) {
    library = { sleep, client: createServerLibrary(fetchImpl, sleep) };
    injectedLibraries.set(fetchImpl, library);
  }
  return library.client;
}

export function searchMediaCandidates(query, options = {}) {
  return mediaLibrary(options).search(query, options);
}

export function searchEmbeddedMedia(query, options = {}) {
  return mediaLibrary(options).searchEmbedded(query, options);
}

export async function fetchSafeEmbeddedImage(candidate, options = {}) {
  try { return await mediaLibrary(options).download(candidate, options.signal); }
  catch { return null; }
}

export async function searchAndEmbedMedia(query, options = {}) {
  try { return await mediaLibrary(options).selectAndEmbed(query, options); }
  catch { return null; }
}
