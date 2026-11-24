import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { buildLectureScore } from '../dist/core/lecture-score.mjs';

async function request(serve, path, body, cookie) {
  const req = Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []), {
    url: path,
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(cookie && { cookie }) },
    socket: {},
  });
  const res = {
    headers: new Headers(),
    setHeader(name, value) { this.headers.set(name, value); },
    writeHead(status, headers) {
      this.status = status;
      this.headersSent = true;
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    },
    end(payload) { this.payload = payload; },
  };
  await serve(req, res);
  return new Response(res.payload, { status: res.status, headers: res.headers });
}

test('classroom analysis uses the configured gateway and keeps invalid citations out', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'polyphony-analysis-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const received = [];
  let invalidEvidence = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const outbound = JSON.parse(options.body);
    received.push({ path: url.pathname, outbound });
    const { evidence, branches } = JSON.parse(outbound.messages.find(message => message.role === 'user').content);
    const result = {
      evidence: [{ id: invalidEvidence ? 'missing-evidence' : evidence[0].id }],
      recommendedId: branches.at(-1).id,
    };
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] });
  });
  const overrides = {
    POLYPHONY_AI_BASE_URL: 'https://provider.example/v1',
    POLYPHONY_AI_MODEL: 'contract-test',
    POLYPHONY_AI_KEY: 'fixture-key',
    POLYPHONY_AI_OUTPUT_MODE: 'json_schema',
    POLYPHONY_ROOM_FILE: join(dir, 'rooms.json'),
  };
  const original = Object.fromEntries(Object.keys(overrides).map(name => [name, process.env[name]]));
  let serve;
  try {
    Object.assign(process.env, overrides);
    ({ serve } = await import('../server.mjs'));
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  const post = (path, body, cookie) => request(serve, path, body, cookie);
  const status = await (await request(serve, '/api/status')).json();
  assert.equal(status.aiOutputMode, 'json_schema');
  assert.equal(status.assistedComposition, true);
  assert.equal(status.assistedAnalysis, true);
  assert.doesNotMatch(JSON.stringify(status), /fixture-key|contract-test/);

  const opened = await post('/api/rooms', { demo: true, lessonId: 'mzi' });
  assert.equal(opened.status, 201);
  const cookie = opened.headers.get('set-cookie').split(';', 1)[0];
  const { room } = await opened.json();
  const commands = '/api/rooms/' + room.code + '/commands';
  const send = async type => {
    const response = await post(commands, { role: 'teacher', type }, cookie);
    assert.equal(response.status, 200);
    return (await response.json()).room;
  };
  assert.equal((await send('reveal')).phase, 'reveal');
  const assisted = await send('analyze');
  assert.equal(assisted.analysis.source, 'provider');
  assert.equal(assisted.decision, null);
  assert.equal(received[0].path, '/v1/chat/completions');
  assert.equal(received[0].outbound.response_format.json_schema.name, 'classroom_evidence');
  assert.equal(received[0].outbound.response_format.json_schema.strict, true);

  invalidEvidence = true;
  const fallback = await send('analyze');
  assert.equal(fallback.analysis.source, 'local');
  assert.doesNotMatch(JSON.stringify(fallback.analysis), /missing-evidence/);
  assert.equal(received.length, 2);
});

test('a shared experiment preserves live votes during a model request and discards late replies', async t => {
  const dir=await mkdtemp(join(tmpdir(),'polyphony-peer-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let started=Promise.withResolvers(), answer=Promise.withResolvers(), calls=0;
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    const data=JSON.parse(options.body);
    assert.equal(data.response_format.json_schema.name,'experiment_peer');
    calls++;
    started.resolve();
    return Response.json({choices:[{message:{content:JSON.stringify(await answer.promise)}}]});
  });
  const env={POLYPHONY_AI_BASE_URL:'https://provider.example/v1',POLYPHONY_AI_MODEL:'peer-test',
    POLYPHONY_AI_KEY:'test-key',POLYPHONY_AI_OUTPUT_MODE:'json_schema',POLYPHONY_ROOM_FILE:join(dir,'room.json')};
  const before=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));
  let serve;
  try {
    Object.assign(process.env,env);
    ({serve}=await import('../server.mjs?experiment-test'));
  } finally {
    for (const [key,value] of Object.entries(before)) {
      if (value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
  const score=buildLectureScore({name:'实验课',pages:[{number:1,title:'一阶 RC 电路',text:'一次测量。'}]});
  const opened=await request(serve,'/api/rooms',{lecture:score});
  let room=(await opened.json()).room;
  const path='/api/rooms/'+room.code+'/';
  const cookie=response=>response.headers.get('set-cookie').split(';',1)[0];
  const owner=cookie(opened);
  const students=await Promise.all([1,2].map(()=>request(serve,path+'session',{role:'student'}).then(cookie)));
  const control=(role,token,type,payload={})=>request(serve,path+'commands',{role,type,
    payload:{expectedLectureIndex:room.lecture.index,expectedLectureTurn:room.lecture.turn,...payload}},token);
  room=(await (await control('teacher',owner,'lectureExperimentStart')).json()).room;
  const peer=()=>request(serve,path+'experiment-peer',{turn:room.lecture.turn,index:room.lecture.index},owner);
  const a=peer(), b=peer();
  await started.promise;
  for (const student of students) {
    const result=await control('student',student,'experimentVote',{choice:'early'});
    assert.equal(result.status,200);
  }
  answer.resolve({choice:'current',reason:'初始电流可以区分这两个电阻值。'});
  for(const result of await Promise.all([a,b])) {
    assert.equal(result.status,200);
    room=(await result.json()).room;
    assert.equal(room.experiment.counts.early,2);
    assert.equal(room.experiment.peer.choice,'current');
  }
  assert.equal(calls,1);
  const stage=(await (await request(serve,path+'session',{role:'stage'})).json()).room;
  assert.equal(stage.experiment.peer.choice,'current');
  room=(await (await control('teacher',owner,'lectureExperimentAct',{action:'measure',value:'early'})).json()).room;
  assert.equal(room.experiment.peer,null);
  started=Promise.withResolvers(); answer=Promise.withResolvers();
  const late=peer();
  await started.promise;
  room=(await (await control('teacher',owner,'lectureResume')).json()).room;
  answer.resolve({choice:'open',reason:'两个候选给出相同读数。'});
  assert.equal((await late).status,409);
  assert.equal(room.lecture.mode,'slides');
  assert.equal(room.experiment,null);
});
