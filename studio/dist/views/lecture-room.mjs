import { renderLectureFrame } from './lecture-stage.mjs';
import { moduleHtml, bindModule } from './module-renderer.mjs';
import { cognitionReport } from '../core/cognition.mjs';
import { renderChallenge } from './challenge-lab.mjs';

const players=new WeakMap();
const names={'concept-diagnosis@1':'概念诊断','step-fault@1':'逐行找茬','param-explorer@1':'公式沙盒','evidence-weighing@1':'证据权衡'};
const publicPhases=new Set(['reveal','branch','closed']);
const phaseNames={collect:'独立作答',reveal:'本轮结果',branch:'机制讨论',closed:'本页已完成'};
const btn=(action,label,extra='')=>`<button type="button" data-inline-action="${action}" ${extra}>${label}</button>`;

export function lectureTakeaways(state) {
  const cards=new Map((state.lectureTakeaways??[]).map(s=>[s.pageNumber,s]));
  for(const s of state.lectureArchive??[])if(s.phase==='closed')cards.set(s.pageNumber,{pageNumber:s.pageNumber,title:s.lesson.title,...(s.lesson.takeaway??s.lesson.moduleConfig?.takeaway??{})});
  if(state.lecture?.mode==='activity'&&state.phase==='closed')cards.set(state.lecture.pageNumber,{pageNumber:state.lecture.pageNumber,title:state.lesson.title,...(state.lesson.takeaway??state.lesson.moduleConfig?.takeaway??{})});
  return [...cards.values()].sort((a,b)=>a.pageNumber-b.pageNumber);
}
export function takeawayDrawerHtml(state,e) {
  const cards=lectureTakeaways(state).filter(card => card.summary || card.formula || card.pitfall);
  if (!cards.length) return '';
  return `<details class="native-takeaways"><summary>本课速查（${cards.length}）</summary>${cards.map(c => `<article>
    <h3>第 ${c.pageNumber} 页 · ${e(c.title)}</h3><p>${e(c.formula ?? c.summary ?? '')}</p>
    ${c.formula && c.summary ? '<p>'+e(c.summary)+'</p>' : ''}
    ${c.pitfall ? '<p class="takeaway-pitfall">'+e(c.pitfall)+'</p>' : ''}
  </article>`).join('')}</details>`;
}
export function inlineResultsHtml(state,e) {
  const report=cognitionReport(state),published=publicPhases.has(state.phase);
  const responses=(state.responses??[]).filter(r=>r.round===state.round);
  const count=state.responseCount??responses.length,simulated=state.simulatedResponseCount??responses.filter(r=>r.simulated).length;
  let html=`<div class="inline-live-count"><b>${count}</b> 份作答 · 第 ${state.round} 轮${simulated?` <span>含${simulated}份模拟</span>`:''}</div>`;
  if(!published)return html;
  if(state.lesson.activityId!=='step-fault@1')html+=`<div class="inline-distribution">${state.lesson.options.map(o=>{const n=responses.filter(r=>r.optionId===o.id).length;return `<div><span>${e(o.id)} · ${e(o.label)}</span><b>${n}</b><i style="width:${responses.length?n/responses.length*100:0}%"></i></div>`;}).join('')}</div>`;
  const first=state.responses?.filter(r=>r.round===1)??[];
  const correct=state.lesson.correctOptionId;
  const initialWrong=first.find(r=>r.optionId!==correct),initialRight=first.find(r=>r.optionId===correct);
  const pair=state.analysis?.contrastPair??state.firstRoundAnalysis?.contrastPair??state.firstRoundContrastPair??(state.round===2&&correct&&initialWrong?.reason&&initialRight?.reason?[{sideLabel:'首轮直觉 · 待检验',quote:initialWrong.reason},{sideLabel:'首轮机制 · 原页证据',quote:initialRight.reason}]:null);
  if(state.analysis?.summary&&!pair?.length)html+='<p class="inline-analysis-note">'+e(state.analysis.summary)+'</p>';
  if(pair?.length)html+=`<div class="inline-reason-split">${pair.slice(0,2).map((p,i)=>`<article class="reason-${i?'blue':'red'}"><b>${e(p.sideLabel??'理由对照')}</b><p>${e(p.quote)}</p></article>`).join('')}</div>`;
  if(state.round===2)html+=`<div class="inline-paired">${report.paired.changed} / ${report.paired.total} 人改了答案${report.paired.source==='simulated'?'（模拟）':''}${report.secondCorrect!=null?' · 本轮正确率 '+report.secondCorrect+'%':''}</div>`;
  if(state.phase==='closed')html+=`<div class="inline-feedback"><b>${state.lesson.correctOptionId?'本页参考答案：'+e(state.lesson.correctOptionId):'本页没有唯一标准立场'}</b><p>${e(state.lesson.takeaway?.summary??state.lesson.moduleConfig?.takeaway?.summary??'请用证据检验原判断。')}</p></div>`;
  return html;
}
function fullscreen(root,ctx) {
  if(document.fullscreenElement)return document.exitFullscreen().catch(()=>{});
  root.requestFullscreen?.().catch(()=>ctx.toast('浏览器未能进入全屏。'));
}

function presenterControls(ctx, active) {
  const { state, esc } = ctx;
  if (!active) return state.lecture.hasInteraction && state.lecture.mode === 'slides'
    ? btn('interact', '开始互动', 'class="presenter-primary"') : '';
  if (state.phase === 'closed') return '';

  const peer = state.lesson.activityId === 'evidence-weighing@1'
    ? btn('toggleAiPeer', state.aiPeerRevealed ? '收起 AI 辩友' : '展示 AI 辩友') : '';
  if (state.phase === 'collect') {
    return btn('reveal', '公布结果', 'class="presenter-primary"') +
      (ctx.demonstration ? btn('demoFill', '模拟作答') : '') +
      (peer ? `<details class="presenter-more"><summary>更多</summary><div>${peer}</div></details>` : '');
  }

  const branches = state.round === 1 ? state.lesson.branches : [];
  const hasDiscussion = branches.length > 0;
  const discussions = state.phase === 'branch' ? btn('revise','开始第二轮','class="presenter-primary"') :
    hasDiscussion ? btn('discuss','讨论后再答','class="presenter-primary"') : '';
  const choice = hasDiscussion ? `<label>讨论方向<select data-inline-branch>
    ${branches.map(branch => `<option value="${esc(branch.id)}" ${branch.id === (state.decision?.branchId ?? state.analysis?.recommendedId) ? 'selected' : ''}>${esc(branch.title)}</option>`).join('')}
    </select></label>${btn('branch','采用这个方向')}` : '';
  const analysis = (state.responseCount ?? 0) > 0 ? btn('analyze','整理作答理由') : '';
  return discussions + btn('close', '完成本页', discussions ? '' : 'class="presenter-primary"') +
    (choice || analysis || peer ? `<details class="presenter-more"><summary>更多</summary><div>${choice}${analysis}${peer}</div></details>` : '');
}

export function renderLectureRoom(root,ctx,role) {
  const lecture=ctx.state.lecture,teacher=role==='teacher',student=role==='student',e=ctx.esc;
  const remote=teacher&&ctx.remote;
  let entry=players.get(root);
  const key=ctx.state.code+'-'+(remote?'remote':role)+'-'+lecture.index+'-'+(lecture.mode==='ended');
  if(!entry||entry.key!==key||!root.querySelector('[data-native-player]')) {
    entry?.dispose?.();entry?.observer?.disconnect();
    entry={key,ctx,drafts:new Map()};players.set(root,entry);
    root.innerHTML=`<section data-native-player class="native-player native-player--${role}${remote?' native-player--remote':''}">
      <header class="native-player-bar"><div>${role==='stage'?'':'<b>'+e(lecture.title)+'</b>'}
        <p>第 ${lecture.index+1} / ${lecture.total} 页${ctx.demonstration ? ' · 演示课堂' : ''}</p>
        ${remote?'<p class="remote-page-title">'+e(lecture.filmstrip?.[lecture.index]?.title??'')+'</p>':''}
      </div><div>${remote?'<span data-remote-status role="status"></span>':
        (teacher?btn('stage','打开投影')+btn('invite','邀请学生')+
          `<details class="presenter-more"><summary>更多</summary><div>
            ${ctx.remotePair ? btn('remote','手机遥控') : ''}${btn('fullscreen','全屏')}${btn('finish','结束上课')}
          </div></details>` : !student ? btn('fullscreen','全屏') : '')}</div></header>
      <div class="native-canvas ${student?'native-mobile-card':''}" id="${student?'student':'stage'}"><div class="native-layout"><div data-native-slide><p role="status">正在载入课件…</p></div><aside data-inline-widget class="native-inline" hidden aria-label="本页互动"></aside></div></div>
      ${teacher?`<footer class="presenter-dock"><div class="presenter-pager">
        ${btn('previous','上一页',lecture.index===0?'disabled':'')}
        <select data-lecture-page aria-label="跳转到课件页">
          ${Array.from({length:lecture.total}, (_, i) => `<option value="${i}" ${i===lecture.index?'selected':''}>第 ${i+1} 页${lecture.filmstrip?.[i]?.activityId?' · 互动':''}</option>`).join('')}
        </select>
        ${btn('next','下一页',lecture.index===lecture.total-1?'disabled':'')}
      </div><div data-presenter-controls class="presenter-controls"></div></footer>`:''}
      ${student?'<div data-takeaway-drawer></div>':''}</section>`;
    const execute=async(type,payload={})=>{
      if(entry.busy)return null;entry.busy=true;
      try{return await entry.ctx.command(type,payload);}catch(error){entry.ctx.toast(error.message);return null;}finally{entry.busy=false;}
    };
    entry.execute=execute;
    const pageSelect = root.querySelector('[data-lecture-page]');
    if (pageSelect) pageSelect.onchange = async () => {
      const changed = await execute('lectureNavigate',{index:Number(pageSelect.value)});
      if (!changed) pageSelect.value = String(entry.ctx.state.lecture.index);
    };
    root.addEventListener('click',entry.listener=event=>{
      if(players.get(root)!==entry)return;
      const action=event.target.closest('[data-inline-action]')?.dataset.inlineAction;
      if(!action)return;
      const c=entry.ctx,s=c.state,l=s.lecture;
      if(action==='stage')return c.open('stage');
      if(action==='invite')return c.invite();
      if(action==='remote')return c.remotePair?.();
      if(action==='review')return c.go('replay');
      if(action==='fullscreen')return fullscreen(root,c);
      if(action==='previous'||action==='next')return execute('lectureNavigate',{index:l.index+(action==='next'?1:-1)});
      if(action==='finish')return execute('lectureFinish');
      if(action==='interact')return execute('lectureInteract');
      if(action==='discuss')return execute('branch',{branchId:s.analysis?.recommendedId ?? s.lesson.branches[0].id});
      if(action==='branch')return execute('branch',{branchId:root.querySelector('[data-inline-branch]').value});
      if(action==='retry'){entry.failed=false;entry.framePending=false;return loadFrame();}
      if(action==='demoFill'&&!c.demonstration)return;
      if(['demoFill','reveal','analyze','revise','close','toggleAiPeer'].includes(action))return execute(action);
    });
    entry.dispose=()=>root.removeEventListener('click',entry.listener);
  }
  entry.ctx=ctx;
  const command=entry.execute;
  function loadFrame() {
    if(entry.framePending||entry.frameLoaded)return;
    entry.framePending=true;
    ctx.getFrame(lecture.index).then(frame=>{
      if(players.get(root)!==entry||!root.isConnected)return;
      entry.frameLoaded=true;
      renderLectureFrame(root.querySelector('[data-native-slide]'),frame,{compact:student});
      root.querySelector('[data-native-slide]').classList.toggle('has-rich-blocks',Boolean(frame.blocks?.length));
      fitContent();
    }).catch(error=>{
      if(players.get(root)!==entry)return;
      entry.failed=true;root.querySelector('[data-native-slide]').innerHTML='<p role="alert">'+e(error.message)+'</p>'+btn('retry','重新载入');
    });
  }
  function fitContent() {
    if(student)return;
    const slide=root.querySelector('[data-native-slide]'),frame=slide?.firstElementChild;
    if(!frame)return;
    // Code-line voting belongs beside the teaching code, within the same canvas.
    // Preserve the right column for contrasting reasons and paired-round feedback.
    if(!student&&ctx.state.lesson.activityId==='step-fault@1'&&ctx.state.lecture.mode==='activity') {
      const artifact=root.querySelector('[data-inline-widget] .module-artifact');
      const original=frame.querySelector('.slide-code');
      if(artifact&&original){frame.querySelector('[data-inline-step-artifact]')?.remove();original.hidden=true;artifact.dataset.inlineStepArtifact='';original.after(artifact);}
    }
    frame.style.zoom='1';
    const available=slide.clientHeight;
    let frameZoom=1;
    for(let pass=0;pass<5&&available;pass++){const height=frame.getBoundingClientRect().height;if(height<=available-4)break;frameZoom*=(available-4)/height*.97;frame.style.zoom=String(frameZoom);}
    const inline=root.querySelector('[data-inline-widget]'),content=inline?.querySelector('.inline-content');
    if(content&&!inline.hidden){
      content.style.zoom='1';const style=getComputedStyle(inline),space=inline.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom)-8;
      let zoom=1;
      for(let pass=0;pass<5;pass++){const height=content.getBoundingClientRect().height;if(height<=space)break;zoom*=space/height*.97;content.style.zoom=String(zoom);}
    }
  }
  const shell=root.querySelector('[data-native-player]');
  if(lecture.mode==='ended') {
    shell.innerHTML=`<section class="lecture-ended"><h1>本节课已结束</h1><p>${e(lecture.title)}</p>
      ${teacher&&!remote?btn('review','查看复盘','class="action-primary"'):student?takeawayDrawerHtml(ctx.state,e):''}</section>`;
    return;
  }
  if(!remote)loadFrame();
  const active=lecture.mode==='activity',experiment=lecture.mode==='experiment'&&ctx.state.experiment;
  shell.dataset.inlineActivity=active?ctx.state.lesson.activityId:'';
  shell.dataset.lectureMode=lecture.mode;
  shell.dataset.phase=ctx.state.phase;
  if(remote) {
    const count=ctx.state.responseCount??ctx.state.responses.filter(response=>response.round===ctx.state.round).length;
    const label=ctx.connected?'已连接':'正在重连';
    root.querySelector('[data-remote-status]').textContent=active?`${label} · ${count} 份作答`:label;
  }
  root.querySelector('.native-layout').classList.toggle('has-inline-interaction',active||Boolean(experiment));
  const widget=root.querySelector('[data-inline-widget]');widget.hidden=!(active||experiment);
  if(active&&!remote)paintInteraction(widget,entry,role);
  else if(experiment)renderChallenge(widget,ctx.state.experiment,{role,turn:lecture.turn,action:p=>command('lectureExperimentAct',p),vote:choice=>command('experimentVote',{choice}),askPeer:ctx.askPeer,report:ctx.toast});
  const controls=root.querySelector('[data-presenter-controls]');
  if(controls) {
    const html = presenterControls(ctx, active);
    if (html !== entry.controlsHtml) {
      entry.controlsHtml = html;
      const wasOpen = controls.querySelector('details[open]');
      controls.innerHTML = html;
      if (wasOpen && controls.querySelector('details')) controls.querySelector('details').open = true;
    }
  }
  const drawer=root.querySelector('[data-takeaway-drawer]');
  if (drawer) {
    const drawerOpen = drawer.querySelector('details')?.open;
    drawer.innerHTML = takeawayDrawerHtml(ctx.state,e);
    if (drawerOpen && drawer.querySelector('details')) drawer.querySelector('details').open = true;
  }
  if(remote)return;
  // Fit synchronously too: background teacher/stage tabs throttle animation frames.
  fitContent();
  requestAnimationFrame(()=>{if(players.get(root)===entry)fitContent();});
  if(!entry.observer&&typeof ResizeObserver!=='undefined'){entry.observer=new ResizeObserver(fitContent);entry.observer.observe(root.querySelector('.native-canvas'));}
}

function paintInteraction(host,entry,role) {
  const ctx=entry.ctx,{state,esc:e}=ctx,lesson=state.lesson,student=role==='student';
  const participant=state.participants.find(p=>p.id===ctx.participantId),mine=state.responses.find(r=>r.participantId===ctx.participantId&&r.round===state.round);
  const key=lesson.id+'-'+state.round;
  let draft=entry.drafts.get(key);if(!draft){draft={optionId:mine?.optionId??'',reason:mine?.reason??'',name:'',params:null};entry.drafts.set(key,draft);}
  const focused=host.contains(document.activeElement)?document.activeElement:null;
  const focusName=focused?.getAttribute('name'),selection=focused?.selectionStart;
  const signature=JSON.stringify([state.phase,state.round,state.responses,state.responseCount,state.analysis,state.aiPeerRevealed,Boolean(participant),state.decision]);
  if(entry.widgetSignature===signature)return;entry.widgetSignature=signature;
  const collecting=state.phase==='collect';
  const reasons=lesson.quickReasons??lesson.moduleConfig?.quickReasons??[];
  const reasonOpen=host.querySelector('[data-extra-reason]')?.open || focusName==='reason';
  host.innerHTML=`<div class="inline-content"><header class="inline-heading"><span>${e(names[lesson.activityId]??'课堂互动')}</span><b>${phaseNames[state.phase]} · R${state.round}</b></header><p class="inline-prompt">${e(state.revisionPrompt??lesson.prompt)}</p>
    ${moduleHtml(lesson,state,{selectable:student&&collecting&&Boolean(participant),selectedId:draft.optionId})}
    ${!student&&collecting&&lesson.activityId!=='step-fault@1'?'<div class="inline-choice-list">'+lesson.options.map(o=>'<div><b>'+e(o.id)+'</b> '+e(o.label)+'</div>').join('')+'</div>':''}
    ${student&&collecting?participant?`<form data-inline-response><div class="inline-options">${lesson.activityId==='step-fault@1'?'':lesson.options.map(o=>`<label><input type="radio" name="optionId" value="${e(o.id)}" ${draft.optionId===o.id?'checked':''} required><span>${e(o.label)}</span></label>`).join('')}</div>
      ${reasons.length?`<div class="inline-capsules" aria-label="选择理由">${reasons.map((reason,i)=>`<button type="button" data-reason="${i}" aria-pressed="${draft.reason===reason}">${e(reason)}</button>`).join('')}</div>`:''}
      <details data-extra-reason ${reasonOpen||!reasons.length?'open':''}><summary>补充理由</summary><label class="inline-reason"><span class="visually-hidden">你的理由</span><textarea name="reason" rows="2" maxlength="1000">${e(draft.reason)}</textarea></label></details>
      <button class="inline-submit">${mine?'更新答案':'提交'}</button>${mine?'<p class="inline-submitted">已提交，公布前可修改。</p>':''}</form>`
      :`<form data-inline-join><label>课堂显示名<input name="name" value="${e(draft.name)}" required maxlength="48" autocomplete="nickname"></label><button class="inline-submit">加入并作答</button></form>`:''}
    ${student&&collecting?'':inlineResultsHtml(state,e)}${student&&!collecting&&mine?'<p class="inline-my-answer">我的答案 · '+e(mine.optionId)+' · '+e(mine.reason)+'</p>':''}${state.decision?'<p class="inline-branch">讨论方向 · '+e(state.decision.title)+'</p>':''}</div>`;
  bindModule(host,lesson,{command:entry.execute});
  host.querySelectorAll('[data-step-select]').forEach(b=>b.onclick=()=>{draft.optionId=b.dataset.stepSelect;host.querySelectorAll('[data-step-select]').forEach(s=>s.setAttribute('aria-pressed',String(s===b)));});
  host.querySelectorAll('[name=optionId]').forEach(input=>input.onchange=()=>{draft.optionId=input.value;});
  host.querySelector('[name=reason]')?.addEventListener('input',event=>{draft.reason=event.target.value;});
  host.querySelector('[name=name]')?.addEventListener('input',event=>{draft.name=event.target.value;});
  host.querySelectorAll('[data-reason]').forEach(b=>b.onclick=()=>{draft.reason=(lesson.quickReasons??lesson.moduleConfig.quickReasons)[Number(b.dataset.reason)];host.querySelector('[name=reason]').value=draft.reason;host.querySelectorAll('[data-reason]').forEach(c=>c.setAttribute('aria-pressed',String(c===b)));});
  host.onmoduleparamschange=event=>{draft.params=event.detail;};
  if(!entry.paramsBound){host.addEventListener('moduleparamschange',event=>host.onmoduleparamschange?.(event));entry.paramsBound=true;}
  if(draft.params)for(const [symbol,value] of Object.entries(draft.params)){const i=lesson.moduleConfig.sliders?.findIndex(s=>s.symbol===symbol);const input=host.querySelector(`[data-module-slider="${i}"]`);if(input){input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}}
  host.querySelector('[data-inline-response]')?.addEventListener('submit',async event=>{
    event.preventDefault();if(!draft.optionId)return ctx.toast('请先选择一个选项或代码行。');
    const payload={participantId:ctx.participantId,optionId:draft.optionId,reason:draft.reason};
    if(draft.params)payload.reason=(payload.reason+'\n沙盒参数：'+Object.entries(draft.params).map(([k,v])=>k+'='+v).join(', ')).slice(0,1000);
    await entry.execute('respond',payload);
  });
  host.querySelector('[data-inline-join]')?.addEventListener('submit',event=>{event.preventDefault();void entry.execute('join',{participantId:ctx.participantId,name:draft.name});});
  if(focusName){const input=host.querySelector(`[name="${focusName}"]`);input?.focus({preventScroll:true});if(selection!=null&&input?.setSelectionRange&&input.type!=='radio')input.setSelectionRange(selection,selection);}
}

export function lectureKeyboard(event,ctx) {
  const lecture=ctx.state.lecture;
  if(!lecture||lecture.mode==='ended'||event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||document.querySelector('dialog[open]')||event.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
  if(event.key===' '&&event.target?.closest?.('button,a,summary'))return;
  const offsets={ArrowRight:1,PageDown:1,' ':1,ArrowLeft:-1,PageUp:-1};if(!Object.hasOwn(offsets,event.key))return;
  event.preventDefault();if(event.repeat)return;
  const index=lecture.index+offsets[event.key];
  if(index>=0&&index<lecture.total)ctx.command('lectureNavigate',{index}).catch(error=>ctx.toast(error.message));
}
