import { startApplication } from '../dist/app.mjs';
import { blockText, validateLectureScore } from '../dist/core/lecture-score.mjs';
import { createMaterialNotebook, makeMaterialVersionId } from '../dist/core/material-notebook.mjs';

const decks = JSON.parse(document.querySelector('#polyphony-demo-decks').textContent);
const highlights = [
  ['指针 P7 · swap_bug 逐行找茬', '从第一处空指针解引用找起'],
  ['光学 P5 · 多缝衍射公式沙盒', '改变缝数并锁定对照曲线'],
  ['英语 P8 · 盲盒 AI 辩友', '先给出立场，再检验质询所用的证据'],
  ['全卷学情复盘', '三道题跑完两轮，查看模拟班各页结果'],
];

const paragraph = text => text.split('\n').map(line => '> ' + line).join('\n');
const codeFence = ({ language, code }) => ['```' + (language || ''), code, '```'].join('\n');

function markdownBlock(block) {
  const title = block.title ? paragraph(block.title) + '\n\n' : '';
  switch (block.type) {
    case 'code': return title + codeFence(block);
    case 'code-pair':
      return paragraph([block.left.title, block.right.title].filter(Boolean).join(' / ')) +
        '\n\n' + codeFence(block.left) + '\n\n' + codeFence(block.right);
    case 'table': {
      const row = cells => '| ' + cells.map(cell => cell.replaceAll('|', '∣').replace(/\s+/g, ' ')).join(' | ') + ' |';
      return title + [row(block.headers), row(block.headers.map(() => '---')), ...block.rows.map(row)].join('\n');
    }
    case 'formula': return title + block.items.map(item => '$$' + item + '$$').join('\n\n');
    case 'bullets': case 'steps':
      return title + block.items.map((item, index) => (block.type === 'steps' ? (index + 1) + '. ' : '- ') + item).join('\n');
    default: return paragraph(blockText(block));
  }
}

const rawMarkdown = decks[0].score.pages.slice(0, 8).map(page =>
  '# ' + page.title + '\n\n' + (page.blocks?.map(markdownBlock).join('\n\n') ?? page.body.join('\n'))
).join('\n\n---\n\n');
const rawVersion = await makeMaterialVersionId({ bytes: rawMarkdown });

// The classroom and its editable source must share the same notebook anchor.
async function preparedScore(input) {
  const score = validateLectureScore(input);
  const versionId = await makeMaterialVersionId({ bytes: JSON.stringify(score) });
  const notebook = createMaterialNotebook();
  if (!(await notebook.getVersion(versionId))) {
    await notebook.saveVersion({
      versionId, name: score.source.name, title: score.title, type: score.source.kind,
      pages: score.pages.map(({ interaction, adopted, ...page }) => ({ ...page, text: page.body.join('\n') })),
      draft: { title: score.title, source: 'json-import',
        adopted: score.pages.filter(page => page.adopted.length).map(page => [page.number, { slides: page.adopted }]),
        interactions: score.pages.filter(page => page.interaction).map(page => [page.number, page.interaction]),
      },
    });
  }
  return { ...score, source: { ...score.source, versionId } };
}

function interactionPages(score) {
  let index = 0;
  return score.pages.flatMap(page => {
    const target = { page, index };
    index += 1 + page.adopted.length;
    return page.interaction ? [target] : [];
  });
}

async function enterInteraction(send, index) {
  await send('lectureNavigate', { index });
  await send('lectureInteract');
}

async function completeLecture(send, score) {
  for (const { page, index } of interactionPages(score)) {
    await enterInteraction(send, index);
    await send('demoFill');
    await send('reveal');
    const first = await send('analyze', { fastLocal: true });
    await send('branch', { branchId: first.analysis?.recommendedId ?? page.interaction.branches[0].id });
    await send('revise');
    await send('demoFill');
    await send('reveal');
    await send('analyze', { fastLocal: true });
    await send('close');
  }
  await send('lectureFinish');
}

function createExtension() {
  const guide = document.createElement('div');
  guide.className = 'demo-guide';
  let getContext, openFile, toggle, panel, status;
  let working = false;

  function fitPanel() {
    const top = Math.ceil(guide.getBoundingClientRect().bottom + 10);
    guide.style.setProperty('--demo-guide-top', top + 'px');
  }

  function setOpen(open, focus = true) {
    if (open) fitPanel();
    toggle.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
    if (focus) (open ? panel.querySelector('[data-demo-close]') : toggle).focus({ preventScroll: true });
  }

  async function openLecture(deck, target) {
    const score = await preparedScore(decks[deck].score);
    if (target === 'replay') {
      await getContext().startLecture(score, { prepare: send => completeLecture(send, score) });
      return;
    }
    const prepare = target == null ? undefined : async send => {
      const point = interactionPages(score).find(({ page }) => page.number === target);
      if (!point) throw new Error('示范课的互动页已调整，请从课件预览打开。');
      await enterInteraction(send, point.index);
      if (point.page.interaction.activityId === 'evidence-weighing@1') await send('toggleAiPeer');
    };
    await getContext().startLecture(score, { initialSplit: true, prepare });
  }

  async function run(button) {
    if (working) return;
    working = true;
    status.textContent = '正在载入…';
    const actions = [...panel.querySelectorAll('.demo-guide-action')];
    actions.forEach(item => { item.disabled = true; });
    try {
      if (button.hasAttribute('data-demo-source')) {
        await openFile(new File([rawMarkdown], 'C 指针原稿 · 8 页.md', { type: 'text/markdown' }));
      } else if (button.hasAttribute('data-demo-preview')) {
        const { label, score } = decks[Number(button.dataset.demoPreview)];
        await openFile(new File([JSON.stringify(score)], label + '.json', { type: 'application/json' }));
      } else if (button.hasAttribute('data-demo-teach')) {
        await openLecture(Number(button.dataset.demoTeach));
      } else {
        const index = Number(button.dataset.demoHighlight);
        if (index === 3) await openLecture(0, 'replay');
        else await openLecture(index, [7, 5, 8][index]);
      }
      status.textContent = '';
      setOpen(false, guide.contains(document.activeElement));
    } catch (error) {
      status.textContent = error.message;
      getContext().toast(error.message);
    } finally {
      working = false;
      actions.forEach(item => { item.disabled = false; });
    }
  }

  function mountHeader(host, context, openMaterialFile) {
    getContext = context;
    openFile = openMaterialFile;
    if (!guide.firstElementChild) {
      const { esc } = context();
      guide.innerHTML = `<button class="demo-guide-toggle" type="button" data-demo-toggle aria-expanded="false"
        aria-controls="demo-guide-panel" aria-keyshortcuts="D" aria-label="🎬 示范课与导览">
        <span aria-hidden="true">🎬</span><span class="demo-guide-label">示范课与导览</span><kbd aria-hidden="true">D</kbd></button>
        <aside id="demo-guide-panel" class="demo-guide-panel" data-demo-panel aria-labelledby="demo-guide-title" hidden>
          <header><h2 id="demo-guide-title">示范课与导览</h2>
            <button type="button" class="demo-guide-close" data-demo-close aria-label="收起示范课与导览">×</button></header>
          <section class="demo-guide-section"><h3>📂 原稿活化快演</h3>
            <button class="demo-guide-action demo-guide-source" type="button" data-demo-source>载入 8 页 C 指针原稿</button>
            <p>用内置原稿试跑五阶段编排，查看预设引文错误的修复回执。</p></section>
          <section class="demo-guide-section"><h3>📚 三门完整示范实战课</h3>
            ${decks.map(({ label, score }, index) => `<article class="demo-guide-deck">
              <h4>${esc(label)} <small>${esc(score.pages.length)} 页</small></h4><div>
                <button class="demo-guide-action" type="button" data-demo-preview="${index}">载入备课预览</button>
                <button class="demo-guide-action demo-guide-teach" type="button" data-demo-teach="${index}">🖥+📱 直接同屏开讲</button>
              </div></article>`).join('')}</section>
          <section class="demo-guide-section"><h3>⚡ 四大高光卡点直达</h3>
            <div class="demo-guide-highlights">${highlights.map(([title, detail], index) =>
              `<button class="demo-guide-action" type="button" data-demo-highlight="${index}"><b>${esc(title)}</b><small>${esc(detail)}</small></button>`
            ).join('')}</div></section><p class="demo-guide-status" data-demo-status role="status"></p></aside>`;
      toggle = guide.querySelector('[data-demo-toggle]');
      panel = guide.querySelector('[data-demo-panel]');
      status = guide.querySelector('[data-demo-status]');
      toggle.onclick = () => setOpen(panel.hidden, false);
      guide.querySelector('[data-demo-close]').onclick = () => setOpen(false);
      panel.addEventListener('click', event => {
        const button = event.target.closest('.demo-guide-action');
        if (button) void run(button);
      });
    }
    host.append(guide);
    if (!panel.hidden) fitPanel();
  }

  document.addEventListener('keydown', event => {
    if (!guide.isConnected || event.defaultPrevented || event.repeat || event.isComposing ||
        event.altKey || event.ctrlKey || event.metaKey ||
        document.querySelector('dialog[open], .rail-expanded')) return;
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      setOpen(false, guide.contains(document.activeElement));
    } else if (event.key.toLowerCase() === 'd' && !event.target.closest?.('input, textarea, select, [contenteditable]')) {
      event.preventDefault();
      setOpen(panel.hidden);
    }
  });
  document.addEventListener('pointerdown', event => {
    if (guide.isConnected && !panel.hidden && !guide.contains(event.target)) setOpen(false, false);
  });
  window.addEventListener('resize', () => {
    if (guide.isConnected && !panel.hidden) fitPanel();
  });

  return {
    mountHeader,
    adaptOptions: (material, options) => material.versionId === rawVersion && options.adaptationMode !== 'rebuild'
      ? { ...options, mode: 'demo-replay', useModel: false } : options,
  };
}

startApplication({ extension: createExtension() });
