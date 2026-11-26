import { startApplication } from '../dist/app.mjs';
import { validateLectureScore } from '../dist/core/lecture-score.mjs';

function renderMenu(root, ctx) {
  const decks = JSON.parse(document.querySelector('#polyphony-demo-decks').textContent);
  root.innerHTML = `<section class="prep-workspace"><h1 class="prep-title">比赛演示</h1>
    <div class="prep-card"><h2>选择一节演示课</h2>
      <div class="prep-demo-decks">${decks.map((deck, i) => `<button type="button" class="plain-button" data-demo-deck="${i}">
        <strong>${ctx.esc(deck.label)}</strong>
        <small>${deck.score.pages.length} 页 · ${deck.score.pages.filter(page => page.interaction).length} 个互动</small>
      </button>`).join('')}</div>
      <button type="button" class="text-button" data-demo-gallery>查看交互模组和架构</button>
      <p role="status" data-demo-status></p>
    </div></section>`;
  root.querySelector('[data-demo-gallery]').onclick = () => ctx.go('lab');
  const status = root.querySelector('[data-demo-status]');
  const buttons = [...root.querySelectorAll('[data-demo-deck]')];
  for (const button of buttons) button.onclick = async () => {
    for (const item of buttons) item.disabled = true;
    status.textContent = '正在打开演示课…';
    try { await ctx.startLecture(validateLectureScore(decks[Number(button.dataset.demoDeck)].score)); }
    catch (error) {
      status.textContent = error.message;
      for (const item of buttons) item.disabled = false;
    }
  };
}

startApplication({ renderMenu, loadGallery: () => import('./lab.mjs').then(module => module.renderLab) });
