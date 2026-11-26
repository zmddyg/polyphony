import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {COMBAT_DECKS,combatMaterial,blockText} from '../demo/combat-decks.mjs';
import {runDeckHarness,generateNativeDeck,createPageModule,NATIVE_DECK_SCHEMA,dryRunLesson} from '../dist/core/deck-harness.mjs';
import {validateLectureScore,buildLectureScore,lectureFrame,validateSlideBlocks} from '../dist/core/lecture-score.mjs';
import {createLectureRoom,applyRoomCommand} from '../dist/core/lecture-room.mjs';
import {projectRoom} from '../dist/core/transport.mjs';
import {takeawayDrawerHtml,inlineResultsHtml,lectureKeyboard} from '../dist/views/lecture-room.mjs';
import {renderLectureFrame} from '../dist/views/lecture-stage.mjs';
import {compileExpression} from '../dist/core/safe-expr.mjs';
import {readLegacySlides} from '../dist/core/legacy-ppt.mjs';
import {esc} from '../dist/ui.mjs';
import {createRoom,reduceRoom} from '../dist/core/engine.mjs';

test('all 32 combat slides retain dense native teaching blocks and exactly nine intended checkpoints',async()=>{
  assert.deepEqual(COMBAT_DECKS.map(d=>d.pages.length),[12,10,10]);
  for(const [i,d] of COMBAT_DECKS.entries()){
    const r=await runDeckHarness(combatMaterial(d.id),{pacingMode:'full-demo'});
    assert.deepEqual(validateLectureScore(r.lectureScore),r.lectureScore);
    assert.deepEqual(r.lectureScore.pages.filter(p=>p.interaction).map(p=>p.number),[[4,7,11],[3,5,8],[4,7,8]][i]);
    assert.equal(r.harnessReceipt.repairs.length,0);
    assert(r.lectureScore.pages.every(p=>p.blocks.length>=2));
    assert(r.harnessReceipt.dryRuns.every(d=>d.round===2&&d.phase==='closed'&&d.responses===2));
    for(const p of r.lectureScore.pages){const root={innerHTML:''};renderLectureFrame(root,lectureFrame(r.lectureScore,p.number-1));assert.match(root.innerHTML,/slide-blocks/);}
  }
});

test('rich blocks round-trip on originals and adopted slides, render escaped, and reject malformed structures',()=>{
  const attack='<img src=x onerror=alert(1)>',blocks=[{type:'code',title:attack,language:'c',code:'int x=3; // '+attack},{type:'code-pair',left:{code:attack},right:{code:'return 0;'}},{type:'table',headers:[attack,'B'],rows:[['x','y']]},{type:'callout',title:attack,text:attack,tone:'warning'},{type:'formula',items:[attack]},{type:'steps',items:[attack]},{type:'bullets',items:[attack]},{type:'stat-grid',items:[{value:'42',label:attack}]}];
  const score=buildLectureScore({name:'fixture',pages:[{number:1,title:attack,text:'',blocks}]},new Map([[1,{slides:[{title:'附页',blocks,body:[]}]}]]));
  for(const index of [0,1]){
    const frame=lectureFrame(score,index);assert.equal(frame.blocks.length,8);const root={innerHTML:''};renderLectureFrame(root,frame);
    assert.doesNotMatch(root.innerHTML,/<img src=x|<script/);assert.match(root.innerHTML,/&lt;img/);assert.match(root.innerHTML,/syntax-keyword/);
  }
  for(const blocks of [[{type:'html',text:attack}],[{type:'table',headers:['x'],rows:[['a','b']]}],[{type:'code',code:3}],[{type:'bullets',items:'bad'}]])assert.throws(()=>validateSlideBlocks(blocks));
});

test('navigation archives an in-progress inline activity, rejects stale submissions, and restores both rounds',async()=>{
  const score=(await runDeckHarness(combatMaterial('deck-c-pointers'),{pacingMode:'full-demo'})).lectureScore;
  let room=createLectureRoom('V4TEST',score);
  const send=(type,payload={})=>room=applyRoomCommand(room,{type,payload:{expectedLectureIndex:room.lecture.index,expectedLectureTurn:room.lecture.turn,...payload}},score);
  send('lectureNavigate',{index:3});send('lectureInteract');send('join',{participantId:'student',name:'小林'});send('respond',{participantId:'student',optionId:'B',reason:'8B是步长吗？'});
  const stale={type:'respond',payload:{participantId:'student',optionId:'A',expectedLectureIndex:3,expectedLectureTurn:room.lecture.turn}};
  const ref=room;send('lectureNavigate',{index:4});assert.equal(room.lecture.mode,'slides');assert.equal(room.lectureArchive[0].responses.length,1);assert.equal(ref.lectureArchive.length,0);
  assert.throws(()=>applyRoomCommand(room,stale,score),/已经切换/);
  assert.equal(projectRoom(room,'student','student').lectureArchive,undefined);assert.equal(projectRoom(room,'student','student').lectureTakeaways.length,0);
  send('lectureNavigate',{index:3});send('lectureInteract');assert.equal(room.responses[0].optionId,'B');
  send('reveal');send('analyze');send('branch',{branchId:room.lesson.branches[0].id});send('revise');send('respond',{participantId:'student',optionId:'A',reason:'sizeof(*p)才是步长'});send('reveal');send('close');
  assert.match(inlineResultsHtml(room,esc),/1 \/ 1 人改了答案/);
  send('lectureNavigate',{index:6});send('lectureInteract');assert.equal(room.lectureArchive.length,1);assert.equal(room.lesson.id,'harness-p7');
  const mobile=projectRoom(room,'student','student');assert.match(takeawayDrawerHtml(mobile,esc),/本课速查（1）/);assert.doesNotMatch(JSON.stringify(mobile.lectureTakeaways),/小林|8B是步长/);
  send('lectureNavigate',{index:3});send('lectureInteract');assert.equal(room.phase,'closed');assert.equal(room.responses.length,2);assert.throws(()=>send('respond',{participantId:'student',optionId:'B'}),/阶段/);
  send('lectureFinish');assert.equal(room.lecture.mode,'ended');assert.equal(room.lectureArchive.length,2);
});

test('all navigation keys work in slides and activity modes without intercepting editable controls',async()=>{
  const before=globalThis.document;globalThis.document={querySelector:()=>null};
  try{for(const mode of ['slides','activity'])for(const [key,index] of [['ArrowRight',3],['PageDown',3],[' ',3],['ArrowLeft',1],['PageUp',1]]){
    let command;let prevented=false;lectureKeyboard({key,target:{closest:()=>null},preventDefault(){prevented=true;}},{state:{lecture:{mode,index:2,total:12}},command:async(t,p)=>{command=[t,p.index];}});assert(prevented);assert.deepEqual(command,['lectureNavigate',index]);
  }}finally{globalThis.document=before;}
});

test('offline native generation supports three preset scales and arbitrary topic decomposition with real receipts',async()=>{
  for(const [course,topic] of [['C语言','指针'],['物理光学','衍射与干涉'],['大学英语','Hedging与思辨'],['大一线性代数','四个子空间；可解性'],['专业课','相变条件；测量证据']])for(const pageCount of [8,10,12]){
    const r=await generateNativeDeck({course,topic,pageCount});assert.equal(r.lectureScore.pages.length,pageCount);assert.equal(r.source,'local');assert.match(r.generationNote,/本地生成的备课框架/);
    assert.equal(r.lectureScore.source.name,course); assert.ok(r.lectureScore.title.includes(topic.split('；')[0]));
    assert(r.harnessReceipt.dryRuns.length>=2&&r.harnessReceipt.dryRuns.length<=3);assert(r.harnessReceipt.stages.every(s=>s.status==='complete'));assert(r.lectureScore.pages.every(p=>p.blocks.length));
  }
  await assert.rejects(generateNativeDeck({course:'',topic:'x'}),/填写/);await assert.rejects(generateNativeDeck({course:'x',topic:'y',pageCount:25}),/8–12/);
});

function mockNative() {
  const pages=Array.from({length:8},(_,i)=>({title:'统计推断 '+(i+1),blocks:[{type:'callout',title:'条件',text:'独立同分布条件下比较样本均值。',tone:'note'}],speakerNotes:'指出推断的条件',interaction:null}));
  for(const i of [2,5]){const p=pages[i];p.interaction=createPageModule({number:i+1,title:p.title,text:p.blocks.map(blockText).join('\n')},'concept-diagnosis@1');}
  return {title:'统计推断精讲',pages};
}
const provider=handler=>({baseUrl:'https://fixture.example/v1',model:'mock',key:'private-fixture-key',outputMode:'json_schema',fetchImpl:async(_,request)=>{const body=JSON.parse(request.body);assert.deepEqual(body.response_format.json_schema.schema,NATIVE_DECK_SCHEMA);return Response.json({choices:[{message:{content:JSON.stringify(handler(body))}}]});}});
test('from-scratch model output is schema-constrained, internally grounded, repaired once and dry-run',async()=>{
  let calls=0;const good=mockNative();
  const r=await generateNativeDeck({course:'统计',topic:'样本均值',pageCount:8},{provider:provider(body=>{calls++;if(calls===1){const raw=structuredClone(good);raw.pages[2].interaction.evidenceIds=['M99'];return raw;}assert.match(body.messages.at(-1).content,/M99/);return good;})});
  assert.equal(calls,2);assert.equal(r.source,'provider');assert.equal(r.harnessReceipt.repairs[0].status,'repaired');assert.equal(r.harnessReceipt.dryRuns.length,2);assert.doesNotMatch(JSON.stringify(r),/private-fixture-key/);
});
test('JSON-object gateways receive the entire native deck schema in the prompt as well',async()=>{
  const gateway={baseUrl:'https://fixture.example/v1',model:'mock',key:'test-private',outputMode:'json_object',fetchImpl:async(_,request)=>{
    const body=JSON.parse(request.body);assert.equal(body.response_format.type,'json_object');
    const input=JSON.parse(body.messages[1].content);assert.equal(input.spec.pageCount,8);assert.deepEqual(input.schema,NATIVE_DECK_SCHEMA);
    return Response.json({choices:[{message:{content:JSON.stringify(mockNative())}}]});
  }};
  assert.equal((await generateNativeDeck({course:'统计',topic:'样本均值',pageCount:8},{provider:gateway})).source,'provider');
});
test('both authoring sources reject credentials echoed by a model before exporting content or receipts',async()=>{
  const key='private-fixture-key';const native=mockNative();native.title=key;
  const authored=await generateNativeDeck({course:'统计',topic:'样本均值',pageCount:8},{provider:provider(()=>native)});
  assert.equal(authored.source,'local');assert.doesNotMatch(JSON.stringify(authored),/private-fixture-key/);
  const material=combatMaterial('deck-c-pointers');material.pages=[material.pages[3]];
  const raw=createPageModule(material.pages[0],'concept-diagnosis@1');raw.title=key;
  const gateway={baseUrl:'https://fixture.example/v1',model:'mock',key,outputMode:'json_schema',fetchImpl:async()=>Response.json({choices:[{message:{content:JSON.stringify(raw)}}]})};
  const imported=await runDeckHarness(material,{pacingMode:'full-demo',provider:gateway});
  assert.equal(imported.harnessReceipt.repairs[0].status,'fallback');assert.doesNotMatch(JSON.stringify(imported),/private-fixture-key/);
});
test('native generation rejects unsafe expressions and mismatched step ids before falling back transparently',async()=>{
  for(const makeBad of [()=>({title:'x',pages:[]}),()=>{const raw=mockNative();raw.pages[0].blocks=[{type:'html',text:'<script>x</script>'}];return raw;},()=>{const raw=mockNative();const m=combatMaterial('deck-optics').pages[4].showcaseLesson;raw.pages[2].interaction=structuredClone(m);raw.pages[2].interaction.moduleConfig.curves[0].expr='globalThis.process()';return raw;}]){
    let calls=0;const r=await generateNativeDeck({course:'统计',topic:'样本均值',pageCount:8},{provider:provider(()=>{calls++;return makeBad();})});assert.equal(calls,2);assert.equal(r.source,'local');assert.equal(r.harnessReceipt.repairs[0].status,'fallback');
  }
});
test('diffraction sandbox equals the analytic integer-N factor, including principal maxima and missing orders',()=>{
  const c=combatMaterial('deck-optics').pages[4].showcaseLesson.moduleConfig;
  const f=compileExpression(c.curves[1].expr,['x','r','N']);
  const value=p=>f.evaluate?f.evaluate(p):f(p);
  for(let N=c.sliders[1].min;N<=c.sliders[1].max;N++)for(const x of [0,.13,.6,1,1.2,2]){
    const r=.5,sinc=z=>z===0?1:Math.sin(Math.PI*z)/(Math.PI*z),factor=Math.abs(x-Math.round(x))<1e-8?1:(Math.sin(N*Math.PI*x)/(N*Math.sin(Math.PI*x)))**2;
    assert(Math.abs(value({x,r,N})-sinc(r*x)**2*factor)<1e-10);
  }
});
test('swap combat simulation models plausible NULL-definition versus dereference misconceptions',()=>{
  const lesson=combatMaterial('deck-c-pointers').pages[6].showcaseLesson;
  let state=reduceRoom(createRoom(),{type:'loadLesson',payload:{lesson}});state=reduceRoom(state,{type:'demoFill'});
  assert.deepEqual(Object.fromEntries(lesson.options.map(o=>[o.id,state.responses.filter(r=>r.optionId===o.id).length])),{S1:0,S2:0,S3:4,S4:5,S5:0,S6:3,S7:0});
});
test('legacy binary PPT import retains every visible original page and native harness compiles alongside it',async()=>{
  const bytes=await readFile(new URL('./fixtures/material-import-basic.ppt',import.meta.url));
  const imported=readLegacySlides(bytes);
  const material={...imported,name:'legacy.ppt',type:'ppt'};
  const before=JSON.stringify(material);const r=await runDeckHarness(material,{pacingMode:'full-demo'});
  assert.equal(JSON.stringify(material),before);assert.deepEqual(r.lectureScore.pages.map(p=>p.number),material.pages.filter(p=>!p.hidden).map(p=>p.number));
});
