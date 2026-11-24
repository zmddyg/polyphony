import { renderLectureFrame } from './lecture-stage.mjs';
import { renderDesk } from './desk.mjs';
import { renderStudent } from './student.mjs';
import { renderStage } from './surfaces.mjs';
import { challengeNames } from '../core/challenge-lab.mjs';
import { challengeForFrame } from '../core/lecture-planner.mjs';
import { renderChallenge } from './challenge-lab.mjs';

const frames=new WeakMap();
const experiments=new WeakMap();
const resultSteps=new Set(['solved','tested','refit']);

function fullscreen(root,ctx) {
  if (document.fullscreenElement) return document.exitFullscreen().catch(()=>{});
  if (!root.requestFullscreen) {ctx.toast('当前浏览器没有提供全屏功能。');return;}
  root.requestFullscreen().catch(()=>ctx.toast('浏览器未能进入全屏。'));
}

export function renderLectureRoom(root,ctx,role) {
  const lecture=ctx.state.lecture;
  const teacher=role==='teacher';
  const {esc,icon}=ctx;
  const button=(action,label,glyph,extra='')=>'<button type="button" data-lecture-action="'+action+'" class="plain-button" '+extra+'>'+icon(glyph,17)+'<span>'+esc(label)+'</span></button>';
  async function command(type,payload,current=ctx) {
    try {return await current.command(type,payload);}
    catch(error){current.toast(error.message);return null;}
  }
  if (lecture.mode === 'experiment' && ctx.state.experiment) {
    const scope=ctx.state.code+'-'+role;
    let experiment=experiments.get(root.firstElementChild);
    if (!experiment || experiment.scope!==scope) {
      root.innerHTML='<section class="cx-live"><header class="lecture-backbar"><span data-experiment-anchor></span>'+
        (teacher?'<div class="lecture-bar-actions">'+button('stage','打开投影','monitor')+button('invite','邀请学生','users')+button('resume','返回讲义','arrow-left')+'</div>':'')+
        '</header><div data-lecture-challenge></div></section>';
      experiment={scope,holder:root.querySelector('[data-lecture-challenge]'),
        anchor:root.querySelector('[data-experiment-anchor]')};
      if (teacher) {
        root.querySelector('[data-lecture-action="resume"]').onclick=()=>command('lectureResume',undefined,experiment.ctx);
        root.querySelector('[data-lecture-action="stage"]').onclick=()=>experiment.ctx.open('stage');
        root.querySelector('[data-lecture-action="invite"]').onclick=()=>experiment.ctx.invite();
      }
      experiments.set(root.firstElementChild,experiment);
    }
    experiment.ctx=ctx;
    const anchor=lecture.title+' · 原稿第 '+lecture.pageNumber+' 页';
    if (experiment.anchor.textContent!==anchor) experiment.anchor.textContent=anchor;
    const challenge=ctx.state.experiment;
    const resultKey=resultSteps.has(challenge.step) ? `${lecture.index}-${lecture.turn}-${challenge.step}` : null;
    if (resultKey!==null && experiment.resultKey===resultKey) return;
    renderChallenge(experiment.holder, challenge, {
      role, turn:lecture.turn, action:payload=>command('lectureExperimentAct',payload),
      vote:choice=>command('experimentVote',{choice}), askPeer:ctx.askPeer, report:ctx.toast,
    });
    experiment.resultKey=resultKey;
    return;
  }
  if (lecture.mode==='activity') {
    if (!teacher) return role==='student'?renderStudent(root,ctx):renderStage(root,ctx);
    if (!root.querySelector('[data-lecture-activity]')) {
      root.innerHTML='<div class="lecture-backbar">'+button('resume','返回讲义','arrow-left')+'<span data-activity-anchor></span></div><div data-lecture-activity></div>';
    }
    root.querySelector('[data-activity-anchor]').textContent='原稿第 '+lecture.pageNumber+' 页';
    root.querySelector('[data-lecture-action="resume"]').onclick=()=>command('lectureResume');
    return renderDesk(root.querySelector('[data-lecture-activity]'),ctx);
  }
  if (lecture.mode==='ended') {
    root.innerHTML='<section class="lecture-ended"><h1>本节课已结束</h1><p>'+esc(lecture.title)+'</p>'+
      (teacher?button('review','查看课堂回顾','replay')+button('materials','回到讲义备课','book'):'')+'</section>';
    if(teacher) {
      root.querySelector('[data-lecture-action="review"]').onclick=()=>ctx.go('replay');
      root.querySelector('[data-lecture-action="materials"]').onclick=()=>ctx.go('materials');
    }
    return;
  }
  const key=ctx.state.code+'-'+lecture.index+'-'+role;
  const remembered=frames.get(root);
  if (remembered?.key===key && root.querySelector('[data-lecture-frame]') && !remembered.failed) return;
  const entry={key};
  frames.set(root,entry);
  root.innerHTML='<div class="lecture-room lecture-room--'+role+'"><header class="lecture-room-bar"><div><b>'+esc(lecture.title)+'</b>'+
    '<span>原稿第 '+lecture.pageNumber+' 页'+(lecture.supplemental?' · 补充讲解':'')+'　'+(lecture.index+1)+' / '+lecture.total+'</span></div><div class="lecture-bar-actions">'+
    (teacher?button('stage','打开投影','monitor')+button('invite','邀请学生','users'):'')+
    (role!=='student'?button('fullscreen','全屏','maximize'):'')+'</div></header>'+
    '<div data-lecture-frame aria-live="polite"><p role="status">正在载入授课页…</p></div>'+
    (teacher?'<footer class="lecture-pager">'+button('previous','上一页','arrow-left',lecture.index===0?'disabled':'')+
      button('next','下一页','arrow-right',lecture.index===lecture.total-1?'disabled':'')+
      (lecture.hasInteraction?button('interact',ctx.state.lectureArchive?.some(item=>item.pageNumber===lecture.pageNumber && item.phase==='closed')?'查看本页互动记录':'开启本页互动','users'):'')+
      button('experiment','开启本页实验','target','hidden')+
      button('finish','结束授课','check')+'</footer>':'')+'</div>';
  const holder=root.querySelector('[data-lecture-frame]');
  ctx.getFrame(lecture.index).then(frame=>{
    if(!holder.isConnected || frames.get(root)!==entry) return;
    renderLectureFrame(holder,frame,{compact:role==='student'});
    const experiment=root.querySelector('[data-lecture-action="experiment"]');
    const kind=teacher && challengeForFrame(frame);
    if (experiment && kind) {
      experiment.querySelector('span').textContent=challengeNames[kind];
      experiment.hidden=false;
      experiment.onclick=()=>command('lectureExperimentStart');
    }
  }).catch(error=>{
    if(!holder.isConnected || frames.get(root)!==entry) return;
    entry.failed=true;holder.innerHTML='<p role="alert">'+esc(error.message)+'</p>'+button('retry','重新载入','replay');
    holder.querySelector('button').onclick=()=>renderLectureRoom(root,ctx,role);
  });
  const next=(index)=>{if(index>=0 && index<lecture.total && index!==lecture.index) return command('lectureNavigate',{index});};
  root.querySelector('[data-lecture-action="fullscreen"]')?.addEventListener('click',()=>fullscreen(root,ctx));
  if(!teacher) return;
  root.querySelector('[data-lecture-action="next"]').onclick=()=>next(lecture.index+1);
  root.querySelector('[data-lecture-action="previous"]').onclick=()=>next(lecture.index-1);
  root.querySelector('[data-lecture-action="stage"]').onclick=()=>ctx.open('stage');
  root.querySelector('[data-lecture-action="invite"]').onclick=ctx.invite;
  const interaction=root.querySelector('[data-lecture-action="interact"]');
  if(interaction) interaction.onclick=()=>ctx.state.lectureArchive?.some(item=>item.pageNumber===lecture.pageNumber && item.phase==='closed')?ctx.go('replay'):command('lectureInteract');
  root.querySelector('[data-lecture-action="finish"]').onclick=async()=>{
    if(window.confirm('结束这节讲义课并保存课堂回顾？')) await command('lectureFinish');
  };
}

export function lectureKeyboard(event,ctx) {
  const lecture=ctx.state.lecture;
  if (lecture?.mode!=='slides' || event.defaultPrevented || event.altKey||event.ctrlKey||event.metaKey ||
      document.querySelector('dialog[open]') || event.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
  if (event.key===' ' && event.target?.closest?.('button,a,summary')) return;
  const offsets={ArrowRight:1,PageDown:1,' ':1,ArrowLeft:-1,PageUp:-1};
  if(!Object.hasOwn(offsets,event.key)) return;
  event.preventDefault();
  if(event.repeat) return;
  const index=lecture.index+offsets[event.key];
  if(index>=0 && index<lecture.total) ctx.command('lectureNavigate',{index}).catch(error=>ctx.toast(error.message));
}
