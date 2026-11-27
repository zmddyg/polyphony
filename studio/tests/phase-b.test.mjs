import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,reduceRoom} from '../dist/core/engine.mjs';
import {pointerLesson} from '../dist/core/universal-lessons.mjs';
test('pointer demo models beginner confusion and orders flawed / sound reasons correctly',()=>{
 for(const lesson of [pointerLesson,{...pointerLesson,id:'gallery-pointer-audit'}]){
  let room=lesson.id===pointerLesson.id?createRoom({lessonId:lesson.id}):reduceRoom(createRoom(),{type:'loadLesson',payload:{lesson}});
  room=reduceRoom(room,{type:'demoFill'});
  assert.equal(room.responses.length,12);
  const counts=Object.fromEntries(lesson.options.map(o=>[o.id,room.responses.filter(r=>r.optionId===o.id).length]));
  assert.deepEqual(counts,{S1:0,S2:4,S3:5,S4:3,S5:0});
  room=reduceRoom(room,{type:'reveal'});room=reduceRoom(room,{type:'analyze'});
  assert.match(room.analysis.contrastPair[0].quote,/我认为第 2 行/);
  assert.match(room.analysis.contrastPair[1].quote,/首次解引用 NULL/);
  room=reduceRoom(room,{type:'branch',payload:{branchId:lesson.branches[0].id}});
  room=reduceRoom(room,{type:'revise'});room=reduceRoom(room,{type:'demoFill'});
  assert.equal(room.responses.filter(r=>r.round===2&&r.optionId==='S3').length,11);
 }
});
