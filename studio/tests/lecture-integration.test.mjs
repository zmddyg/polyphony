import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildLectureScore } from '../dist/core/lecture-score.mjs';
import { getLesson } from '../dist/core/catalog.mjs';
import { planLecture } from '../lesson-provider.mjs';

test('model page suggestions require a verbatim reference and a registered activity', async()=>{
  const pages=[{number:2,title:'一阶 RC 电路',text:'记录电容充电时刻的电压。'}];
  const gateway=result=>({model:'test',baseUrl:'https://provider.example/v1',key:'test',outputMode:'json_schema',
    fetchImpl:async(_url,options)=>{
      assert.equal(JSON.parse(options.body).response_format.json_schema.name,'lecture_page_activities');
      return Response.json({choices:[{message:{content:JSON.stringify({suggestions:[result]})}}]});
    }});
  const accepted=await planLecture(pages,gateway({pageNumber:2,kind:'rc',quote:'电容充电'}));
  assert.equal(accepted.source,'provider');assert.equal(accepted.suggestions[0].pageNumber,2);
  for(const result of [{pageNumber:3,kind:'rc',quote:'电容充电'},{pageNumber:2,kind:'unknown',quote:'电容充电'},{pageNumber:2,kind:'rc',quote:'不存在'}]){
    const fallback=await planLecture(pages,gateway(result));assert.equal(fallback.source,'local');assert.equal(fallback.suggestions[0].kind,'rc');
  }
});

test('HTTP and SSE carry an imported binary PPT through teaching, answering, return and restart',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'polyphony-lecture-'));
  const previous=process.env.POLYPHONY_ROOM_FILE;
  const chatModel=process.env.POLYPHONY_AI_MODEL;
  delete process.env.POLYPHONY_AI_MODEL;
  t.after(()=>{if(chatModel!==undefined)process.env.POLYPHONY_AI_MODEL=chatModel;});
  process.env.POLYPHONY_ROOM_FILE=join(dir,'rooms.json');
  const pipe=process.platform==='win32'?'\\\\.\\pipe\\polyphony-'+randomUUID():join(dir,'classroom.sock');
  let server;
  let stream;
  const start=async suffix=>{
    const {serve}=await import('../server.mjs?lecture-'+suffix);
    server=createServer(serve);
    await new Promise((ok,fail)=>server.once('error',fail).listen(pipe,ok));
  };
  const stop=async()=>{stream?.destroy();if(server?.listening)await new Promise(ok=>server.close(ok));};
  t.after(async()=>{await stop();if(previous===undefined)delete process.env.POLYPHONY_ROOM_FILE;else process.env.POLYPHONY_ROOM_FILE=previous;await rm(dir,{recursive:true,force:true});});
  await start('first');
  function http(path,data,cookie,raw=false){
    return new Promise((ok,fail)=>{
      const req=request({socketPath:pipe,path,method:data===undefined?'GET':'POST',agent:false,
        headers:{'content-type':raw?'application/octet-stream':'application/json',...(cookie&&{cookie})}},res=>{
        const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>ok({status:res.statusCode,headers:res.headers,data:JSON.parse(Buffer.concat(chunks))}));
      });req.on('error',fail);req.end(data===undefined?undefined:raw?data:JSON.stringify(data));
    });
  }
  const base=await http('/api/rooms',{demo:false});
  const prep='/api/rooms/'+base.data.room.code;const prepCookie=base.headers['set-cookie'][0].split(';')[0];
  await t.test('dual-source author-deck endpoint requires teacher ownership and returns a verified 8-page native deck',async()=>{
    const spec={course:'C语言',topic:'指针与函数传址',pageCount:8};
    assert.equal((await http(prep+'/author-deck',{spec})).status,403);
    const generated=await http(prep+'/author-deck',{spec},prepCookie);
    assert.equal(generated.status,200);assert.equal(generated.data.lectureScore.pages.length,8);
    assert(generated.data.harnessReceipt.stages.every(s=>s.status==='complete'));
    assert.equal(generated.data.harnessReceipt.dryRuns.length,2);
    assert.equal(generated.data.lectureScore.title,'C语言 · 指针与函数传址');
    assert.equal((await http(prep+'/author-deck',{spec:{...spec,pageCount:30}},prepCookie)).status,400);
  });
  await t.test('a teacher can use Jev page planning without a chat model', async subtest => {
    const previousJev = process.env.POLYPHONY_JEV_KEY;
    process.env.POLYPHONY_JEV_KEY = 'local-test-key';
    subtest.after(() => {
      if (previousJev === undefined) delete process.env.POLYPHONY_JEV_KEY;
      else process.env.POLYPHONY_JEV_KEY = previousJev;
    });
    const status = await http('/api/status');
    assert.equal(status.data.assistedComposition, false);
    assert.equal(status.data.assistedLecturePlanning, true);
    assert.equal(status.data.lecturePlanProvider, 'jev');
    assert.equal(typeof status.data.materialRendering, 'boolean');
    const pages = [{number: 1, title: '双端读数', text: '比较两个端口的功率，并说明相移的影响。'}];
    const remote = subtest.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
      assert.deepEqual(JSON.parse(options.body).state.pages, pages);
      return Response.json({model:'jev-test', usage:{input_tokens:30,output_tokens:10},
        answers:{page_1:{type:'choice',choice:'mzi',confidence:0.96,
          probabilities:{rc:0.01,mzi:0.96,aliasing:0.01,concept:0.01,none:0.01}}}});
    });
    assert.equal((await http(prep+'/lecture-plan', {pages})).status, 403);
    const planned = await http(prep+'/lecture-plan', {pages}, prepCookie);
    assert.equal(planned.status, 200);
    assert.equal(planned.data.source, 'jev');
    assert.deepEqual(planned.data.suggestions.map(x => [x.pageNumber,x.kind]), [[1,'mzi']]);
    assert.equal(remote.mock.callCount(), 1);
  });
  const old=await readFile(new URL('./fixtures/material-import-basic.ppt',import.meta.url));
  assert.equal((await http(prep+'/materials/import?name=old.ppt',old,undefined,true)).status,403);
  const imported=await http(prep+'/materials/import?name=old.ppt',old,prepCookie,true);assert.equal(imported.status,200);
  assert.equal(imported.data.pages.length,2);
  const lecture=buildLectureScore({...imported.data,type:'ppt',versionId:'original-version'},new Map([[1,{slides:[{title:'仅下一屏展示的答案',body:['补充说明']}]}]]),{interactionsByPage:new Map([[1,getLesson('mzi')]])});
  const opened=await http('/api/rooms',{lecture});assert.equal(opened.status,201);
  const url='/api/rooms/'+opened.data.room.code;const cookie=opened.headers['set-cookie'][0].split(';')[0];
  let state=opened.data.room;
  assert.equal(state.lecture.total,3);assert.equal(state.demo,false);
  const student=await http(url+'/session',{role:'student'});const studentCookie=student.headers['set-cookie'][0].split(';')[0];
  const snapshots=[];let pending='';
  await new Promise((ok,fail)=>{
    stream=request({socketPath:pipe,path:url+'/events?role=stage',agent:false},res=>res.on('data',chunk=>{
      pending+=chunk.toString();
      let end;while((end=pending.indexOf('\n\n'))>=0){const block=pending.slice(0,end);pending=pending.slice(end+2);
        const line=block.split('\n').find(row=>row.startsWith('data: '));if(line){snapshots.push(JSON.parse(line.slice(6)));ok();}}
    }));stream.on('error',fail);stream.end();
  });
  const command=async(role,type,extra={},overrides={})=>http(url+'/commands',{role,type,payload:{
    expectedLectureTurn:state.lecture.turn,expectedLectureIndex:state.lecture.index,expectedRound:state.round,expectedLessonId:state.lessonId,...extra,...overrides,
  }},role==='teacher'?cookie:studentCookie);
  const apply=async(type,extra)=>{const result=await command('teacher',type,extra);assert.equal(result.status,200,JSON.stringify(result.data));state=result.data.room;};
  const current=await http(url+'/frame?index=0');assert.match(current.data.title,/test title/i);
  assert.equal((await http(url+'/frame?index=1')).status,409);
  assert.doesNotMatch(JSON.stringify(student.data),/仅下一屏展示的答案|original-version/);
  assert.equal((await command('student','lectureNavigate',{index:1})).status,403);
  await apply('lectureInteract');
  assert.equal((await command('student','join',{name:'测试同学'})).status,200);
  assert.equal((await command('student','respond',{optionId:'dark',reason:'两臂在 A 口相消'})).status,200);
  await apply('reveal');await apply('lectureResume');assert.equal(state.lectureArchive.length,1);
  assert.equal(state.lectureArchive[0].responses[0].lecturePageNumber,1);
  assert.equal(state.lectureArchive[0].responses[0].lectureVersionId,'original-version');
  await apply('lectureNavigate',{index:1});assert.equal((await http(url+'/frame?index=1')).data.title,'仅下一屏展示的答案');
  await apply('lectureNavigate',{index:2});
  assert.equal((await command('teacher','lectureNavigate',{index:0},{expectedLectureIndex:0})).status,400);
  assert.equal((await http(url+'/frame?index=2')).data.pageNumber,2);
  assert.equal((await http(url+'/session',{role:'stage'})).data.room.lectureArchive,undefined);
  await apply('lectureNavigate',{index:0});await apply('lectureInteract');assert.equal(state.responses.length,1);
  await apply('lectureFinish');assert.equal(state.lecture.mode,'ended');assert.equal(state.lectureArchive[0].responses.length,1);
  await stop();await start('restarted');
  const restored=await http(url+'/session',{role:'teacher'},cookie);
  assert.equal(restored.data.room.lecture.mode,'ended');assert.equal((await http(url+'/frame?index=0')).data.title,current.data.title);
  assert(snapshots.some(s=>s.lecture.index===2));assert(snapshots.every(s=>!('lectureArchive' in s)));
});
