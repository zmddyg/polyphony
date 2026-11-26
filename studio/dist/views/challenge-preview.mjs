import { renderSoloChallenge } from './challenge-lab.mjs';
import { mountMzmInstrument } from './mzm-instrument.mjs';

function selectChallenge() {
  const selected = ['#rc','#light'].includes(location.hash) ? location.hash.slice(1) : 'optics';
  for (const kind of ['optics','light','rc']) {
    const root = document.getElementById(kind);
    root.hidden = kind !== selected;
    const link = document.querySelector('nav a[href="#'+kind+'"]');
    if (root.hidden) link.removeAttribute('aria-current');
    else {
      link.setAttribute('aria-current', 'page');
      if (!root.firstElementChild) kind === 'optics' ? mountMzmInstrument(root) : renderSoloChallenge(root, kind);
    }
  }
}

addEventListener('hashchange', selectChallenge);
selectChallenge();
