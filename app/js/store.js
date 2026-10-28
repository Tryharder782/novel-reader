// Настройки и прогресс чтения (localStorage) — RanobeLib Edition.

const DEFAULTS = {
  theme: 'dark',        // dark | black | dusk | sepia | light
  ui: 'minimal',        // minimal | game  — стиль компонентов Intelligent UI
  font: 'sans',         // sans | serif
  fontSize: 17,
  lineHeight: 1.65,
  paraGap: 0.85,        // отступ между абзацами в em
  containerWidth: 740,  // макс. ширина текста в px
  align: 'left',        // left | justify
  glossary: 'first',    // first | all | off
  immersive: 'on',      // on | off  — скрывать шторку и кнопки телефона в полноэкранном режиме
};

const KEY_SETTINGS = 'reader:settings';
const keyProgress = slug => `reader:progress:${slug}`;

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* квота */ }
}

export const settings = {
  get() { return { ...DEFAULTS, ...read(KEY_SETTINGS, {}) }; },
  set(patch) {
    const next = { ...this.get(), ...patch };
    write(KEY_SETTINGS, next);
    applySettings(next);
    return next;
  },
};

export function applySettings(s = settings.get()) {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.ui = s.ui;
  root.dataset.font = s.font;
  root.dataset.align = s.align;
  root.style.setProperty('--reader-size', s.fontSize + 'px');
  root.style.setProperty('--reader-lh', s.lineHeight);
  root.style.setProperty('--reader-gap', s.paraGap + 'em');
  root.style.setProperty('--maxw', s.containerWidth + 'px');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.content = {
      dark: '#141416',
      black: '#000000',
      dusk: '#161922',
      sepia: '#f4ecd8',
      light: '#ffffff',
    }[s.theme] || '#141416';
  }
}

export const progress = {
  get(slug) {
    return { last: null, maxRead: 0, maxSeen: 0, pos: {}, read: [], ...read(keyProgress(slug), {}) };
  },
  savePos(slug, n, ratio) {
    const p = this.get(slug);
    p.last = n;
    p.pos[n] = Math.round(ratio * 1000) / 1000;
    write(keyProgress(slug), p);
  },
  markRead(slug, n) {
    const p = this.get(slug);
    if (!p.read.includes(n)) p.read.push(n);
    p.maxRead = Math.max(p.maxRead, n);
    write(keyProgress(slug), p);
  },
  toggleRead(slug, n) {
    const p = this.get(slug);
    const idx = p.read.indexOf(n);
    if (idx >= 0) p.read.splice(idx, 1);
    else p.read.push(n);
    p.maxRead = p.read.length ? Math.max(...p.read) : 0;
    write(keyProgress(slug), p);
    return p.read.includes(n);
  },
  touch(slug, n) {
    const p = this.get(slug);
    p.last = n;
    p.maxSeen = Math.max(p.maxSeen || 0, n);
    write(keyProgress(slug), p);
  },
};
