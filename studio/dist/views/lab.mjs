import { MODULE_MANIFESTS } from '../core/activities.mjs';
import { spaceLesson,pointerLesson,gaussianLesson,diffractionLesson,mzmLesson,ethicsLesson } from '../core/universal-lessons.mjs';
import { createRoom,reduceRoom } from '../core/engine.mjs';
import { moduleHtml,bindModule } from './module-renderer.mjs';
import { renderContrastWall,renderCognitionReport } from './cognition.mjs';
const names=['01 双轮概念对撞','02 推导/代码找茬','03 声明式公式沙盒','04 方案权衡与AI质询'];
const examples=[spaceLesson,pointerLesson,gaussianLesson,ethicsLesson];
export function renderLab(root,ctx) {
  let index=Math.max(0,MODULE_MANIFESTS.findIndex(m=>m.id===ctx.tab)),subject=0,lesson,state,clean,selectedOption=null,selectedReason=null,currentParams={},architectureOpen=false;
  const initialize=()=>{selectedOption=null;selectedReason=null;currentParams={};lesson=index===2?[gaussianLesson,diffractionLesson,mzmLesson][subject]:examples[index];state=reduceRoom(createRoom(),{type:'loadLesson',payload:{lesson:{...lesson,id:'gallery-'+lesson.id}}});state=reduceRoom(state,{type:'demoFill'});};
  function protocol() {
    const config=structuredClone(lesson.moduleConfig);
    if(config.sliders)config.sliders=config.sliders.map(s=>({...s,defaultValue:currentParams[s.symbol]??s.defaultValue}));
    return {activityId:lesson.activityId,correctOptionId:lesson.correctOptionId,moduleConfig:config};
  }
  function paint() {
    clean?.();const m=MODULE_MANIFESTS[index],e=ctx.esc,preview={...lesson,moduleConfig:protocol().moduleConfig};
    root.innerHTML=`<section class="v3-gallery"><header class="v3-page-heading"><div><h1>交互模组库</h1><p>一套声明式协议，连接不同学科的课堂卡点。</p></div><button class="v3-primary" data-bring>带入当前课堂 ↗</button></header><nav class="v3-module-tabs" aria-label="四种交互模块">${MODULE_MANIFESTS.map((m,i)=>`<button data-module-tab="${i}" aria-pressed="${i===index}">${names[i]}</button>`).join('')}</nav><div class="v3-gallery-grid"><section class="v3-sandbox"><header><span>${e(m.category)}</span><h2>${e(lesson.title)}</h2><p>${e(lesson.prompt)}</p></header>${index===2?`<div class="v3-subjects">${['傅里叶高斯波包','单缝夫琅禾费衍射','非理想 MZM 干涉'].map((name,i)=>`<button data-subject="${i}" aria-pressed="${subject===i}">${name}</button>`).join('')}</div>`:''}<div data-live-module>${moduleHtml(preview,state,{teacher:true,selectable:state.phase==='collect',selectedId:selectedOption})}</div><div class="v3-sandbox-options">${lesson.options.map(o=>{const count=state.responses.filter(r=>r.round===state.round&&r.optionId===o.id).length;return `<button data-vote="${e(o.id)}" aria-pressed="${selectedOption===o.id}" ${state.phase!=='collect'?'disabled':''}><span>${e(o.label)}</span>${state.phase!=='collect'?`<b>${Math.round(count/12*100)}%</b>`:''}</button>`;}).join('')}</div><div class="v3-sandbox-reasons">${lesson.quickReasons.map((reason,i)=>`<button data-sandbox-reason="${i}" aria-pressed="${selectedReason===i}" ${state.phase!=='collect'?'disabled':''}>${e(reason)}</button>`).join('')}</div><p class="v3-simulation-note">12 位模拟同学（首位可替换为你的测试输入） · 第 ${state.round} 轮 · ${state.phase==='collect'?'独立作答':state.phase==='branch'?'比较解释与证据':'结果已公布'}</p><div class="v3-sandbox-actions"><button class="v3-primary" data-next>${state.phase==='collect'?'公布本轮与对撞墙':state.round===1&&state.phase==='reveal'?'选择策略并开启二轮':'重置沙箱'}</button></div>${renderContrastWall(state,e)}${renderCognitionReport(state,e)}</section><aside class="v3-inspector"><h2>接口契约与 JSON 示例</h2><dl><dt>activityId</dt><dd>${m.id}</dd><dt>输入模式</dt><dd>${m.input}</dd><dt>公布模式</dt><dd>${m.reveal}</dd><dt>适用场景</dt><dd>${e(m.bestFor)}</dd></dl><div class="v3-guardrails">${m.guardrails.map(g=>`<span>✓ ${e(g)}</span>`).join('')}</div><pre>${e(JSON.stringify(protocol(),null,2))}</pre></aside></div></section>`;
    const embedded=document.getElementById('polyphony-architecture')?.textContent.trim();
    const architecture=embedded?'data:image/svg+xml;base64,'+embedded:'./assets/architecture.svg';
    root.querySelector('.v3-gallery').classList.toggle('is-protocol-overview',architectureOpen);
    root.querySelector('.v3-gallery-grid').insertAdjacentHTML('beforeend',`<section class="v4-architecture-panel" ${architectureOpen?'':'hidden'}><h2>V4.0 · 双源备课与五阶段 Harness</h2><img src="${architecture}" alt="V4 双源接入、五阶段编排、四种模组与原生流式播放器"><p>同一套引文护栏、表达式校验与双轮状态机，服务两条备课路径。</p></section>`);
    const toggle=document.createElement('button');toggle.className='v3-subtle';toggle.dataset.protocolOverview='';toggle.textContent=architectureOpen?'返回实时交互沙盒':'Harness 架构与契约同屏';toggle.setAttribute('aria-pressed',String(architectureOpen));
    toggle.onclick=()=>{architectureOpen=!architectureOpen;paint();};root.querySelector('.v3-page-heading').append(toggle);
    bindModule(root,preview,{command:type=>{state=reduceRoom(state,{type});paint();}});
    root.querySelectorAll('[data-module-tab]').forEach(b=>b.onclick=()=>{index=Number(b.dataset.moduleTab);subject=0;initialize();paint();});
    root.querySelectorAll('[data-subject]').forEach(b=>b.onclick=()=>{subject=Number(b.dataset.subject);initialize();paint();});
    const input=()=>{
      const simulated=state.responses.find(r=>r.round===state.round&&r.simulated);
      if(simulated)state={...state,responses:state.responses.map(r=>r===simulated?{...r,optionId:selectedOption??r.optionId,reason:selectedReason===null?r.reason:lesson.quickReasons[selectedReason]}:r)};
      paint();
    };
    root.querySelectorAll('[data-vote]').forEach(b=>b.onclick=()=>{selectedOption=b.dataset.vote;input();});
    root.querySelectorAll('[data-step-select]').forEach(b=>b.onclick=()=>{selectedOption=b.dataset.stepSelect;input();});
    root.querySelectorAll('[data-sandbox-reason]').forEach(b=>b.onclick=()=>{selectedReason=Number(b.dataset.sandboxReason);input();});
    root.oninput=null;
    if(root._paramListener)root.removeEventListener('moduleparamschange',root._paramListener);
    root._paramListener=event=>{currentParams=event.detail;const pre=root.querySelector('.v3-inspector pre');if(pre)pre.textContent=JSON.stringify(protocol(),null,2);};
    root.addEventListener('moduleparamschange',root._paramListener);
    root.querySelector('[data-next]').onclick=()=>{
      if(state.phase==='collect'){state=reduceRoom(state,{type:'reveal'});state=reduceRoom(state,{type:'analyze'});}
      else if(state.round===1){state=reduceRoom(state,{type:'branch',payload:{branchId:state.lesson.branches[0].id}});state=reduceRoom(state,{type:'revise'});state=reduceRoom(state,{type:'demoFill'});}
      else initialize();paint();
    };
    root.querySelector('[data-bring]').onclick=async event=>{event.currentTarget.disabled=true;try{await ctx.startLesson({...lesson,moduleConfig:protocol().moduleConfig});}catch(err){ctx.toast(err.message);event.target.disabled=false;}};
  }
  initialize();paint();return()=>{clean?.();if(root._paramListener)root.removeEventListener('moduleparamschange',root._paramListener);};
}
