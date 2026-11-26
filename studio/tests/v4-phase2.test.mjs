import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRoom,reduceRoom} from '../dist/core/engine.mjs';
import {combatMaterial} from '../dist/core/combat-decks.mjs';
import {createPageModule,runDeckHarness,detectPageActivity} from '../dist/core/deck-harness.mjs';
import {validateLectureScore} from '../dist/core/lecture-score.mjs';
import {importMaterialFile} from '../material-import.mjs';
import {curveSvg} from '../dist/views/module-renderer.mjs';
import {projectRoom} from '../dist/core/transport.mjs';

test('all fault contracts use faultStepId for a 5/4/3 split and correctOptionId for 11/12 revision',()=>{
 const lessons=[combatMaterial('deck-c-pointers').pages[6].showcaseLesson,combatMaterial('deck-optics').pages[2].showcaseLesson,combatMaterial('deck-english-seminar').pages[6].showcaseLesson];
 lessons.push(createPageModule({number:1,title:'自编推导',text:'1. 设定测量条件\n2. 比较两组样本均值\n3. 对所有人作出结论\n4. 检查证据'},'step-fault@1'));
 const renamed=structuredClone(lessons[1]);renamed.id='authored-custom-ids';renamed.moduleConfig.steps.forEach((s,i)=>s.id='line-'+i);renamed.moduleConfig.faultStepId='line-1';renamed.correctOptionId='line-1';renamed.options=renamed.options.map((o,i)=>({...o,id:'line-'+i})).reverse();lessons.push(renamed);
 for(const lesson of lessons){
  let s=reduceRoom(createRoom(),{type:'loadLesson',payload:{lesson}});const cmd=(type,payload)=>s=reduceRoom(s,{type,payload});cmd('demoFill');
  assert.equal(s.responses.filter(r=>r.optionId===lesson.moduleConfig.faultStepId).length,5);
  const votes=lesson.options.map(o=>s.responses.filter(r=>r.optionId===o.id).length).filter(Boolean).sort((a,b)=>b-a);assert.deepEqual(votes,[5,4,3]);assert(s.responses.every(r=>r.reason.trim()));
  for(const r of s.responses)if(r.optionId!==lesson.moduleConfig.faultStepId)assert(r.reason.includes(lesson.moduleConfig.steps.find(t=>t.id===r.optionId).content));
  cmd('reveal');cmd('analyze');cmd('branch',{branchId:lesson.branches[0].id});cmd('revise');cmd('demoFill');
  assert.equal(s.responses.filter(r=>r.round===2&&r.optionId===lesson.correctOptionId).length,11);
 }
});

test('eight-page legacy PDF retains all original visual previews and text through the five-stage harness',async()=>{
 const name='04-旧课件导入示例-软件技术基础第6章指针原稿(8页).pdf';const bytes=await readFile(new URL('../../示例课件/'+name,import.meta.url));
 const material=await importMaterialFile({name,bytes});assert.equal(material.pages.length,8);assert(material.pages.every(p=>p.preview.startsWith('data:image/png;base64,')&&p.text.trim()));
 const before=JSON.stringify(material.pages);const r=await runDeckHarness(material,{pacingMode:'full-demo'});validateLectureScore(r.lectureScore);assert.equal(r.lectureScore.pages.length,8);assert.equal(JSON.stringify(material.pages),before);assert(r.harnessReceipt.stages.every(s=>s.status==='complete'));
 for(let i=0;i<8;i++)assert.equal(r.lectureScore.pages[i].preview,material.pages[i].preview);
});

test('six-slit SVG includes the exact central unit maximum and resolved secondary peaks',()=>{
 const config=combatMaterial('deck-optics').pages[4].showcaseLesson.moduleConfig;
 const svg=curveSvg(config,{r:.5,N:6});const path=svg.match(/data-curve="1" d="([^"]+)"/)[1];
 assert.match(path,/L400\.00,40\.00/);assert.match(path,/L630\.00,240\.00/);
});

test('section numbers are not confused with a numbered faulty reasoning sequence',()=>{
 assert.equal(detectPageActivity({title:'6.2 指针基类型与步长',text:'sizeof(p) 与所指对象步长含义不同。'}),'concept-diagnosis@1');
 assert.equal(detectPageActivity({title:'推导审计',text:'1. 设定条件\n2. 无条件推广'}),'step-fault@1');
});

test('second-round public reasoning keeps only scrubbed selected first-round quotations',()=>{
 const lesson=combatMaterial('deck-c-pointers').pages[6].showcaseLesson;
 let s=reduceRoom(createRoom(),{type:'loadLesson',payload:{lesson}});const cmd=(type,payload)=>s=reduceRoom(s,{type,payload});
 cmd('demoFill');cmd('reveal');cmd('analyze');cmd('branch',{branchId:lesson.branches[0].id});cmd('revise');
 s.firstRoundAnalysis.contrastPair[0].quote+=' private-person';s.participants.push({id:'private-person',name:'真实姓名'});
 assert.equal(projectRoom(s,'stage').firstRoundContrastPair,undefined);cmd('demoFill');cmd('reveal');
 const p=projectRoom(s,'stage');assert.equal(p.firstRoundAnalysis,undefined);assert.equal(p.firstRoundContrastPair.length,2);assert.doesNotMatch(JSON.stringify(p.firstRoundContrastPair),/private-person|真实姓名/);
 assert(p.firstRoundContrastPair.every(q=>Object.keys(q).sort().join(',')==='quote,sideLabel,tone'));
});
