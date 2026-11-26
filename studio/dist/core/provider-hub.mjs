import { describeLessonProvider, requestStructuredCompletion } from './lesson-provider.mjs';
const storageKey = 'polyphony.provider.session.v3';
let memory;
export function readSessionProvider() {
  if (memory) return { ...memory };
  try { return JSON.parse(sessionStorage.getItem(storageKey)) ?? {}; } catch { return {}; }
}
export function sessionProviderSummary() {
  const p = readSessionProvider(), d = describeLessonProvider(p);
  return { configured:d.configured,baseUrlHost:d.configured?new URL(p.baseUrl).host:null,model:d.configured?p.model:null,outputMode:d.outputMode,source:d.configured?'runtime':'none' };
}
export function saveSessionProvider(input) {
  if (input.clear) { memory=undefined; try { sessionStorage.removeItem(storageKey); } catch {} return sessionProviderSummary(); }
  const p = {baseUrl:input.baseUrl,model:input.model,key:input.key,outputMode:input.outputMode??'json_object'};
  if (!describeLessonProvider(p).configured) throw Error('请检查 Base URL、Model、API Key 和输出模式。');
  memory=p;
  try { sessionStorage.setItem(storageKey,JSON.stringify(p)); } catch { /* In-memory fallback for restricted storage. */ }
  return sessionProviderSummary();
}
export async function testSessionProvider(input) {
  if (!describeLessonProvider(input).configured) throw Error('模型参数无效。');
  const content = await requestStructuredCompletion({...input,signal:AbortSignal.timeout(5000),schemaName:'connection_ping',schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},messages:[{role:'user',content:'仅返回 JSON {"ok":true}'}]});
  if (JSON.parse(content)?.ok !== true) throw Error('连接成功但未返回有效 JSON。');
  return { tested:true };
}
