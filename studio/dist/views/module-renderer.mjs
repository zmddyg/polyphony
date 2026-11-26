import { sampleDeclarativeCurve } from '../core/safe-expr.mjs';
import { esc } from '../ui.mjs';

export function curveSvg(config, params = Object.fromEntries(config.sliders.map(s=>[s.symbol,s.defaultValue]))) {
  const {xAxis:x,yAxis:y}=config;
  const paths=config.curves.map((curve,i)=>{
    const points=sampleDeclarativeCurve({expr:curve.expr,xVar:x.symbol,xMin:x.min,xMax:x.max,params,samples:721});
    const d=points.map((p,j)=>`${j?'L':'M'}${(55+(p.x-x.min)/(x.max-x.min)*690).toFixed(2)},${(240-(p.y-y.min)/(y.max-y.min)*210).toFixed(2)}`).join(' ');
    return `<path data-curve="${i}" d="${d}" fill="none" stroke="${['#45cebf','#f2b45d'][i]}" stroke-width="3" ${curve.style==='dashed'?'stroke-dasharray="9 6"':''}/>`;
  }).join('');
  return `<svg class="module-curve" viewBox="0 0 800 295" role="img" aria-label="${esc(config.formulaDisplay)}"><defs><clipPath id="curve-clip"><rect x="55" y="20" width="690" height="220"/></clipPath></defs><g stroke="#40516a" opacity=".5">${[0,1,2,3,4].map(i=>`<path d="M55 ${30+i*52.5}H745"/>`).join('')}</g><path d="M55 20V240H745" fill="none" stroke="#8093ad"/><g clip-path="url(#curve-clip)">${paths}</g><g fill="#b8c9e0" font-size="13"><text x="55" y="262">${x.min}</text><text x="710" y="262">${x.max} ${esc(x.unit??'')}</text><text x="12" y="33">${y.max}</text><text x="12" y="240">${y.min}</text><text x="170" y="285">${esc(x.label)}</text></g></svg>`;
}
export function paramExplorerHtml(config,{readonly=false}={}) {
  return `<section class="module-param"><div class="module-formula">${esc(config.formulaDisplay)}</div><div data-curve-host>${curveSvg(config)}</div><div class="module-legend">${config.curves.map((c,i)=>`<span style="--curve:${['#45cebf','#f2b45d'][i]}">${esc(c.label)}</span>`).join('')}<small>${esc(config.yAxis.label)}</small></div>${readonly?'':`<div class="module-sliders">${config.sliders.map((s,i)=>`<label><span>${esc(s.label)} <output data-slider-value="${i}">${s.defaultValue} ${esc(s.unit??'')}</output></span><input type="range" data-module-slider="${i}" aria-label="${esc(s.label)}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.defaultValue}"></label>`).join('')}</div>`}<p class="module-insight">${esc(config.insightNote)}</p><p data-curve-error class="module-error" role="status"></p></section>`;
}
const bindings=new WeakMap();
export function bindParamExplorer(root,config) {
  if(!root||bindings.has(root)) return;
  const params=Object.fromEntries(config.sliders.map(s=>[s.symbol,s.defaultValue]));
  let frame=0;
  const change=event=>{
    const input=event.target.closest('[data-module-slider]'); if(!input) return;
    const i=Number(input.dataset.moduleSlider),s=config.sliders[i]; params[s.symbol]=Number(input.value);
    root.querySelector(`[data-slider-value="${i}"]`).textContent=input.value+' '+(s.unit??'');
    if(frame) return;
    frame=requestAnimationFrame(()=>{
      frame=0;
      try { root.querySelector('[data-curve-host]').innerHTML=curveSvg(config,params); root.querySelector('[data-curve-error]').textContent='';root.dispatchEvent(new CustomEvent('moduleparamschange',{bubbles:true,detail:{...params}})); }
      catch(error) { root.querySelector('[data-curve-error]').textContent='当前参数被数值护栏拦截：'+error.message; }
    });
  };
  root.addEventListener('input',change);
  bindings.set(root,()=>{cancelAnimationFrame(frame);root.removeEventListener('input',change);bindings.delete(root);});
  return bindings.get(root);
}

export function stepFaultHtml(lesson,state={}, {selectable=false,selectedId=''}={}) {
  const c=lesson.moduleConfig, reveal=['reveal','branch','closed'].includes(state.phase);
  const responses=(state.responses??[]).filter(r=>r.round===state.round);
  const total=responses.length;
  const first=(state.responses??[]).filter(r=>r.round===1);
  return `<section class="module-artifact" data-artifact-lang="${esc(c.artifactLang)}"><header><strong>${esc(c.artifactTitle)}</strong><span>${selectable?'点击你认为存在漏洞的那一步':'逐行证据审计'}</span></header><ol>${c.steps.map(s=>{
    const share=total?Math.round(responses.filter(r=>r.optionId===s.id).length/total*100):0;
    const prior=first.length?Math.round(first.filter(r=>r.optionId===s.id).length/first.length*100):0;
    const correct=reveal && s.id===c.faultStepId;
    return `<li class="${correct?'is-fault':''}" style="--share:${reveal?share:0}%"><${selectable?'button':'div'} ${selectable?`type="button" data-step-select="${esc(s.id)}" aria-pressed="${selectedId===s.id}"`:''} class="module-step"><b>${esc(s.line)}</b><code>${esc(s.content)}</code>${reveal?`<em>${state.round===2?prior+'% → ':''}${share}% 怀疑此步${correct?' · 漏洞定位':''}</em>`:''}</${selectable?'button':'div'}></li>`;
  }).join('')}</ol>${reveal?`<p class="module-diagnosis">${esc(c.faultDiagnosis??'')}</p>`:''}</section>`;
}
export function aiPeerHtml(lesson,state={}, {teacher=false,standalone=false}={}) {
  const c=lesson.moduleConfig;
  const shown=standalone || state.aiPeerRevealed;
  return `<section class="module-evidence"><div class="module-dimensions">${c.dimensions.map(d=>`<span>${esc(d)}</span>`).join('')}</div>${teacher?`<button type="button" class="module-peer-toggle" data-module-peer aria-pressed="${shown}">🤖 ${shown?'收起':'亮出'}盲盒 AI 辩友观点（供全班质询证伪）</button>`:''}${shown&&c.aiPeer?`<article class="module-peer"><header>🤖 ${esc(c.aiPeer.persona)} <small>待质询观点</small></header><blockquote>${esc(c.aiPeer.claim)}</blockquote><details><summary>查看原页证伪线索</summary><p>${esc(c.aiPeer.flawHint)}</p></details></article>`:''}</section>`;
}
export function moduleHtml(lesson,state={},options={}) {
  if(!lesson.moduleConfig) return '';
  if(lesson.activityId==='param-explorer@1') return paramExplorerHtml(lesson.moduleConfig,options);
  if(lesson.activityId==='step-fault@1') return stepFaultHtml(lesson,state,options);
  if(lesson.activityId==='evidence-weighing@1') return aiPeerHtml(lesson,state,options);
  return '';
}
export function bindModule(root,lesson,ctx={}) {
  if(lesson.activityId==='param-explorer@1') root.querySelectorAll('.module-param').forEach(el=>bindParamExplorer(el,lesson.moduleConfig));
  root.querySelectorAll('[data-module-peer]').forEach(b=>b.onclick=()=>ctx.command?.('toggleAiPeer'));
}
