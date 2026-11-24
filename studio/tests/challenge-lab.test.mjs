import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceChallenge, castVote, fitLight, fullCurveRms, initialSamples, lightAt, newChallenge, presetTarget, publicChallenge, rcReading } from '../dist/core/challenge-lab.mjs';
import { applyRoomCommand, createLectureRoom } from '../dist/core/lecture-room.mjs';
import { buildLectureScore } from '../dist/core/lecture-score.mjs';
import { projectRoom } from '../dist/core/transport.mjs';
import { askExperimentPeer } from '../experiment-peer.mjs';

test('one RC reading eliminates only circuits with different predictions', () => {
  for (const fault of ['r','c']) {
    for (const value of ['early','steady','current']) {
      const state = {...newChallenge('rc'), fault};
      const measured = advanceChallenge(state,{action:'measure',value});
      const observed = value === 'early' ? 5*(1-Math.exp(-1)) : value === 'steady' ? 5 : fault === 'r' ? .25 : .5;
      assert.ok(Math.abs(measured.reading-observed)<1e-12);
      assert.throws(()=>advanceChallenge(measured,{action:'measure',value:'current'}));
      const resolved = advanceChallenge(measured,{action:'diagnose',value:'open'});
      assert.deepEqual(resolved.compatible, value === 'current' ? [fault] : ['r','c']);
      assert.equal(resolved.answer, value === 'current' ? fault : 'open');
      assert.ok(!('fault' in publicChallenge(resolved)));
    }
  }
});

test('the initial three samples cannot distinguish single and double sensitivity; a blind test can', () => {
  const target=presetTarget('double');
  const first=fitLight(target,initialSamples);
  assert.equal(first.order,1);
  assert.ok(first.trainingRms<1e-12);
  assert.equal(lightAt(first,180),0);
  assert.equal(target[12],1);
  const second=fitLight(target,[...initialSamples,12]);
  assert.equal(second.order,2);
  assert.ok(fullCurveRms(second,target)<1e-12);
  const single=presetTarget('single');
  const alternate=fitLight(single,initialSamples);
  assert.equal(alternate.order,first.order);
  assert.equal(alternate.bias,first.bias);
  assert.ok(Math.abs(alternate.gain-first.gain)<1e-12);
  const flat=presetTarget('flat');
  assert.ok(fullCurveRms(fitLight(flat,[...initialSamples,12]), flat)>.1);
  assert.equal(fitLight(Array(24).fill(0),initialSamples).gain,0);
  for (const invalid of [Array(24), Array(24).fill(Infinity), Array(23).fill(1)]) {
    assert.throws(()=>advanceChallenge(newChallenge('light'),{action:'fit',target:invalid}));
  }
});

test('class experiment votes can be revised, survive other votes, and expire at the next decision', () => {
  const score=buildLectureScore({name:'课件',pages:[{number:7,title:'一阶 RC 电路', text:'零初值充电。'}]});
  let state=createLectureRoom('CLAS26',score);
  const send=(type,payload={})=>applyRoomCommand(state,{type,payload:{expectedLectureIndex:0,expectedLectureTurn:state.lecture.turn,...payload}},score);
  state=send('lectureExperimentStart');
  const turn=state.lecture.turn;
  state=send('experimentVote',{participantId:'voter-a',choice:'early'});
  state=send('experimentVote',{participantId:'voter-b',choice:'current'});
  state=send('experimentVote',{participantId:'voter-a',choice:'current'});
  assert.equal(state.lecture.turn,turn);
  assert.equal(castVote(state.experiment,'voter-a','current'),state.experiment);
  for (const role of ['teacher','stage','student']) {
    const visible=projectRoom(state,role,role==='student'?'voter-a':null).experiment;
    assert.deepEqual(visible.counts,{early:0,steady:0,current:2});
    assert.equal(visible.myVote,role==='student'?'current':null);
    assert.ok(!('fault' in visible) && !('votes' in visible));
  }
  state=send('lectureExperimentAct',{action:'measure',value:'early'});
  assert.throws(()=>send('experimentVote',{participantId:'voter-c',choice:'early',expectedLectureTurn:turn}));
  assert.equal(state.lecture.pageNumber,7);
  assert.deepEqual(state.events.at(-1).detail.counts,{early:0,steady:0,current:2});
  state=send('lectureResume');
  assert.equal(state.lecture.mode,'slides');
  assert.equal(state.lecture.pageNumber,7);
  assert.equal(state.experiment,null);
});

test('the language model sees only class evidence and must choose an available option', async () => {
  const state=advanceChallenge({...newChallenge('rc'),fault:'r'},{action:'measure',value:'early'});
  let response={choice:'open',reason:'两台电路的时间常数相同，读数也相同。'};
  const provider={model:'test-peer',key:'test',baseUrl:'https://provider.example/v1',outputMode:'json_schema',
    fetchImpl:async(_url,options)=>{
      const packet=JSON.parse(options.body);
      assert.equal(packet.response_format.json_schema.name,'experiment_peer');
      const data=JSON.parse(packet.messages[1].content);
      assert.equal(data.evidence.reading,rcReading('c','early'));
      assert.ok(!('fault' in data.evidence) && !('votes' in data.evidence));
      return Response.json({choices:[{message:{content:JSON.stringify(response)}}]});
    }};
  assert.deepEqual(await askExperimentPeer(state,provider),response);
  response={choice:'third-fault',reason:'另选一项。'};
  await assert.rejects(()=>askExperimentPeer(state,provider));
});
