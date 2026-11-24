import { renderSoloChallenge } from './challenge-lab.mjs';

function selectChallenge() {
  const selected = location.hash === '#rc' ? 'rc' : 'light';
  for (const kind of ['light','rc']) {
    const root = document.getElementById(kind);
    root.hidden = kind !== selected;
    const link = document.querySelector('nav a[href="#'+kind+'"]');
    if (root.hidden) link.removeAttribute('aria-current');
    else {
      link.setAttribute('aria-current', 'page');
      if (!root.firstElementChild) renderSoloChallenge(root, kind);
    }
  }
}

addEventListener('hashchange', selectChallenge);
selectChallenge();
