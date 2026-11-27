import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMarkdownDeck, inferBlocksFromPlainSlide } from '../dist/core/slide-blocks.mjs';
import { blockText, validateSlideBlocks } from '../dist/core/lecture-score.mjs';
import { createMaterialNotebook, makeMaterialVersionId } from '../dist/core/material-notebook.mjs';
import { runDeckHarness, regeneratePageInteraction, createPageModule, dryRunLesson } from '../dist/core/deck-harness.mjs';
import { normalizeEditedLesson, inspectParamConfig } from '../dist/views/page-editor.mjs';
import { gaussianConfig } from '../dist/core/universal-lessons.mjs';
import { roomTestServer, request } from './support/integration.mjs';

test('Markdown headings and separators split pages outside fences and every transcript equals blockText',()=>{
  const material=parseMarkdownDeck('多页', '# 第一页\n说明\n```c\nint a=1;\n---\n```\n```c\nreturn a;\n```\n---\n## 第二页\n| 对象 | 值 |\n| --- | --- |\n| a | 1 |\n$$x=a*x^2$$\n> 检查条件\n1. 先定义\n2. 后验证\n- 独立判断\n- 讨论改答');
  assert.equal(material.pages.length,2);
  assert(material.pages[0].blocks.some(b=>b.type==='code-pair'));
  for(const type of ['table','formula','callout','steps','bullets'])assert(material.pages[1].blocks.some(b=>b.type===type));
  for(const page of material.pages){assert.deepEqual(validateSlideBlocks(page.blocks),page.blocks);assert.equal(page.text,page.blocks.map(blockText).join('\n'));}
  assert.match(material.pages[0].text,/int a=1;\n---/);
});
test('plain slide inference preserves input and all source text, retaining image and rich slides unchanged',()=>{
  const page={number:1,title:'数据',text:'说明\n表格\n对象 ｜ 值\na ｜ 1\n    int a=1;\n    return a;\n- 检查 a\n- 输出 a',images:[]};
  const before=structuredClone(page),inferred=inferBlocksFromPlainSlide(page);
  assert.deepEqual(page,before);assert.equal(inferred.text,before.text);
  for(const type of ['table','code','bullets'])assert(inferred.blocks.some(b=>b.type===type));
  for(const extra of [{preview:'image'},{images:[{src:'image'}]},{blocks:[{type:'callout',text:'keep'}]}]){
    const input={...page,...extra};assert.deepEqual(inferBlocksFromPlainSlide(input),input);
  }
});
test('remembered pages outrank earlier eligible pages and prior misconceptions reach synthesis',async()=>{
  const pages=Array.from({length:10},(_,i)=>({number:i+1,title:'定义 '+(i+1),text:'结论成立需要独立性条件。'}));
  pages[8].pageMemories=[{packet:{reason:'误把相关性当成因果性'}}];
  let received=false;
  const provider={baseUrl:'https://fixture.example/v1',model:'mock',key:'secret-local',fetchImpl:async(_,request)=>{
    const input=JSON.parse(JSON.parse(request.body).messages[1].content);
    if(input.pageNumber===9){assert.match(input.priorMisconceptions.join(' '),/因果性/);received=true;}
    return Response.json({choices:[{message:{content:JSON.stringify(createPageModule(pages[input.pageNumber-1],'concept-diagnosis@1'))}}]});
  }};
  const result=await runDeckHarness({name:'测试',pages},{provider});
  assert.equal(result.suggestions[0].pageNumber,9);assert(received);
});
test('single-page regeneration is local without API and grounded, repaired and secret-safe with API',async()=>{
  const page={number:2,title:'样本均值',text:'只有独立同分布样本才使用当前估计公式。'};
  const local=await regeneratePageInteraction({page,activityId:'concept-diagnosis@1'});
  assert.match(local.prompt,/样本均值/);assert.equal(dryRunLesson(local).round,2);
  let calls=0;const provider={baseUrl:'https://fixture.example/v1',model:'mock',key:'private-secret',fetchImpl:async(_,request)=>{
    calls++;const body=JSON.parse(request.body);assert.match(body.messages[1].content,/增加边界条件/);
    return Response.json({choices:[{message:{content:JSON.stringify(calls===1?{...local,evidenceIds:['M99']}:{...local,title:'边界自检'})}}]});
  }};
  assert.equal((await regeneratePageInteraction({page,activityId:local.activityId,instruction:'增加边界条件',provider})).title,'边界自检');assert.equal(calls,2);
  provider.fetchImpl=async()=>Response.json({choices:[{message:{content:JSON.stringify({...local,prompt:provider.key})}}]});
  await assert.rejects(regeneratePageInteraction({page,activityId:local.activityId,provider}),error=>!error.message.includes(provider.key)&&/凭据/.test(error.message));
});
test('visual edits synchronize step answers, reasons, takeaways and legal evidence references',()=>{
  const page={number:1,title:'代码',text:'int x=1;\nx=x+1;\nreturn x;'};
  const lesson=createPageModule(page,'step-fault@1');lesson.moduleConfig.faultStepId=lesson.moduleConfig.steps[1].id;
  lesson.quickReasons=['检查初始化','检查递增'];lesson.takeaway={summary:'',pitfall:''};lesson.evidenceIds=['M99'];
  const checked=normalizeEditedLesson(page,lesson);
  assert.equal(checked.correctOptionId,checked.moduleConfig.faultStepId);
  assert.deepEqual(checked.options.map(o=>o.id),checked.moduleConfig.steps.map(s=>s.id));
  assert.deepEqual(checked.quickReasons,checked.moduleConfig.quickReasons);assert.deepEqual(checked.takeaway,checked.moduleConfig.takeaway);
  assert(checked.takeaway.summary&&checked.takeaway.pitfall);assert.equal(dryRunLesson(checked).phase,'closed');
});
test('parameter editor samples every slider corner and rejects unsafe or nonfinite curves',()=>{
  assert.equal(inspectParamConfig(gaussianConfig).corners,2);
  const invalid=structuredClone(gaussianConfig);invalid.curves[0].expr='globalThis.fetch(x)';assert.throws(()=>inspectParamConfig(invalid));
  invalid.curves[0].expr='sqrt(x)';assert.throws(()=>inspectParamConfig(invalid),/有限/);
});

// A request/transaction test adapter; real IndexedDB persistence is also exercised by browser acceptance.
function memoryDatabase() {
  const stores=new Map(),transactions=[];
  const keyFor=(record,path)=>Array.isArray(path)?path.map(k=>record[k]):record[path];
  function table(name,tx) {
    const store=stores.get(name);
    const request=operation=>{
      const r={};tx.pending++;
      setImmediate(()=>{try{r.result=structuredClone(operation());r.onsuccess?.();}catch(error){r.error=error;r.onerror?.();}finally{tx.pending--;tx.finish();}});return r;
    };
    return {
      get:key=>request(()=>store.rows.get(JSON.stringify(key))),
      getAll:()=>request(()=>[...store.rows.values()]),
      put:record=>request(()=>{store.rows.set(JSON.stringify(keyFor(record,store.keyPath)),structuredClone(record));return keyFor(record,store.keyPath);}),
      add:record=>request(()=>{store.rows.set(JSON.stringify(keyFor(record,store.keyPath)),structuredClone(record));return keyFor(record,store.keyPath);}),
      delete:key=>request(()=>store.rows.delete(JSON.stringify(key))),
      index:field=>({getAll:key=>request(()=>[...store.rows.values()].filter(record=>JSON.stringify(keyFor(record,store.indexes.get(field)))===JSON.stringify(key))) }),
      createIndex:(field,path)=>store.indexes.set(field,path),
    };
  }
  const db={
    createObjectStore(name,{keyPath}) {stores.set(name,{keyPath,rows:new Map(),indexes:new Map()});return table(name,{pending:0,finish(){}});},
    transaction(names,mode) {
      transactions.push({names,mode});let scheduled=false;
      const tx={pending:0,objectStore:name=>table(name,tx),abort(){tx.onabort?.();},finish(){if(scheduled)return;scheduled=true;setImmediate(()=>{scheduled=false;if(!tx.pending)tx.oncomplete?.();});}};
      tx.finish();return tx;
    },close(){},
  };
  return {transactions,open(){const request={};setImmediate(()=>{request.result=db;request.onupgradeneeded?.();request.onsuccess?.();});return request;}};
}
test('notebook drafts restore speaker notes and deleting a version atomically removes all associated records',async()=>{
  const indexedDB=memoryDatabase(),notebook=createMaterialNotebook({indexedDB});
  const versionId=await makeMaterialVersionId({bytes:'first'}),other=await makeMaterialVersionId({bytes:'second'});
  const material={versionId,name:'备课',pages:[{number:1,title:'定义',text:'正文',speakerNotes:'原备注'}],draft:{}};
  await notebook.saveVersion(material);await notebook.saveVersion({...material,versionId:other});
  await notebook.savePageNote(versionId,1,{id:'misconception',kind:'annotation',packet:{reason:'前提遗漏'}});
  await notebook.saveVersion({...material,pages:[{...material.pages[0],speakerNotes:'编辑后的备注'}],draft:{title:'草稿'}});
  const restored=await notebook.getVersion(versionId);assert.equal(restored.draft.speakerNotes[1],'编辑后的备注');assert.equal(restored.pages[0].speakerNotes,'编辑后的备注');
  const db=await new Promise(resolve=>{const r=indexedDB.open();r.onsuccess=()=>resolve(r.result);});
  await new Promise(resolve=>{const tx=db.transaction(['classrooms'],'readwrite');tx.objectStore('classrooms').put({versionId,pageNumber:1,room:'ROOM01'});tx.oncomplete=resolve;});
  await notebook.deleteVersion(versionId);
  assert.equal(await notebook.getVersion(versionId),null);assert.deepEqual(await notebook.listNotes(versionId),[]);assert.equal(await notebook.getPageClassroom(versionId,1),null);assert.equal((await notebook.listVersions()).length,1);
  assert(indexedDB.transactions.some(t=>t.mode==='readwrite'&&t.names.join(',')==='versions,documents,notes,classrooms'));
});
test('test discovery is restricted and view cleanup is guarded by mounted identity',async()=>{
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));assert.equal(pkg.scripts.test,'node --test tests/*.test.mjs');
  const app=await readFile(new URL('../dist/app.mjs',import.meta.url),'utf8');assert.match(app,/mountedPage\.render === page\.render/);assert.match(app,/if \(!same\) clearPage\(\)/);
});

test('regenerate-page and authoring aliases enforce teacher ownership and return readable errors',async t=>{
  const server=await roomTestServer(t);if(!server)return;
  const created=await request(server.origin,'/api/rooms',{data:{demo:false}});
  const cookie=created.headers.get('set-cookie').split(';')[0],room=(await created.json()).room;
  const path=`/api/rooms/${room.code}`;
  const data={page:{number:1,title:'独立性',text:'使用估计公式前须验证样本独立性。'},activityId:'concept-diagnosis@1'};
  assert.equal((await request(server.origin,path+'/regenerate-page',{data})).status,403);
  const generated=await request(server.origin,path+'/regenerate-page',{data,cookie});
  assert.equal(generated.status,200);assert.equal(dryRunLesson(await generated.json()).round,2);
  for(const [route,input] of [['regenerate-page',{page:{}}],['compose-deck',{material:{pages:[]}}],['generate-native',{spec:{}}]]){
    const invalid=await request(server.origin,path+'/'+route,{data:input,cookie});
    assert.equal(invalid.status,400);assert.match((await invalid.json()).error,/[\u3400-\u9fff]/);
  }
});
