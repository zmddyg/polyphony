import { HARNESS_STAGES, HARNESS_LESSON_SCHEMA } from '../core/deck-harness.mjs';

export function renderSystem(root, ctx) {
  const embedded = document.getElementById('polyphony-architecture')?.textContent.trim();
  const source = embedded ? 'data:image/svg+xml;base64,' + embedded : './assets/architecture.svg';
  root.innerHTML = `<section class="v3-system"><header class="v3-page-heading"><div><h1>Harness 架构与接口协议</h1><p>原稿、引文与互动采用同一套可校验数据契约。</p></div></header>
    <section class="v4-architecture-panel"><img src="${ctx.esc(source)}" alt="五阶段 Harness 架构"></section>
    <div class="v3-system-flow">${HARNESS_STAGES.map((stage,i)=>`<article><b>${i+1}</b><h2>${ctx.esc(stage.title)}</h2></article>`).join('')}</div>
    <details class="v3-system-card"><summary>单页互动 JSON Schema</summary><pre>${ctx.esc(JSON.stringify(HARNESS_LESSON_SCHEMA,null,2))}</pre></details></section>`;
}
