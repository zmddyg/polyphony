import { cognitionReport } from '../core/cognition.mjs';
import { renderRichMathHtml } from '../core/math-render.mjs';

export function renderCognitionReport(state) {
  if (Number(state.round) !== 2 || !['reveal', 'closed'].includes(state.phase)) return '';
  const r = cognitionReport(state);
  const pct = (n, d) => d ? Math.round(n * 100 / d) : 0;
  return `<section class="cognition-report" aria-label="两轮认知跃迁战报">
    <header><h2>两轮认知跃迁战报</h2><span>灰：首轮 · 青：二轮 · 净变化以百分点计</span></header>
    <div class="cognition-kpis"><div><span>参与人数</span><strong>${r.second.total}</strong><small>二轮提交 · 首轮 ${r.first.total}${state.simulatedResponseCount || state.responses?.some(x => x.simulated) ? ' · 含标记模拟' : ''}</small></div>
      <div><span>观点修正率</span><strong>${r.revisionPercent == null ? '—' : r.revisionPercent + '%'}</strong><small>${r.paired.total ? `${r.paired.changed} / ${r.paired.total} 位配对${r.paired.source === 'simulated' ? '模拟' : '现场'}学生改选` : '缺少配对数据，分布变化不能代替改答率'}</small></div>
      <div><span>正解达成跃迁</span><strong>${r.firstCorrect == null || r.secondCorrect == null ? '待判定' : `${r.firstCorrect}% → ${r.secondCorrect}%`}</strong><small>${r.correct ? '按本页已声明答案统计' : '开放权衡不设唯一标准答案'}</small></div></div>
    <ol class="cognition-bars">${state.lesson.options.map((o, i) => {
      const a = pct(r.first.counts[o.id] ?? 0, r.first.total), b = pct(r.second.counts[o.id] ?? 0, r.second.total), delta = b - a;
      return `<li><div class="cognition-option"><b>${String.fromCharCode(65 + i)}</b><span>${renderRichMathHtml(o.label)}</span><em>${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta)}<small> pp</small></em></div><div class="cognition-tracks"><div><i style="width:${a}%"></i><span>首轮 ${a}%</span></div><div><i style="width:${b}%"></i><span>二轮 ${b}%</span></div></div></li>`;
    }).join('')}</ol>
    <aside class="cognition-summary"><strong>教师小结</strong><span>选项修正之后，还要用推理过程解释新证据。${r.revisionPercent == null ? '本课配对证据尚不完整。' : `本课 ${r.paired.changed} / ${r.paired.total} 位配对学生改选，不能直接等同于理解全部达标。`}</span></aside>
  </section>`;
}

export function renderContrastWall(state) {
  if (!['reveal', 'branch'].includes(state.phase) || Number(state.round) !== 1 || !(state.analysis?.contrastPair?.length >= 2)) return '';
  const pair = [...state.analysis.contrastPair.slice(0, 2)].sort((a, b) => (a.tone === 'alert' ? 0 : 1) - (b.tone === 'alert' ? 0 : 1));
  return `<section class="contrast-wall" aria-label="AI 思维透视"><header><h2>⚡ AI 思维透视 · 伪掌握红蓝对撞墙</h2><p>${renderRichMathHtml(state.analysis.headline)}</p></header><div class="contrast-pair">${pair.map((p, i) => `<article class="contrast-quote ${i ? 'is-insight' : 'is-alert'}"><span>${renderRichMathHtml(p.sideLabel)}</span><blockquote>“${renderRichMathHtml(p.quote)}”</blockquote><small>匿名原话 · ${state.analysis.source === 'provider' ? 'AI 辅助诊断' : '离线规则诊断'}${state.simulatedResponseCount ? ' · 含模拟作答' : ''}</small></article>`).join('')}</div></section>`;
}
