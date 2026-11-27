import { allowReferenceUrl, createReferenceLookup } from './dist/core/reference-library.mjs';
import { createPinnedHttpsFetch } from './public-https.mjs';

export const lookupReference = createReferenceLookup({
  fetchImpl: createPinnedHttpsFetch(allowReferenceUrl),
  headers: { 'User-Agent': 'Polyphony-Classroom/4.0 (classroom reference lookup)' },
  unavailableReason: '暂时无法连接参考资料来源，请检查本地网络。',
});
