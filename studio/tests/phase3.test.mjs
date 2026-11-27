import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, reduceRoom } from '../dist/core/engine.mjs';
import { projectRoom } from '../dist/core/transport.mjs';
import { cognitionReport, pairedRevisions, roundTallies } from '../dist/core/cognition.mjs';
import { renderContrastWall, renderCognitionReport } from '../dist/views/cognition.mjs';
import { takeawayCard } from '../dist/views/student.mjs';
import { rcComparisonGraphic } from '../dist/views/challenge-lab.mjs';
import { esc } from '../dist/ui.mjs';

const send=(s,type,payload={})=>reduceRoom(s,{type,payload});
function secondRound() {
  let s=createRoom({lessonId:'mzi',demo:true});
  s=send(s,'reveal');s=send(s,'branch',{branchId:'phase'});s=send(s,'revise');
  return send(send(s,'demoFill'),'reveal');
}
test('published projection whitelists and redacts identities inside diagnosis prose, not just keys',()=>{
  let s=createRoom({lessonId:'mzi',demo:true});
  s.participants.push({id:'internal-user-secret',name:'张三秘密'});
  s.responses.push({id:'internal-response-secret',participantId:'internal-user-secret',round:1,optionId:'dark',reason:'张三秘密说内部编号 internal-user-secret'});
  s.analysis={headline:'张三秘密的解释',summary:'internal-user-secret internal-response-secret',source:'local',evidence:[{responseId:'internal-response-secret'}],contrastPair:[
    {sideLabel:'张三秘密',tone:'alert',quote:'我是张三秘密：internal-user-secret internal-response-secret',participantId:'internal-user-secret',responseId:'internal-response-secret'},
    {sideLabel:'机制核验',tone:'insight',quote:'cos 展开是偶函数',name:'张三秘密'}, {quote:'禁止第三条'}]};
  for (const phase of ['reveal','branch','closed']) for(const role of ['stage','student']) {
    const p=projectRoom({...s,phase},role,null), text=JSON.stringify(p);
    for(const secret of ['张三秘密','internal-user-secret','internal-response-secret'])assert.ok(!text.includes(secret));
    assert.equal(p.analysis.contrastPair.length,2);
    assert.deepEqual(Object.keys(p.analysis.contrastPair[0]).sort(),['quote','sideLabel','tone']);
    assert.deepEqual(p.round1Tallies,roundTallies(s,1));
  }
  const blind=projectRoom(s,'stage',null);
  assert.equal(blind.analysis,null);assert.equal(blind.round1Tallies,undefined);assert.equal(blind.pairedRevisions,undefined);
  assert.doesNotMatch(JSON.stringify(projectRoom({...s,phase:'reveal'},'stage','internal-user-secret')),/张三秘密|internal-user-secret|internal-response-secret/);
});
test('two-round public counts are exact and paired correction survives anonymity',()=>{
  const s=secondRound(), p=projectRoom(s,'stage',null), r=cognitionReport(p);
  assert.equal(r.first.total,12);assert.equal(r.second.total,12);
  assert.equal(r.second.counts.dark,11);assert.equal(r.secondCorrect,92);
  assert.deepEqual(p.pairedRevisions,pairedRevisions(s));
  assert.equal(r.revisionPercent,Math.round(pairedRevisions(s).changed/12*100));
  assert.match(renderCognitionReport(p,esc),/两轮认知跃迁战报/);
  assert.match(renderCognitionReport(p,esc),/92%/);
  assert.equal(renderCognitionReport({...p,phase:'collect'},esc),'');
  const unknown=cognitionReport({...s,lessonId:'my-own-course'});assert.equal(unknown.firstCorrect,null);
});
test('equal distributions never masquerade as zero individual revisions, and live pairs stay separate',()=>{
  const s=createRoom({lessonId:'mzi'});s.responses=[
    {participantId:'one',round:1,optionId:'dark',simulated:false}, {participantId:'two',round:1,optionId:'valley',simulated:false},
    {participantId:'one',round:2,optionId:'valley',simulated:false},{participantId:'two',round:2,optionId:'dark',simulated:false},
    {participantId:'demo',round:1,optionId:'dark',simulated:true},{participantId:'demo',round:2,optionId:'dark',simulated:true}];
  assert.deepEqual(pairedRevisions(s),{total:2,changed:2,source:'live'});
});
test('contrast wall appears on first-round reveal and branch with escaped quotes',()=>{
  const state={round:1,phase:'reveal',analysis:{headline:'诊断',contrastPair:[{tone:'alert',quote:'<img onerror=bad>',sideLabel:'误区'},{tone:'insight',quote:'二次项',sideLabel:'机制'}]}};
  assert.match(renderContrastWall(state,esc),/&lt;img/);assert.doesNotMatch(renderContrastWall(state,esc),/<img/);
  assert.ok(renderContrastWall({...state,phase:'branch'},esc));
  assert.equal(renderContrastWall({...state,phase:'collect'},esc),'');
  assert.equal(renderContrastWall({...state,analysis:null},esc),'');
});
test('closed takeaway preserves only semantic subscripts and each student own progression',()=>{
  const s={...secondRound(),phase:'closed'};
  const id=s.participants[0].id;
  const html=takeawayCard(s,id,esc);
  assert.match(html,/本页考前速查卡/);assert.match(html,/<sub>A<\/sub>/);assert.match(html,/第 1 轮/);assert.match(html,/第 2 轮/);
  const unsafe={...s,lesson:{...s.lesson,takeaway:{formula:'V<sub>0</sub><script>bad()</script>',pitfall:'<img>'}}};
  assert.doesNotMatch(takeawayCard(unsafe,id,esc),/<script>|<img>/);
  assert.equal(takeawayCard({...s,phase:'reveal'},id,esc),'');
});
test('RC reveal includes two SVG canvases with overlapping voltage paths and split current origins',()=>{
  const html=rcComparisonGraphic();assert.equal((html.match(/<svg /g)??[]).length,2);
  assert.match(html,/波特图（简并重合）/);assert.match(html,/0.50 mA/);assert.match(html,/0.25 mA/);
  const curves=[...html.matchAll(/class="cx-measured-[cr]" d="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(curves[0],curves[1]);assert.equal(curves[2],curves[3]);assert.notEqual(curves[4],curves[5]);
});
