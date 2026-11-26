import test from 'node:test';
import assert from 'node:assert/strict';
import { runDeckHarness,rehearseDeckHarness,createPageModule,validateHarnessLesson,HARNESS_STAGES } from '../dist/core/deck-harness.mjs';
import { SHOWCASE_DECKS,createDemoMaterial } from '../dist/core/demo-lesson.mjs';
import { MODULE_MANIFESTS,validateModulePayload,getActivity } from '../dist/core/activities.mjs';
import { universalLessons,gaussianConfig } from '../dist/core/universal-lessons.mjs';
import { importScore,exportScore } from '../dist/core/score-package.mjs';
test('all five tracked stages compile all four modules and preserve untouched pages',async()=>{
  const seen=new Set();
  for(const d of SHOWCASE_DECKS){
    const material=createDemoMaterial(d.id),original=JSON.stringify(material);
    material.pages[1].pageMemories=[{note:'上次需增加反例'}];
    const r=await rehearseDeckHarness(material);
    assert.deepEqual(r.harnessReceipt.stages.map(s=>s.id),HARNESS_STAGES.map(s=>s.id));
    assert.ok(r.harnessReceipt.stages.every(s=>s.status==='complete'));
    assert.match(r.harnessReceipt.versionId,/^sha256-[a-f0-9]{64}$/);
    assert.equal(r.lectureScore.format,'polyphony.lecture');
    assert.equal(r.lectureScore.pages[0].interaction,undefined);assert.equal(r.lectureScore.pages.at(-1).interaction,undefined);
    assert.equal(r.lectureScore.pages.length,material.pages.length);
    assert.equal(r.harnessReceipt.repairs[0].status,'repaired');assert.match(r.harnessReceipt.repairs[0].issue,/M99/);assert.equal(r.harnessReceipt.repairs[0].simulated,true);
    assert.equal(r.harnessReceipt.pageMemories[1].memories[0].note,'上次需增加反例');
    for(const dry of r.harnessReceipt.dryRuns){seen.add(dry.activityId);assert.equal(dry.round,2);assert.equal(dry.phase,'closed');assert.equal(dry.responses,2);assert.deepEqual(dry.commands,['loadLesson','join','respond','reveal','analyze','branch','revise','respond','reveal','close']);}
    delete material.pages[1].pageMemories;assert.equal(JSON.stringify(material),original);
  }
  assert.deepEqual([...seen].sort(),MODULE_MANIFESTS.map(m=>m.id).sort());
});
const providerWith=(handler)=>({baseUrl:'https://model.example/v1',model:'mock',key:'fixture-private-key',outputMode:'json_schema',fetchImpl:async(url,request)=>{
  assert.equal(new URL(url).pathname,'/v1/chat/completions');assert.equal(request.headers.Authorization,'Bearer fixture-private-key');
  const body=JSON.parse(request.body);assert.equal(body.response_format.json_schema.strict,true);
  return Response.json({choices:[{message:{content:JSON.stringify(await handler(body))}}]});
}});
test('model M99 citation is intercepted and exact feedback repairs once',async()=>{
  const material=createDemoMaterial();material.pages=[material.pages[2]];
  const valid=createPageModule(material.pages[0],'concept-diagnosis@1');let calls=0;
  const provider=providerWith(body=>{calls++;if(calls===1)return {...valid,evidenceIds:['M99']};assert.match(body.messages.at(-1).content,/M99/);return valid;});
  const r=await runDeckHarness(material,{pacingMode:'full-demo',provider});assert.equal(calls,2);assert.equal(r.source,'provider');assert.equal(r.harnessReceipt.repairs[0].status,'repaired');assert.doesNotMatch(JSON.stringify(r),/fixture-private-key/);
});
test('unknown formula variable fails finite expression guard and model repairs it',async()=>{
  const material=createDemoMaterial();material.pages=[material.pages[3]];
  const valid=createPageModule(material.pages[0],'param-explorer@1');let calls=0;
  const provider=providerWith(body=>{calls++;if(calls===1){const bad=structuredClone(valid);bad.moduleConfig.curves[0].expr='exp(-z*x^2)';return bad;}assert.match(body.messages.at(-1).content,/z/);return valid;});
  const r=await runDeckHarness(material,{pacingMode:'full-demo',provider});assert.equal(calls,2);assert.equal(r.harnessReceipt.repairs[0].status,'repaired');assert.equal(r.interactionsByPage.get(4).activityId,'param-explorer@1');
});
test('a second invalid output falls back once without leaking fabricated evidence',async()=>{
  const material=createDemoMaterial();material.pages=[material.pages[2]];let calls=0;
  const provider=providerWith(()=>{calls++;return {activityId:'unknown'};});
  const r=await runDeckHarness(material,{pacingMode:'full-demo',provider});assert.equal(calls,2);assert.equal(r.harnessReceipt.repairs[0].status,'fallback');assert.equal(r.interactionsByPage.get(3).activityId,'concept-diagnosis@1');
});
test('offline planning handles arbitrary material, pacing, hidden pages and content hashes',async()=>{
  const pages=Array.from({length:20},(_,i)=>({number:i+1,title:'概念辨析 '+(i+1),text:'原文说明：使用本结论必须满足独立性条件。'}));
  pages[19].hidden=true;
  const r=await runDeckHarness({name:'统计学',pages});assert.equal(r.source,'local');assert.equal(r.lectureScore.pages.length,19);assert.ok(r.interactionsByPage.size<=8);assert.ok(r.harnessReceipt.stages.every(s=>s.status==='complete'));
  const other=await runDeckHarness({name:'统计学',pages:[{...pages[0],text:'新的条件'}]});assert.notEqual(r.harnessReceipt.versionId,other.harnessReceipt.versionId);
  await assert.rejects(runDeckHarness({name:'空',pages:[]}),/导入/);
  await assert.rejects(runDeckHarness({name:'坏页',pages:[{number:1,text:'x'},{number:1,text:'y'}]}),/页码/);
});
test('contracts and score archives retain configs, answers, reasons and takeaways',()=>{
  for(const lesson of universalLessons){assert.equal(validateModulePayload(lesson.activityId,lesson.moduleConfig),true);const copy=importScore(exportScore(lesson));for(const k of ['activityId','correctOptionId','moduleConfig','quickReasons','takeaway'])assert.deepEqual(copy[k],lesson[k]);}
  const bad=structuredClone(gaussianConfig);bad.curves[0].expr='sqrt(x)';assert.throws(()=>validateModulePayload('param-explorer@1',bad),/有限/);
  const step=structuredClone(universalLessons[0].moduleConfig);step.faultStepId='S99';assert.throws(()=>validateModulePayload('step-fault@1',step),/faultStepId/);
  assert.throws(()=>validateModulePayload('param-explorer@1',{...gaussianConfig,apiKey:'injected-secret'}),/未知字段/);
  for(const id of ['choice@1','mzi-phase@1','rc-degeneracy@1','spectral-aliasing@1'])assert.ok(getActivity(id));
  const p=createDemoMaterial().pages[2],valid=createPageModule(p,'concept-diagnosis@1'),blocks=p.text.split('\n').map((text,i)=>({id:'M'+(i+1),text}));
  assert.throws(()=>validateHarnessLesson({...valid,options:[valid.options[0],valid.options[0]]},{...p,blocks}),/options/);
  assert.throws(()=>validateHarnessLesson({...valid,sourceEvidence:[{id:'M1',quote:'编造引文'}]},{...p,blocks}),/引文/);
});
test('offline synthesis identifies a source NULL dereference without a course-specific engine',async()=>{
  const p={number:1,title:'数据结构：节点初始化',text:'typedef struct { int value; } Item;\nItem *node = NULL;\nnode->value = 7;\nreturn 0;'};
  const r=await runDeckHarness({name:'任意导入代码页',pages:[p]},{pacingMode:'full-demo'});
  const l=r.interactionsByPage.get(1);assert.equal(l.activityId,'step-fault@1');assert.equal(l.correctOptionId,'S3');assert.equal(l.moduleConfig.steps.length,4);assert.match(l.moduleConfig.faultDiagnosis,/node/);assert.equal(l.sourceEvidence.length,4);
});
