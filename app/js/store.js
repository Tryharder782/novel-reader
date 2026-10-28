// Настройки и прогресс чтения (localStorage).

const DEFAULTS = {
  theme: 'dark',        // dark | black | light | sepia
  ui: 'minimal',        // minimal | game  — стиль компонентов Intelligent UI
  font: 'sans',         // sans | serif
  fontSize: 18,
  lineHeight: 1.7,
  glossary: 'first',    // first | all | off
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
  root.style.setProperty('--reader-size', s.fontSize + 'px');
  root.style.setProperty('--reader-lh', s.lineHeight);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.content = { dark: '#16161e', black: '#000000', light: '#fafaf7', sepia: '#f4ecd8' }[s.theme] || '#16161e';
  }
}

export const progress = {
  get(slug) {
    return { last: null, maxRead: 0, pos: {}, read: [], ...read(keyProgress(slug), {}) };
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
  // Глава считается «открытой» (для глоссария без спойлеров), даже если не дочитана.
  touch(slug, n) {
    const p = this.get(slug);
    p.last = n;
    p.maxSeen = Math.max(p.maxSeen || 0, n);
    write(keyProgress(slug), p);
  },
};
