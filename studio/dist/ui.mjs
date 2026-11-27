const shapes = {
  desk:'<rect x="3" y="3.5" width="18" height="17" rx="3"/><path d="M3 9h18M10 9v11"/>',
  workshop:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h3M3 7h3M3 12h3M3 17h3"/>',
  lab:'<path d="M9 3h6m-5 0v6l-6 9a2 2 0 0 0 1.7 3h12.6a2 2 0 0 0 1.7-3l-6-9V3m-7 12h10"/>',
  replay:'<path d="M3.5 11.5a8.5 8.5 0 1 1 1.8 6.3M3 5v6h6m3-4v5l3 2"/>',
  layers:'<path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5m-18 5 9 5 9-5"/>',
  monitor:'<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M12 17v3m-4 1h8"/>',
  smartphone:'<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>', 'chevron-right':'<path d="m9 6 6 6-6 6"/>',
  'chevron-down':'<path d="m6 9 6 6 6-6"/>','arrow-right':'<path d="M4 12h15m-6-6 6 6-6 6"/>',
  'arrow-left':'<path d="M20 12H5m6 6-6-6 6-6"/>','arrow-up-right':'<path d="M6 18 18 6M7 6h11v11"/>',
  copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15.5 8V4.8A1.8 1.8 0 0 0 13.7 3H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
  radio:'<circle cx="12" cy="12" r="1.8"/><path d="M8.2 7.8a5.8 5.8 0 0 0 0 8.4m7.6-8.4a5.8 5.8 0 0 1 0 8.4M5.2 4.5a10.4 10.4 0 0 0 0 15m13.6-15a10.4 10.4 0 0 1 0 15"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5"/>',
  user:'<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  scan:'<path d="M3 9V4h5m8 0h5v5m0 6v5h-5M8 20H3v-5"/><path d="M7 8h3v3H7zm7 0h3v3h-3zm-7 6h3v3H7zm7 0h1m2 1v2h-3"/>',
  maximize:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  sparkles:'<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm7 12 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/>',
  shuffle:'<path d="M3 6h3c4 0 7 12 11 12h4m-4-4 4 4-4 4M3 18h3c2 0 4-4 5-6m3-4c1-1 2-2 3-2h4m-4-4 4 4-4 4"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',check:'<path d="m4 12 5 5L20 6"/>',
  circle:'<circle cx="12" cy="12" r="4"/>', list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1"/>',
  network:'<rect x="8" y="2.5" width="8" height="5.5" rx="1.4"/><path d="M12 8v5M5 16v-3h14v3"/><rect x="2" y="16" width="6" height="5" rx="1.3"/><rect x="16" y="16" width="6" height="5" rx="1.3"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.4 1-1.5 1.5-1.5 2.5m0 3h.01"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  book:'<path d="M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1V5Zm9 1v14"/>',
  play:'<path d="m7 4 13 8-13 8V4Z"/>', target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'
};
const aliases = { dashboard:'desk', panels:'desk', archive:'workshop', flask:'lab', activity:'radio', history:'replay', screen:'monitor', projection:'monitor', phone:'smartphone', external:'arrow-up-right', qr:'scan', stop:'close', x:'close', menu:'menu', chart:'layers','book-open':'book','external-link':'arrow-up-right','file-text':'workshop','arrow-down':'chevron-down','check-circle':'check', 'log-in':'arrow-right', edit:'workshop', 'git-branch':'network', grid:'desk' };
export function icon(name,size=18) {
  return '<svg aria-hidden="true" width="'+Number(size)+'" height="'+Number(size)+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">'+(shapes[name] || shapes[aliases[name]] || shapes.circle)+'</svg>';
}
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Keep the cascade in this order regardless of which view is opened first.
export const viewStyles = [
  'desk', 'workshop', 'lab', 'cognition', 'surfaces', 'student', 'replay', 'material-workspace',
  'material-notes', 'material-science', 'lecture-stage', 'lecture-room', 'challenge-lab',
];

