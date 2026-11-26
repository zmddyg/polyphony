import { readPptx } from '../core/pptx-reader.mjs';
import { readLegacySlides } from '../core/legacy-ppt.mjs';
import { makeMaterialVersionId, createMaterialNotebook } from '../core/material-notebook.mjs';
import { createDemoMaterial, SHOWCASE_DECKS } from '../core/demo-lesson.mjs';
import { HARNESS_STAGES, createPageModule, validateHarnessLesson, dryRunLesson } from '../core/deck-harness.mjs';
import { MODULE_MANIFESTS } from '../core/activities.mjs';
import { buildLectureScore, validateLectureScore } from '../core/lecture-score.mjs';
import { moduleHtml, bindModule } from './module-renderer.mjs';
import { COMBAT_DECKS, blockText } from '../core/combat-decks.mjs';
import { renderLectureFrame } from './lecture-stage.mjs';

const labels={'concept-diagnosis@1':'概念对撞','step-fault@1':'逐行找茬','param-explorer@1':'公式沙盒','evidence-weighing@1':'方案权衡+AI辩友'};
let workspace={material:null,result:null,index:0,pacingMode:'stem-60s',authorMode:'import',spec:{course:'光电学院大一《软件技术基础（C语言）》',topic:'第6章指针：内存地址与内容；*p++与(*p)++闭卷读程；swap传值与传址栈帧机制；一维数组原地逆序',pageCount:12}};
export function renderMaterialWorkspace(root,ctx) {
  const {esc:e}=ctx, notebook=createMaterialNotebook();
  let stopped=false,busy=false,receipt=null,status='',error=false;
  const tell=(message,failed=false)=>{status=message;error=failed;const s=root.querySelector('[data-harness-status]');if(s){s.textContent=message;s.dataset.error=String(failed);}};
  const pipeline=()=>`<div class="harness-head"><span class="harness-orbit">◉</span><div><h2>Agent Harness</h2><p>五阶段转化编排中枢</p></div><span class="harness-ready">${busy?'编排进行中':'准备就绪'}</span></div><ol class="harness-pipeline">${HARNESS_STAGES.map((s,i)=>{
    const r=(receipt??workspace.result?.harnessReceipt)?.stages.find(r=>r.id===s.id),state=r?.status??'pending';
    return `<li data-stage="${s.id}" data-state="${state}"><span>${state==='complete'?'✓':String(i+1).padStart(2,'0')}</span><div><b>${['原稿解析','全卷卡点规划','模块化契约合成','引文 / 表达式护栏与自修复','双轮沙箱预演'][i]}</b><small>${state==='complete'?'已通过 · ':state==='running'?'处理中 · ':''}${s.title}</small></div><i></i></li>`;
  }).join('')}</ol><div class="harness-summary">${workspace.result?`<b>${workspace.result.lectureScore.pages.length} 页原稿 · ${workspace.result.lectureScore.pages.filter(p=>p.interaction).length} 个互动</b><span>${workspace.result.harnessReceipt.repairs.length} 次修复 / 回退 · 双轮预演通过</span>`:'<b>从任意课程出发</b><span>原页保留 · 模块可换 · 证据可追溯</span>'}</div><button class="v3-primary harness-run" data-run-harness ${!workspace.material||busy?'disabled':''}>⚡ ${busy?'正在运行 Agent Harness…':'运行 Agent Harness 一键生成上线教案'}</button>${workspace.result?'<button class="v3-publish" data-publish>🚀 一键发布上线教案</button><button class="v3-text" data-receipt>查看五阶段回执与修复记录</button>':''}`;
  function paint() {
    const {material,result}=workspace;
    root.innerHTML=`<section class="v3-home"><header class="v3-page-heading"><div><h1>让每一份课件，都能与全班共演。</h1><p>通用课件转化编排 Agent Harness · 模块化交互教学平台</p></div><button class="v3-subtle" data-gallery>浏览交互模组 ↗</button></header><div class="v3-home-grid"><section class="v3-source-entry"><div class="v3-entry-title"><span>课件活化</span><small>PPT / PPTX / PDF</small></div><h2>保留讲授脉络，<br>找到值得全班参与的那一页。</h2><p class="v3-entry-copy">导入原稿，规划卡点，将判断、推理与证据变成可运行的双轮课堂。</p><div class="v3-upload" data-upload-zone><div class="v3-upload-mark">↥</div><div><b>上传你的课件</b><p>按页读取原文与插图，保留原始顺序</p></div><button class="v3-primary" data-upload>选择课件</button></div><div class="v3-entry-actions"><button class="v3-text" data-paste>＋ 粘贴一页讲义</button><button class="v3-text" data-new-interaction>独立新建互动</button></div><div class="v3-showcase-head"><b>从一堂真实课程开始</b><span>三类课程 · 同一套接口</span></div><div class="v3-showcases">${SHOWCASE_DECKS.map(d=>`<button data-showcase="${d.id}" class="v3-course" aria-pressed="${material?.showcaseId===d.id}"><span>${d.icon}</span><div><strong>${e(d.label)}</strong><small>${d.pages.length} 页 · ${d.id==='deck-seminar'?'大班破冰与证据质询':'推理审计与概念诊断'}</small></div><b>↗</b></button>`).join('')}</div><label class="v3-pacing">课堂节奏<select data-pacing><option value="stem-60s" ${workspace.pacingMode==='stem-60s'?'selected':''}>专业课 60s 精讲卡点</option><option value="seminar-3m" ${workspace.pacingMode==='seminar-3m'?'selected':''}>大班 3min 破冰研讨</option><option value="full-demo" ${workspace.pacingMode==='full-demo'?'selected':''}>完整示范 · 展示全部适配卡点</option></select></label></section><section class="v3-harness" data-harness-panel>${pipeline()}</section></div><p class="v3-status" data-harness-status data-error="${error}" role="status">${e(status)}</p>${material?`<section class="v3-deck"><header><div><h2>${e(material.title??material.name)}</h2><p>${material.pages.filter(p=>!p.hidden).length} 页原稿${result?' · 已编译上线教案':' · 等待 Harness 规划'}</p></div><span>未挂载互动的页面按原页放映</span></header><div class="v3-deck-layout"><nav class="v3-page-list" aria-label="原稿页码">${material.pages.filter(p=>!p.hidden).map((p,i)=>`<button data-page="${i}" aria-current="${workspace.index===i?'page':'false'}"><b>${String(p.number).padStart(2,'0')}</b><span>${e(p.title)}<small>${labels[result?.lectureScore.pages.find(r=>r.number===p.number)?.interaction?.activityId]??'原页直通'}</small></span></button>`).join('')}</nav><div data-page-preview></div></div></section>`:''}<input type="file" accept=".ppt,.pptx,.pdf" data-file hidden><dialog class="v3-dialog" data-paste-dialog><form><h2>粘贴一页讲义</h2><label>标题<input name="title" required maxlength="100"></label><label>原文<textarea name="text" rows="8" required></textarea></label><div class="v3-dialog-actions"><button type="button" class="v3-subtle" data-cancel>取消</button><button class="v3-primary">打开这一页</button></div></form></dialog><dialog class="v3-dialog v3-receipt" data-receipt-dialog><h2>Harness 五阶段回执</h2><pre>${e(JSON.stringify(result?.harnessReceipt??{},null,2))}</pre><button class="v3-subtle" data-close-receipt>关闭</button></dialog></section>`;
    if(result) {
      root.querySelector('.v3-home').classList.add('v3-compiled');
      const overview=document.createElement('div');overview.className='v3-compiled-overview';
      overview.innerHTML=`<h2>原稿逐页挂载回执</h2><p>${e(material.title??material.name)} · ${result.lectureScore.pages.length} 页</p><ol>${result.lectureScore.pages.map(p=>`<li><b>P${p.number}</b><div><strong>${e(p.title)}</strong><code>${e(p.interaction?.activityId??'原页直通')}</code></div></li>`).join('')}</ol><aside class="v3-repair-receipt"><b>✓ 引文护栏已拦截并修复</b><p>${result.harnessReceipt.repairs.length?'演示回放：不存在的 M99 引文被拒绝；按原页有效 M 编号重建契约，复验通过。':'本次输出均通过原页引文校验，无需修复。'}</p><small>修复 / 回退 ${result.harnessReceipt.repairs.length} 次 · 双轮状态机预演通过 · ${e(result.source??'local')}</small></aside>`;
      const repairs=result.harnessReceipt.repairs;
      overview.querySelector('.v3-repair-receipt b').textContent=repairs.length?'✓ 引文护栏已拦截并处理':'✓ 原页引文校验通过';
      overview.querySelector('.v3-repair-receipt p').textContent=result.source==='demo-replay'&&repairs.length?'演示回放：不存在的 M99 引文被拒绝；按原页有效 M 编号重建契约，复验通过。':repairs.length?repairs.map(r=>`P${r.pageNumber} · ${r.status==='repaired'?'修复后通过':'已回退'}：${r.issue}`).join('；'):'本次输出均通过原页引文校验，无需修复。';
      root.querySelector('.v3-source-entry').append(overview);
    }
    decorateSources();wire(); if(material) paintPage();
  }
  function decorateSources() {
    const source=root.querySelector('.v3-source-entry'),legacy=document.createElement('div');legacy.dataset.legacySource='';
    while(source.firstChild)legacy.append(source.firstChild);
    source.append(legacy);
    const spec=workspace.spec;
    source.insertAdjacentHTML('afterbegin',`<nav class="native-source-tabs" role="tablist" aria-label="双源备课中枢"><button role="tab" data-source-mode="import" aria-selected="${workspace.authorMode==='import'}">📂 导入旧教学材料活化</button><button role="tab" data-source-mode="native" aria-selected="${workspace.authorMode==='native'}">✨ AI 从零生成原生课件</button></nav><form class="native-author-form" data-author-form ${workspace.authorMode==='native'?'':'hidden'}><label>课程名称与授课对象<input name="course" value="${e(spec.course)}" required maxlength="300"></label><div class="native-author-presets">${['C Programming','Physical Optics','College English Seminar','Linear Algebra'].map((s,i)=>`<button type="button" data-author-preset="${i}">${s}</button>`).join('')}</div><label>本讲主题与核心重难点<textarea name="topic" rows="5" required maxlength="8000">${e(spec.topic)}</textarea></label><div class="native-author-pair"><label>课件页数规模<select name="pageCount">${[[8,'8 页精讲'],[10,'10 页标准课时'],[12,'12 页深度实战']].map(([n,s])=>`<option value="${n}" ${Number(spec.pageCount)===n?'selected':''}>${s}</option>`).join('')}</select></label><label>课堂节奏与偏好模组<select name="pacingMode"><option value="stem-60s" ${workspace.pacingMode==='stem-60s'?'selected':''}>专业课 60s 微卡点</option><option value="seminar-3m" ${workspace.pacingMode==='seminar-3m'?'selected':''}>大班 3min 思辨破冰</option></select></label></div><button ${busy?'disabled':''}>⚡ 调用 Agent Harness 从零生成互动课件</button><p class="native-author-note">${ctx.providerSummary?.configured?'模型已配置：生成结构化多页课件，验证引文与表达式，并执行双轮沙箱预演。':'本地结构化生成 · 配置模型 API 可解锁任意课题深度生成。匹配课程使用完整实战讲义，其他主题生成明确标注的备课框架。'}</p></form>`);
    legacy.hidden=workspace.authorMode!=='import';
    const list=legacy.querySelector('.v3-showcases');
    list.innerHTML=COMBAT_DECKS.map(d=>`<button data-showcase="${d.id}" class="v3-course" aria-pressed="${workspace.material?.showcaseId===d.id}"><span>${d.icon}</span><div><strong>${e(d.label)}</strong><small>${d.pages.length} 页完整课时 · 3 页原生内嵌互动</small></div><b>↗</b></button>`).join('');
    // Keep the three full-length classroom examples visible from either source.
    const examples=document.createElement('section');examples.className='native-combat-examples';
    examples.append(legacy.querySelector('.v3-showcase-head'),list);source.append(examples);
    root.querySelectorAll('[data-source-mode]').forEach(b=>b.onclick=()=>{if(busy)return;saveAuthorForm();workspace.authorMode=b.dataset.sourceMode;paint();});
    const presets=[['光电学院大一《软件技术基础（C语言）》','第6章指针：地址与内容；指针步长；*p++与(*p)++；swap与数组原地逆序',12],['光电学院《物理光学与光电子学》','复振幅相干叠加；不等臂损耗ER；夫琅禾费衍射；MZM偏置与二倍频',10],['大学英语 Unit 4 翻转研讨','实证阅读与证据边界；Hedging；生态谬误；匿名盲审思辨',10],['大一《线性代数》','矩阵秩与四个基本子空间；Ax=b可解性与唯一性；矩形矩阵满秩误区',10]];
    root.querySelectorAll('[data-author-preset]').forEach(b=>b.onclick=()=>{const [course,topic,pageCount]=presets[Number(b.dataset.authorPreset)];workspace.spec={course,topic,pageCount};paint();});
    root.querySelector('[data-author-form]').onsubmit=async event=>{event.preventDefault();await authorNative();};
    if(workspace.result) {
      const panel=root.querySelector('[data-harness-panel]');
      const exportButton=document.createElement('button');exportButton.className='native-export';exportButton.dataset.exportDeck='';exportButton.textContent='导出原生课件 JSON';
      exportButton.onclick=()=>{const file=new Blob([JSON.stringify(workspace.result.lectureScore,null,2)],{type:'application/json'}),url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download='共演-'+workspace.result.lectureScore.title.slice(0,60).replace(/[\\/:*?"<>|]/g,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
      panel.append(exportButton);
      panel.querySelector('[data-publish]').textContent='▶ 在原生课件播放器开课';
    }
    root.querySelector('.v3-page-heading h1').textContent='双源备课，同页共演。';
    root.querySelector('.v3-page-heading p').textContent='导入旧课件无损活化 ∥ AI 从零生成原生互动课件';
  }
  function saveAuthorForm() {
    const form=root.querySelector('[data-author-form]');if(!form)return;
    const data=new FormData(form);workspace.spec={course:String(data.get('course')),topic:String(data.get('topic')),pageCount:Number(data.get('pageCount'))};
    if(workspace.authorMode==='native')workspace.pacingMode=String(data.get('pacingMode'));
  }
  async function authorNative() {
    if(busy)return;saveAuthorForm();busy=true;receipt=null;paint();tell('正在生成原生讲义，随后验证互动契约与双轮流程…');
    try {
      const result=await ctx.authorDeck({...workspace.spec,pacingMode:workspace.pacingMode},{onStage:r=>{receipt=r;const panel=root.querySelector('[data-harness-panel]');if(panel)panel.innerHTML=pipeline();}});
      if(stopped)return;
      workspace.result=result;workspace.index=0;receipt=result.harnessReceipt;
      workspace.material={name:result.lectureScore.title,title:result.lectureScore.title,type:'native',versionId:result.harnessReceipt.contentDigest,pages:result.lectureScore.pages.map(p=>({...p,text:p.blocks?.map(blockText).join('\n')??p.body.join('\n'),showcaseLesson:p.interaction}))};
      tell(result.generationNote??'原生课件已生成，验证与双轮预演通过。');
    } catch(err){tell(err.message,true);}finally{busy=false;if(!stopped)paint();}
  }
  function paintPage() {
    const p=workspace.material.pages.filter(p=>!p.hidden)[workspace.index]; if(!p) return;
    const lesson=workspace.result?.lectureScore.pages.find(r=>r.number===p.number)?.interaction;
    const host=root.querySelector('[data-page-preview]');
    host.innerHTML=`<div class="v3-preview-toolbar"><b>原稿 P${p.number}</b><label>挂载模块<select data-swap><option value="">原页直通</option>${MODULE_MANIFESTS.map(m=>`<option value="${m.id}" ${lesson?.activityId===m.id?'selected':''}>${labels[m.id]}</option>`).join('')}</select></label></div><div class="v3-source-preview">${p.preview?`<img src="${e(p.preview)}" alt="原稿第 ${p.number} 页">`:`<h3>${e(p.title)}</h3>`}<details ${p.preview?'':'open'}><summary>原页可引用文字</summary><pre>${e(p.text)}</pre></details></div>${lesson?`<section class="v3-interaction-preview"><h3>${e(lesson.title)} <small>${e(labels[lesson.activityId])}</small></h3><p>${e(lesson.prompt)}</p><div data-module-preview>${moduleHtml(lesson,{phase:'reveal',round:1,responses:[]},{standalone:true})}</div><ol class="v3-preview-options">${lesson.options.map(o=>`<li>${e(o.label)}</li>`).join('')}</ol><details><summary>编辑本页模块 JSON 契约</summary><textarea class="v3-json-editor" data-module-json rows="12" spellcheck="false">${e(JSON.stringify(lesson,null,2))}</textarea><button class="v3-subtle" data-save-module>验证并保存修改</button></details></section>`:'<p class="v3-plain-slide">这页保留原稿，不插入互动。可在上方选择适合原页内容的模块。</p>'}`;
    if(p.blocks?.length){const content=document.createElement('div');content.className='native-workspace-preview';renderLectureFrame(content,{...p,body:[],source:{name:workspace.material.name},pageNumber:p.number},{compact:true});const preview=host.querySelector('.v3-source-preview'),transcript=preview.querySelector('details');transcript.open=false;preview.replaceChildren(content,transcript);}
    if(lesson) bindModule(host,lesson);
    host.querySelector('[data-swap]').onchange=event=>{
      try {
        const id=event.target.value, next=id?createPageModule(p,id):null;
        updateLesson(p.number,next);
        if(next&&next.activityId!==id) tell('原页不足以支持所选模块，已回退为有证据支撑的概念诊断。');
        else tell('本页模块已更新。');
      } catch(err){tell(err.message,true);}
    };
    host.querySelector('[data-save-module]')?.addEventListener('click',()=>{
      try { const blocks=String(p.text||p.title).split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map((text,i)=>({id:'M'+(i+1),text})); const checked=validateHarnessLesson(JSON.parse(host.querySelector('[data-module-json]').value),{...p,blocks}); updateLesson(p.number,checked);tell('契约、引文与表达式验证通过，已保存。'); } catch(err){tell(err.message,true);}
    });
  }
  function updateLesson(number,lesson) {
    const map=new Map(workspace.result?.lectureScore.pages.filter(p=>p.interaction).map(p=>[p.number,p.interaction])??[]);
    if(lesson)map.set(number,lesson);else map.delete(number);
    const adopted=new Map((workspace.result?.lectureScore.pages??[]).map(p=>[p.number,{slides:p.adopted}]));
    const lectureScore=buildLectureScore(workspace.material,adopted,{interactionsByPage:map});
    const harnessReceipt=structuredClone(workspace.result?.harnessReceipt??{stages:[],repairs:[],dryRuns:[]});
    harnessReceipt.dryRuns=[...(harnessReceipt.dryRuns??[]).filter(r=>r.pageNumber!==number),...(lesson?[{pageNumber:number,...dryRunLesson(lesson)}]:[])];
    harnessReceipt.edits=[...(harnessReceipt.edits??[]),{pageNumber:number,activityId:lesson?.activityId??null,status:'verified'}];
    workspace.result={...workspace.result,lectureScore,harnessReceipt};
    paint();
  }
  async function open(material) {
    workspace.material=material;workspace.result=null;workspace.index=0;receipt=null;
    try {
      await notebook.saveVersion(material);
      const notes=await notebook.listNotes(material.versionId);
      material.pageMemories=Object.fromEntries(material.pages.map(p=>[p.number,notes.filter(n=>n.pageNumber===p.number).map(n=>({id:n.id,kind:n.kind,packet:n.packet}))]));
    } catch { /* Continue with current deck when IndexedDB is unavailable. */ }
    if(!stopped){paint();tell('原稿已载入。运行 Agent Harness 生成上线教案。');}
  }
  async function importFile(file) {
    if(busy)return;busy=true;tell('正在解析原稿…');
    try {
      const ext=file.name.split('.').at(-1).toLowerCase();
      if(ext==='json') {
        if(file.size>64*1024*1024)throw Error('课件超过64MB。');
        const lectureScore=validateLectureScore(JSON.parse(await file.text()));
        const versionId=await makeMaterialVersionId({bytes:JSON.stringify(lectureScore)});
        workspace.material={name:lectureScore.title,title:lectureScore.title,type:lectureScore.source.kind,versionId,pages:lectureScore.pages.map(p=>({...p,text:p.blocks?.map(blockText).join('\n')??p.body.join('\n'),showcaseLesson:p.interaction}))};
        workspace.index=0;workspace.result={lectureScore,source:'json-import',harnessReceipt:{version:'polyphony.harness@1',source:'json-import',stages:HARNESS_STAGES.map(s=>({...s,status:'complete'})),repairs:[],dryRuns:lectureScore.pages.filter(p=>p.interaction).map(p=>({pageNumber:p.number,...dryRunLesson(p.interaction)}))}};
        receipt=workspace.result.harnessReceipt;tell('原生课件JSON已验证并完成双轮预演，可以直接开课。');return;
      }
      if(!['ppt','pptx','pdf'].includes(ext))throw Error('请选择 .ppt / .pptx / .pdf 文件。');
      const bytes=new Uint8Array(await file.arrayBuffer());
      const versionId=await makeMaterialVersionId({bytes});
      let data;
      if(ctx.mode==='server'&&(ext!=='pptx'||ctx.materialRendering))try{data=await ctx.importMaterial(file);}catch(err){if(ext==='pdf')throw err;}
      if(!data&&ext==='pptx')data=await readPptx(file);
      else if(!data&&ext==='ppt')data=await readLegacySlides(bytes);
      else if(!data)throw Error('PDF 按页渲染请使用本机课堂服务；离线可粘贴原页文字。');
      await open({...data,type:ext,versionId,name:file.name,title:data.title||file.name});
      if(data.warnings?.length)tell('原稿已载入。'+data.warnings.join(' '));
    } catch(err){tell(err.message,true);}finally{busy=false;if(!stopped)paint();}
  }
  async function run() {
    if(busy||!workspace.material)return;
    busy=true;receipt={stages:HARNESS_STAGES.map(s=>({...s,status:s.id==='ingest'?'running':'pending'}))};paint();tell('Harness 正在解析、规划与验证课件。');
    try {
      const result=await ctx.runHarness(workspace.material,{pacingMode:workspace.pacingMode,mode:ctx.providerSummary?.configured?'auto':'demo-replay',onStage:r=>{receipt=r;const panel=root.querySelector('[data-harness-panel]');if(panel)panel.innerHTML=pipeline();}});
      if(stopped)return;workspace.result=result;receipt=result.harnessReceipt;tell('上线教案编译完成。请逐页预览，确认后发布。');
    } catch(err){tell(err.message,true);}finally{busy=false;if(!stopped)paint();}
  }
  function wire() {
    root.querySelector('[data-gallery]').onclick=()=>ctx.go('lab');
    root.querySelector('[data-new-interaction]').onclick=()=>ctx.go('workshop');
    root.querySelector('[data-upload]').onclick=()=>root.querySelector('[data-file]').click();
    root.querySelector('[data-file]').onchange=event=>{const f=event.target.files[0];if(f)void importFile(f);};
    root.querySelector('[data-file]').accept='.ppt,.pptx,.pdf,.json';
    const zone=root.querySelector('[data-upload-zone]');zone.ondragover=event=>event.preventDefault();zone.ondrop=event=>{event.preventDefault();const f=event.dataTransfer.files[0];if(f)void importFile(f);};
    root.querySelector('[data-pacing]').onchange=event=>{workspace.pacingMode=event.target.value;};
    root.querySelectorAll('[data-showcase]').forEach(b=>b.onclick=()=>{if(busy)return;workspace.pacingMode=b.dataset.showcase==='deck-seminar'?'seminar-3m':'full-demo';void open(createDemoMaterial(b.dataset.showcase));});
    root.querySelector('[data-run-harness]').onclick=workspace.authorMode==='native'?()=>root.querySelector('[data-author-form]').requestSubmit():run;
    if(workspace.authorMode==='native'){root.querySelector('[data-run-harness]').disabled=busy;root.querySelector('[data-run-harness]').textContent=busy?'正在生成原生课件…':'⚡ 从课程主题生成原生课件';}
    root.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{workspace.index=Number(b.dataset.page);paint();});
    root.querySelector('[data-publish]')?.addEventListener('click',async event=>{event.currentTarget.disabled=true;try{await ctx.startLecture(workspace.result.lectureScore);}catch(err){tell(err.message,true);event.target.disabled=false;}});
    const dialog=root.querySelector('[data-paste-dialog]');root.querySelector('[data-paste]').onclick=()=>dialog.showModal();dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
    dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();const f=event.target,title=f.elements.title.value.trim(),text=f.elements.text.value.trim();const versionId=await makeMaterialVersionId({bytes:new TextEncoder().encode(title+'\n'+text)});dialog.close();await open({name:title,title,type:'text',versionId,pages:[{number:1,title,text,images:[]}]});};
    const rd=root.querySelector('[data-receipt-dialog]');root.querySelector('[data-receipt]')?.addEventListener('click',()=>rd.showModal());root.querySelector('[data-close-receipt]').onclick=()=>rd.close();
  }
  paint();
  return ()=>{stopped=true;};
}
