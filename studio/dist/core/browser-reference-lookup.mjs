import { createReferenceLookup } from './reference-library.mjs';

const lookup = createReferenceLookup({
  fetchImpl: (url, options) => fetch(url, options),
  unavailableReason: '浏览器直连参考资料受限，建议启动本地服务。',
});

export async function lookupReference(query, options = {}) {
  options.signal?.throwIfAborted();
  if (!options.fetchImpl && globalThis.navigator?.onLine === false) {
    return { ok: false, reason: '设备离线，暂时无法查证参考资料。' };
  }
  return lookup(query, options);
}
