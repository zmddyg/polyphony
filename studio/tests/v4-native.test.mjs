import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {COMBAT_DECKS,combatMaterial} from '../demo/combat-decks.mjs';
import {COURSE_BLUEPRINT_SCHEMA,planCourseBlueprint} from '../dist/core/course-agent.mjs';
import {runDeckHarness,generateNativeDeck,createPageModule,NATIVE_DECK_SCHEMA,HARNESS_LESSON_SCHEMA} from '../dist/core/deck-harness.mjs';
import {validateLectureScore,buildLectureScore,lectureFrame,validateSlideBlocks} from '../dist/core/lecture-score.mjs';
import {createLectureRoom,applyRoomCommand} from '../dist/core/lecture-room.mjs';
import {projectRoom} from '../dist/core/transport.mjs';
import {takeawayDrawerHtml,inlineResultsHtml,lectureKeyboard} from '../dist/views/lecture-room.mjs';
import {renderLectureFrame} from '../dist/views/lecture-stage.mjs';
import {compileExpression} from '../dist/core/safe-expr.mjs';
import {readLegacySlides} from '../dist/core/legacy-ppt.mjs';
import {esc} from '../dist/ui.mjs';
import {createRoom,reduceRoom} from '../dist/core/engine.mjs';
import {authoredPage, modelReply, modelRequest} from './support/course-model.mjs';

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
  await assert.rejects(generateNativeDeck({course:'',topic:'x'}),/填写/);await assert.rejects(generateNativeDeck({course:'x',topic:'y',pageCount:49}),/6–48/);
});

const authoringSpec = { course: '统计', topic: '样本均值', pageCount: 8 };
const fixtureKey = 'private-fixture-key';
const testConcept = 'concept-diagnosis@1';

function lessonFor(input) {
  return createPageModule({
    number: input.pageNumber, title: input.title, text: input.materials.map(item => item.text).join('\n'),
  }, testConcept);
}

function courseProvider(blueprint, handler, outputMode = 'json_schema') {
  return {
    baseUrl: 'https://fixture.example/v1', model: 'mock', key: fixtureKey, outputMode,
    async fetchImpl(_url, request) {
      const body = JSON.parse(request.body);
      const { name, input } = modelRequest(body);
      if (name === 'course_blueprint' || name === 'online_lesson_module') {
        const schema = name === 'course_blueprint' ? structuredClone(COURSE_BLUEPRINT_SCHEMA) : HARNESS_LESSON_SCHEMA;
        if (name === 'course_blueprint') Object.assign(schema.properties.pagePlans, {
          minItems: authoringSpec.pageCount, maxItems: authoringSpec.pageCount,
        });
        assert.deepEqual(input.schema, schema);
        assert.equal(body.response_format.type, outputMode);
        if (outputMode === 'json_schema') assert.deepEqual(body.response_format.json_schema.schema, schema);
      }
      const proposal = handler?.(name, input, body);
      if (proposal) return modelReply(proposal);
      if (name === 'course_blueprint') return modelReply(blueprint);
      if (name === 'course_slide_batch') return modelReply({ pages: input.pagePlans.map(plan => authoredPage(plan)) });
      if (name === 'course_checkpoint_triage') return modelReply({
        checkpoints: [3, 6].map(pageNumber => ({ pageNumber, activityId: testConcept })),
      });
      if (name === 'course_review') return modelReply({ done: true });
      assert.equal(name, 'online_lesson_module');
      return modelReply(lessonFor(input));
    },
  };
}

test('course blueprint repairs once and completed page blocks anchor deterministic interaction evidence', async () => {
  const blueprint = await planCourseBlueprint(authoringSpec);
  let blueprints = 0, interactions = 0;
  const provider = courseProvider(blueprint, (name, input, body) => {
    if (name === 'course_blueprint') {
      if (++blueprints === 1) return { ...blueprint, pagePlans: [] };
      assert.match(body.messages.at(-1).content, /页数/u);
    }
    if (name === 'online_lesson_module') {
      interactions++;
      assert(input.materials.every((item, index) => item.id === 'M' + (index + 1)));
    }
  });
  const result = await generateNativeDeck(authoringSpec, { provider });
  assert.equal(blueprints, 2);
  assert.equal(interactions, 2);
  assert.equal(result.source, 'provider');
  assert(result.harnessReceipt.repairs.some(repair => repair.status === 'repaired'));
  assert.equal(result.harnessReceipt.dryRuns.length, 2);
  assert.equal(NATIVE_DECK_SCHEMA.properties.pages.items.properties.interaction.anyOf.length, 2);
  assert(!JSON.stringify(result).includes(fixtureKey));
});

test('one failed interaction leaves all model blocks, notes and the valid interaction intact', async () => {
  const blueprint = await planCourseBlueprint(authoringSpec);
  const expected = blueprint.pagePlans.map(plan => authoredPage(plan));
  let invalid = 0, repairRequested = false;
  const repairCalls = [];
  const provider = courseProvider(blueprint, (name, input) => {
    if (repairRequested) repairCalls.push([name, input.pageNumber]);
    if (name !== 'online_lesson_module') return;
    const valid = lessonFor(input);
    if (input.pageNumber === 3 && !repairRequested) {
      invalid++;
      return { ...valid, evidenceIds: ['M99'] };
    }
    return { ...valid, title: '保留的模型互动' };
  });
  const result = await generateNativeDeck(authoringSpec, { provider });
  assert.equal(invalid, 2);
  assert.equal(result.source, 'provider');
  assert.equal(result.lectureScore.pages[2].interaction, undefined);
  assert(result.harnessReceipt.failures.some(failure =>
    failure.pageNumbers.includes(3) && /M99/u.test(failure.reason)));
  assert.equal(result.lectureScore.pages[5].interaction.title, '保留的模型互动');
  result.lectureScore.pages.forEach((page, index) => {
    assert.deepEqual(page.blocks, expected[index].blocks);
    assert.equal(page.speakerNotes, expected[index].speakerNotes);
  });
  repairRequested = true;
  const repaired = await generateNativeDeck(authoringSpec, {
    provider, retry: { ...result.retry, lectureScore: result.lectureScore, pageNumbers: [3] },
  });
  assert.deepEqual(repairCalls, [['online_lesson_module', 3]]);
  assert.deepEqual(repaired.harnessReceipt.failures, []);
  assert(repaired.lectureScore.pages[2].interaction);
  assert.deepEqual(repaired.lectureScore.pages[5].interaction, result.lectureScore.pages[5].interaction);
});

test('JSON-object gateways receive blueprint and interaction schemas in their respective prompts', async () => {
  const blueprint = await planCourseBlueprint(authoringSpec);
  const seen = [];
  const provider = courseProvider(blueprint, (name, _input, body) => {
    seen.push(name);
    if (body.tools) assert.equal(body.response_format, undefined);
    else {
      assert.equal(body.response_format.type, 'json_object');
      assert(body.messages.some(message => /json/iu.test(message.content)));
    }
  }, 'json_object');
  const result = await generateNativeDeck(authoringSpec, { provider });
  assert.equal(result.source, 'provider');
  assert(seen.includes('course_blueprint') && seen.includes('course_slide_batch') && seen.includes('online_lesson_module'));
  assert.deepEqual(result.harnessReceipt.failures, []);
});

test('both authoring stages reject credentials before exporting content or failure receipts', async () => {
  const blueprint = await planCourseBlueprint(authoringSpec);
  const rejected = await generateNativeDeck(authoringSpec, {
    provider: courseProvider({ ...blueprint, title: fixtureKey }),
  });
  assert.equal(rejected.lectureScore, null);
  assert(!JSON.stringify(rejected).includes(fixtureKey));
  const authored = await generateNativeDeck(authoringSpec, {
    provider: courseProvider(blueprint, (name, input) => {
      if (name === 'online_lesson_module') return { ...lessonFor(input), title: fixtureKey };
    }),
  });
  assert.equal(authored.source, 'provider');
  assert.equal(authored.lectureScore.pages.length, 8);
  assert.equal(authored.lectureScore.pages.filter(page => page.interaction).length, 0);
  assert(!JSON.stringify(authored).includes(fixtureKey));
});

test('invalid blueprint and authored blocks are surfaced without a substituted local deck', async () => {
  const blueprint = await planCourseBlueprint(authoringSpec);
  let blueprintRequests = 0;
  const rejected = await generateNativeDeck(authoringSpec, {
    provider: courseProvider(blueprint, name => {
      if (name !== 'course_blueprint') return;
      blueprintRequests++;
      return { ...blueprint, pagePlans: [] };
    }),
  });
  assert.equal(blueprintRequests, 2);
  assert.equal(rejected.lectureScore, null);
  assert(rejected.harnessReceipt.failures.length);
  const partial = await generateNativeDeck(authoringSpec, {
    provider: courseProvider(blueprint, (name, input) => {
      if (name !== 'course_slide_batch' || input.pagePlans[0].pageNumber !== 1) return;
      const pages = input.pagePlans.map(plan => authoredPage(plan));
      pages[0].blocks = [{ type: 'html', text: '<script>x</script>' }];
      return { pages };
    }),
  });
  assert.equal(partial.lectureScore.pages.length, 7);
  assert(partial.lectureScore.pages.every(page => page.number > 1));
  assert(partial.harnessReceipt.failures.some(failure => failure.pageNumbers.includes(1)));
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
