import { esc } from '../ui.mjs';
import { renderRichMathHtml } from './math-render.mjs';

const styles = `
  * { box-sizing: border-box; }
  :root { color-scheme: light; font: 15px/1.65 system-ui, 'Microsoft YaHei', sans-serif; color: #172c3b; background: #eef3f5; }
  body { max-width: 920px; margin: 24px auto; padding: 0 16px; overflow-wrap: anywhere; }
  main { background: #fff; border: 1px solid #d6e1e7; border-radius: 12px; padding: clamp(15px, 5vw, 44px); }
  header { border-top: 5px solid #087b79; border-bottom: 1px solid #cfdee3; padding: 14px 0; }
  header .document-type { color: #086a69; font-weight: 700; }
  h1, h2, h3, p { margin: 0; }
  h1 { font-size: clamp(21px, 5vw, 32px); line-height: 1.35; margin: 4px 0 6px; }
  h2 { font-size: 18px; line-height: 1.4; margin-bottom: 8px; break-after: avoid; }
  h3 { font-size: 15px; line-height: 1.5; break-after: avoid; }
  p + p { margin-top: .35em; }
  section { margin-top: 24px; }
  article { margin: 7px 0; padding: 9px 12px; border: 1px solid #d6e1e7; border-inline-start: 3px solid #087b79; }
  article h3 { margin-bottom: 5px; }
  .muted { color: #4c6572; }
  .formula { padding: 4px 0; overflow-x: auto; }
  .formula math { font-size: 1.13em; }
  .katex-html { display: none; }
  .katex-mathml { position: static; }
  .rounds { margin: .42em 0 .55em; padding-inline-start: 1.5em; }
  .rounds li + li { margin-top: .3em; }
  .reason { white-space: pre-wrap; }
  .reference { padding-top: 5px; border-top: 1px solid #d6e1e7; }
  .marks { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 12px; }
  .marks ul { margin: 0; padding-inline-start: 1.4em; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(145px, 100%), 1fr)); gap: 9px; margin: 0 0 8px; }
  .kpis div { border-top: 2px solid #a5c7c8; padding: 6px 8px; }
  .kpis dd { margin: 0; font-size: 1.2em; font-weight: 700; color: #086a69; }
  .table-scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: start; border-bottom: 1px solid #d6e1e7; padding: 5px 7px; }
  th { color: #086a69; }
  td:first-child, td:nth-child(n+4) { white-space: nowrap; }
  @page { size: A4; margin: 13mm; }
  @media print {
    :root { background: #fff; font-size: 10.5pt; }
    body, main { max-width: none; padding: 0; margin: 0; border: 0; }
    section { margin-top: 13px; }
    article, header, .kpis, tr { break-inside: avoid; }
    .table-scroll { overflow: visible; }
  }
`;

function reportDocument(type, title, code, body) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${esc(title)} · ${esc(type)}</title><style>${styles}</style></head><body><main>
<header><p class="document-type">${esc(type)}</p><h1>${math(title)}</h1>${code ? `<p class="muted">课堂码 ${esc(code)}</p>` : ''}</header>
${body}</main></body></html>`;
}

function pageHeading({ pageNumber, title }) {
  return `第 ${esc(pageNumber)} 页${title ? ` · ${math(title)}` : ''}`;
}

const math = renderRichMathHtml;
const formula = text => text ? `<div class="formula">${renderRichMathHtml(text, { block: true })}</div>` : '';

function takeawayHtml(card) {
  return `<article><h3>${pageHeading(card)}</h3>${card.summary ? `<p>${math(card.summary)}</p>` : ''}
    ${formula(card.formula)}${card.pitfall ? `<p><b>避坑</b> ${math(card.pitfall)}</p>` : ''}</article>`;
}

function optionHtml({ optionId, label }) {
  return `${esc(optionId)}${label && label !== optionId ? ` · ${math(label)}` : ''}`;
}

function personalRecordHtml(record) {
  const { prompt, answers = [], reference, revisionPrompt } = record;
  const rounds = [1, 2].map(round => {
    const answer = answers.find(item => Number(item.round) === round);
    return `<li><b>${round === 1 ? '首轮' : '二轮'}</b>
      ${round === 2 && revisionPrompt ? `<p>${math(revisionPrompt)}</p>` : ''}
      ${answer ? `<span>${optionHtml(answer)}</span>${answer.reason ? `<p class="reason">${math(answer.reason)}</p>` : ''}` : '<span class="muted">未提交</span>'}</li>`;
  }).join('');
  const explanation = reference ? `
    ${reference.optionId ? `<p><b>参考答案</b> ${optionHtml(reference)}</p>` : ''}
    ${reference.summary ? `<p><b>参考解析</b> ${math(reference.summary)}</p>` : ''}
    ${formula(reference.formula)}${reference.pitfall ? `<p><b>避坑</b> ${math(reference.pitfall)}</p>` : ''}`
    : '<p class="muted">参考解析待公布</p>';
  return `<article><h3>${pageHeading(record)}</h3>${prompt ? `<p>${math(prompt)}</p>` : ''}
    <ol class="rounds">${rounds}</ol><div class="reference">${explanation}</div></article>`;
}

function pageMarksHtml(title, pages) {
  const entries = pages.map(page => typeof page === 'number' ? { pageNumber: page } : page);
  return `<div><h3>${esc(title)}</h3>${entries.length ? `<ul>${entries.map(page => `<li>${pageHeading(page)}</li>`).join('')}</ul>` : '<p class="muted">暂无标记</p>'}</div>`;
}

export function buildStudentReviewHtml({ title, code, takeaways = [], personalRecords = [], bookmarkedPages = [], muddyPages = [] }) {
  return reportDocument('本课个人复习单', title, code, `
    <section><h2>已解锁的速查卡</h2>${takeaways.map(takeawayHtml).join('') || '<p class="muted">本课暂无已解锁的速查卡</p>'}</section>
    <section><h2>我的两轮作答</h2>${personalRecords.map(personalRecordHtml).join('') || '<p class="muted">此浏览器会话暂无个人作答记录</p>'}</section>
    <section><h2>我的讲义标记</h2><div class="marks">${pageMarksHtml('⭐ 待复习', bookmarkedPages)}${pageMarksHtml('🙋 有疑问', muddyPages)}</div></section>`);
}

const activityNames = {
  'concept-diagnosis@1': '概念诊断', 'step-fault@1': '逐行找茬',
  'param-explorer@1': '公式沙盒', 'evidence-weighing@1': '证据权衡',
};
const sourceLabel = source => source === 'live' ? '真实学生作答' : '模拟作答';
const percent = value => Number.isFinite(value) ? `${value}%` : '未取得';
const points = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value} pp` : '未取得';

export function buildTeacherReportHtml(state, metrics) {
  const { source, participantCount, reasonFillRate, firstRoundAccuracy, secondRoundAccuracy,
    accuracyGainPp, pairedRevisionRate, interactivePageCount, topMuddyPage, pages = [] } = metrics;
  const kpis = [
    ['参与人数', participantCount], ['作答理由填写率', percent(reasonFillRate)],
    ['首轮平均正解率', percent(firstRoundAccuracy)], ['二轮平均正解率', percent(secondRoundAccuracy)],
    ['正解率净跃迁', points(accuracyGainPp)], ['配对改答率', percent(pairedRevisionRate)],
    ['开展互动页数', interactivePageCount],
  ];
  const pageDetails = pages.map(page => {
    const module = page.kind === 'lecture' ? '讲授' : Object.hasOwn(activityNames, page.activityId) ? activityNames[page.activityId] : page.activityId || '互动';
    const label = page.kind === 'lecture' ? '存疑标记' : sourceLabel(page.source);
    return `<tr><td>${esc(page.pageNumber)}</td><td>${math(page.title)}${page.highError ? '<br><small class="muted">建议复核</small>' : ''}</td><td>${esc(module)}</td><td>${esc(label)}</td>
      <td>${esc(percent(page.firstRoundAccuracy))}</td><td>${esc(percent(page.secondRoundAccuracy))}</td>
      <td>${esc(percent(page.pairedRevisionRate))}</td><td>${esc(page.muddyCount ?? 0)}</td></tr>`;
  }).join('');
  return reportDocument('教研复盘报告', state.lecture?.title ?? state.lesson?.title ?? '课堂复盘', state.code, `
    <section><h2>课堂实测核心指标</h2><dl class="kpis">${kpis.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
      <p><b>汇总来源</b> ${sourceLabel(source)}</p>
      <p class="muted">互动提交者跨页去重，填写率按作答份数，正解率按可计分页等权平均，改答率按同页两轮配对。</p>
      <p><b>存疑人数最多的讲授页</b> ${topMuddyPage ? `${pageHeading(topMuddyPage)}（${esc(topMuddyPage.count)} 人）` : '暂无存疑标记'}</p></section>
    <section><h2>全卷页面学情</h2>${pageDetails ? `<div class="table-scroll"><table><thead><tr><th scope="col">页码</th>
      <th scope="col">标题</th><th scope="col">模组</th><th scope="col">样本</th><th scope="col">首轮正解率</th>
      <th scope="col">二轮正解率</th><th scope="col">配对改答率</th><th scope="col">存疑</th></tr></thead><tbody>${pageDetails}</tbody></table></div>` : '<p class="muted">暂无已开展互动或存疑标记</p>'}</section>`);
}

export function downloadHtml(html, filename) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  try { link.click(); }
  finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
