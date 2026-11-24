import { renderSoloChallenge } from './challenge-lab.mjs';

const kinds = ['light', 'rc', 'blackbox'];

function selectChallenge() {
  const hash = location.hash.slice(1);
  const selected = kinds.includes(hash) ? hash : 'light';
  for (const kind of kinds) {
    const root = document.getElementById(kind);
    root.hidden = kind !== selected;
    const link = document.querySelector('nav a[href="#' + kind + '"]');
    if (root.hidden) link.removeAttribute('aria-current');
    else {
      link.setAttribute('aria-current', 'page');
      if (!root.firstElementChild) renderSoloChallenge(root, kind);
    }
  }
}

addEventListener('hashchange', selectChallenge);
selectChallenge();
