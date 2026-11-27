import { describeLessonProvider, PROVIDER_CREDENTIALS, rejectProviderSecrets, requestStructuredCompletion } from './lesson-provider.mjs';

const obsoleteStorageKey = 'polyphony.provider.session.v3';
const mainFields = ['baseUrl', 'model', 'key', 'outputMode'];
const fastFields = ['fastBaseUrl', 'fastModel', 'fastKey', 'fastOutputMode'];
const inputFields = [...mainFields, ...fastFields];
const value = input => typeof input === 'string' ? input.trim() || undefined : undefined;
let memory;

function sameProviderOrigin(left, right) {
  try { return new URL(left).origin === new URL(right).origin; } catch { return false; }
}

export function resolveConfiguredFastProvider(provider = {}, explicitFastProvider) {
  const overrides = explicitFastProvider ?? {};
  const model = value(overrides.model) ?? value(provider.fastModel);
  if (!model) return null;
  const previousFastUrl = value(provider.fastBaseUrl) ?? provider.baseUrl;
  const baseUrl = value(overrides.baseUrl) ?? previousFastUrl;
  const key = value(overrides.key) ??
    (sameProviderOrigin(baseUrl, previousFastUrl) ? value(provider.fastKey) : undefined) ??
    (sameProviderOrigin(baseUrl, provider.baseUrl) ? value(provider.key) : undefined);
  const fast = {
    model, baseUrl, key,
    outputMode: value(overrides.outputMode) ?? value(provider.fastOutputMode) ?? value(provider.outputMode) ?? 'json_object',
  };
  const fetchImpl = overrides.fetchImpl ?? provider.fastFetchImpl ?? provider.fetchImpl;
  if (fetchImpl) fast.fetchImpl = fetchImpl;
  if (!describeLessonProvider(fast).configured) return null;
  return {
    ...fast,
    [PROVIDER_CREDENTIALS]: [provider, overrides, { fastModel: model, fastBaseUrl: value(overrides.baseUrl) ?? value(provider.fastBaseUrl) }],
  };
}

export function resolveFastProvider(provider = {}, explicitFastProvider) {
  return resolveConfiguredFastProvider(provider, explicitFastProvider) ?? provider;
}

export function parseProviderInput(input, current = {}) {
  if (input.test !== true && !inputFields.some(field => Object.hasOwn(input, field))) {
    throw new Error('请填写要更新的模型配置。');
  }
  for (const field of inputFields) {
    if (Object.hasOwn(input, field) && (typeof input[field] !== 'string' || input[field].length > 8000)) {
      throw new Error('模型配置字段无效。');
    }
  }
  const primary = Object.fromEntries(mainFields.map(field => [field, value(input[field]) ?? value(current[field])]));
  primary.outputMode ??= 'json_object';
  const optional = Object.fromEntries(fastFields.map(field => [field, value(Object.hasOwn(input, field) ? input[field] : current[field])]));
  if (primary.key && !value(input.key) && !sameProviderOrigin(current.baseUrl, primary.baseUrl)) {
    throw Error('主模型地址已更改，请填写对应的 API Key。');
  }
  if (optional.fastModel && optional.fastKey && !value(input.fastKey) &&
      !sameProviderOrigin(current.fastBaseUrl ?? current.baseUrl, optional.fastBaseUrl ?? primary.baseUrl)) {
    throw Error('快速模型地址已更改，请填写对应的 API Key。');
  }
  const provider = optional.fastModel ? { ...primary, ...optional } : primary;
  const main = describeLessonProvider(primary);
  const hasMainFields = [primary.baseUrl, primary.model, primary.key].some(Boolean);
  if (!main.outputMode || (hasMainFields && !main.configured)) {
    throw new Error('请检查主模型的 Base URL、Model、API Key 和输出模式。');
  }
  const fast = resolveConfiguredFastProvider(provider);
  if (optional.fastModel && !fast) throw new Error('请检查快速模型的地址、名称、密钥和输出模式。');
  const disablingFast = Object.hasOwn(input, 'fastModel') && !optional.fastModel && resolveConfiguredFastProvider(current);
  if (!main.configured && !fast && !disablingFast) throw new Error('请配置主模型或快速决策模型。');
  return provider;
}

function visibleField(field, ...credentials) {
  try { return rejectProviderSecrets(field, ...credentials) ?? null; } catch { return null; }
}

export function providerSummary(provider = {}, { source, includeFastModel = true } = {}) {
  const { configured, outputMode } = describeLessonProvider(provider);
  const fast = resolveConfiguredFastProvider(provider);
  return {
    configured,
    baseUrlHost: configured ? visibleField(new URL(provider.baseUrl).host, provider) : null,
    model: configured ? visibleField(provider.model, provider) : null,
    outputMode,
    source: source ?? (configured || fast ? 'runtime' : 'none'),
    fastConfigured: Boolean(fast),
    ...(includeFastModel && { fastModel: fast ? visibleField(fast.model, provider.key, provider.fastKey, provider.fastBaseUrl) : null }),
    fastBaseUrlHost: fast ? visibleField(new URL(fast.baseUrl).host, provider) : null,
  };
}

export function readSessionProvider() {
  try { sessionStorage.removeItem(obsoleteStorageKey); } catch { /* Storage may be disabled. */ }
  return { ...memory };
}

export function sessionProviderSummary() {
  return providerSummary(readSessionProvider());
}

export function saveSessionProvider(input) {
  memory = input.clear ? {} : parseProviderInput(input, readSessionProvider());
  return sessionProviderSummary();
}

export async function testProvider(provider, { tier = 'main', signal } = {}) {
  if (!['main', 'fast'].includes(tier)) throw new Error('未知模型配置项。');
  const target = tier === 'fast' ? resolveConfiguredFastProvider(provider) : provider;
  if (!target || !describeLessonProvider(target).configured) {
    throw new Error(tier === 'fast' ? '请先填写快速决策模型配置。' : '请先填写主模型配置。');
  }
  const deadline = AbortSignal.timeout(12_000);
  const content = await requestStructuredCompletion({
    ...target,
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    schemaName: 'connection_ping',
    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
    messages: [{ role: 'user', content: '仅返回 JSON {"ok":true}' }],
  });
  let decoded;
  try { decoded = JSON.parse(content); } catch { /* Invalid replies use the connection error below. */ }
  if (decoded?.ok !== true || Object.keys(decoded).length !== 1) throw new Error('连接成功但未返回有效 JSON。');
  return { tested: true };
}

export function testSessionProvider(input) {
  return testProvider(parseProviderInput({ ...input, test: true }, readSessionProvider()), { tier: input.testTier });
}
