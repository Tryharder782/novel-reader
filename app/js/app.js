// Читалка: роутер и экраны.
import { parseFrontmatter, parseBlocks, renderInline, escapeHtml as esc } from './markdown.js';
import { renderComponent, inlineSpell } from './iui.js';
import { Glossary, CATEGORY_ORDER } from './glossary.js';
import { settings, applySettings, progress } from './store.js';

const $app = document.getElementById('app');
const $bar = document.getElementById('topbar');
const $title = document.getElementById('topbar-title');
const $back = document.getElementById('btn-back');
const $aa = document.getElementById('btn-aa');
const $sheet = document.getElementById('sheet');
const $sheetBody = document.getElementById('sheet-body');
const $progress = document.getElementById('read-progress');

let library = null;
const glossaryCache = new Map();
let current = { view: null, slug: null, n: null, cleanup: null };

applySettings();

// ---------- Данные ----------

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function loadLibrary(force = false) {
  if (library && !force) return library;
  library = await fetchJson('content/library.json');
  return library;
}

async function loadGlossary(slug) {
  if (glossaryCache.has(slug)) return glossaryCache.get(slug);
  const novel = library.novels.find(n => n.slug === slug);
  let g = new Glossary({ terms: [] });
  if (novel?.hasGlossary) {
    try { g = new Glossary(await fetchJson(`content/${slug}/glossary.json`)); } catch (e) { console.warn(e); }
  }
  glossaryCache.set(slug, g);
  return g;
}

const findNovel = slug => library.novels.find(n => n.slug === slug);

// ---------- Роутер ----------
//   #/                      библиотека
//   #/n/<slug>              оглавление
//   #/n/<slug>/c/<n>        глава
//   #/n/<slug>/glossary     глоссарий
//   #/settings              настройки

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'n' && parts[1]) {
    if (parts[2] === 'c' && parts[3]) return { view: 'chapter', slug: parts[1], n: Number(parts[3]) };
    if (parts[2] === 'glossary') return { view: 'glossary', slug: parts[1] };
    return { view: 'novel', slug: parts[1] };
  }
  if (parts[0] === 'settings') return { view: 'settings' };
  return { view: 'library' };
}

async function route() {
  if (current.cleanup) { current.cleanup(); current.cleanup = null; }
  closeSheet();
  const r = parseRoute();
  current = { ...current, ...r };
  document.body.dataset.view = r.view;
  $progress.style.transform = 'scaleX(0)';
  try {
    await loadLibrary();
    if (r.view === 'library') return viewLibrary();
    if (r.view === 'novel') return viewNovel(r.slug);
    if (r.view === 'chapter') return viewChapter(r.slug, r.n);
    if (r.view === 'glossary') return viewGlossary(r.slug);
    if (r.view === 'settings') return viewSettings();
  } catch (err) {
    console.error(err);
    setBar('Ошибка', '#/');
    $app.innerHTML = `<div class="page"><div class="empty">Не удалось загрузить данные.<br><small>${esc(err.message)}</small><br><br>
      Если вы офлайн, откройте главы, которые уже были загружены.</div></div>`;
  }
}

function setBar(title, backHref, showAa = false) {
  $title.textContent = title;
  $back.hidden = !backHref;
  $back.onclick = () => { location.hash = backHref; };
  $aa.hidden = !showAa;
  $bar.classList.remove('hidden');
}

// ---------- Библиотека ----------

function viewLibrary() {
  setBar('Библиотека', null);
  const cards = library.novels.map(n => {
    const p = progress.get(n.slug);
    const last = p.last && n.chapters.find(c => c.n === p.last);
    const first = n.chapters[0];
    const target = last || first;
    return `
      <article class="novel-card">
        <a class="novel-card-main" href="#/n/${n.slug}">
          <div class="novel-title">${esc(n.title)}</div>
          ${n.original ? `<div class="novel-orig">${esc(n.original)}</div>` : ''}
          <div class="novel-meta">${n.chapters.length} гл. · ${n.chapters.length ? `${n.chapters[0].n}–${n.chapters.at(-1).n}` : 'пусто'}</div>
        </a>
        ${target ? `<a class="btn btn-primary" href="#/n/${n.slug}/c/${target.n}">${last ? 'Продолжить: гл. ' + target.n : 'Начать читать'}</a>` : ''}
      </article>`;
  }).join('');
  $app.innerHTML = `
    <div class="page">
      ${cards || '<div class="empty">Пока нет ни одного тайтла.</div>'}
      <a class="link-row" href="#/settings">⚙ Настройки</a>
    </div>`;
}

// ---------- Оглавление ----------

function viewNovel(slug) {
  const novel = findNovel(slug);
  if (!novel) { location.hash = '#/'; return; }
  setBar(novel.title, '#/');
  const p = progress.get(slug);
  const rows = novel.chapters.map(c => {
    const isRead = p.read.includes(c.n);
    const isLast = p.last === c.n;
    return `
      <a class="ch-row ${isRead ? 'read' : ''} ${isLast ? 'last' : ''}" href="#/n/${slug}/c/${c.n}">
        <span class="ch-n">${c.n}</span>
        <span class="ch-title">${esc(c.title)}</span>
        <span class="ch-mark">${isLast ? '●' : isRead ? '✓' : ''}</span>
      </a>`;
  }).join('');

  $app.innerHTML = `
    <div class="page">
      <header class="novel-head">
        <h1>${esc(novel.title)}</h1>
        ${novel.original ? `<div class="novel-orig">${esc(novel.original)}</div>` : ''}
        ${novel.description ? `<p class="novel-desc">${renderInline(novel.description)}</p>` : ''}
        <div class="btn-row">
          ${novel.hasGlossary ? `<a class="btn" href="#/n/${slug}/glossary">📖 Глоссарий</a>` : ''}
          <button class="btn" id="btn-offline">⤓ Скачать для офлайна</button>
        </div>
        <div class="offline-status" id="offline-status"></div>
      </header>
      <div class="ch-list">${rows}</div>
    </div>`;

  document.getElementById('btn-offline').onclick = () => downloadOffline(novel);
}

async function downloadOffline(novel) {
  const status = document.getElementById('offline-status');
  if (!('caches' in window)) { status.textContent = 'Браузер не поддерживает офлайн-кэш.'; return; }
  const cache = await caches.open('content-v1');
  const urls = [
    'content/library.json',
    ...(novel.hasGlossary ? [`content/${novel.slug}/glossary.json`] : []),
    ...novel.chapters.map(c => c.file),
  ];
  let done = 0;
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: 'no-cache' });
      if (r.ok) await cache.put(new URL(u, location.href).href, r);
    } catch { /* пропускаем */ }
    done++;
    status.textContent = `Загрузка: ${done} / ${urls.length}`;
  }
  status.textContent = `✓ Сохранено ${novel.chapters.length} глав для офлайна`;
}

// ---------- Глава ----------

async function viewChapter(slug, n) {
  const novel = findNovel(slug);
  if (!novel) { location.hash = '#/'; return; }
  const idx = novel.chapters.findIndex(c => c.n === n);
  if (idx < 0) { location.hash = `#/n/${slug}`; return; }
  const ch = novel.chapters[idx];
  const prev = novel.chapters[idx - 1];
  const next = novel.chapters[idx + 1];

  setBar(`Глава ${n}`, `#/n/${slug}`, true);
  $app.innerHTML = '<div class="page"><div class="empty">Загрузка…</div></div>';

  const [text, glossary] = await Promise.all([
    fetch(ch.file, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }),
    loadGlossary(slug),
  ]);
  if (current.view !== 'chapter' || current.n !== n) return; // ушли со страницы

  const { meta, body } = parseFrontmatter(text);
  const hero = novel.hero ? { name: novel.hero.name, level: meta.hero_level ?? null } : null;
  const ctx = { hero, inlineSpell };

  const html = parseBlocks(body).map(b => {
    if (b.type === 'p') return `<p>${renderInline(b.text, { inlineSpell }).replace(/\n/g, '<br>')}</p>`;
    if (b.type === 'h') return `<h${b.level + 1}>${renderInline(b.text)}</h${b.level + 1}>`;
    if (b.type === 'quote') return `<blockquote>${b.text.split(/\n\s*\n/).map(x => `<p>${renderInline(x, { inlineSpell })}</p>`).join('')}</blockquote>`;
    if (b.type === 'component') return renderComponent(b, ctx);
    return '';
  }).join('\n');

  $app.innerHTML = `
    <article class="chapter">
      <header class="chapter-head">
        <div class="chapter-num">Глава ${n}</div>
        <h1 class="chapter-title">${esc(meta.title || ch.title)}</h1>
      </header>
      <div class="prose">${html}</div>
      <nav class="chapter-nav">
        ${prev ? `<a class="btn" href="#/n/${slug}/c/${prev.n}">← Гл. ${prev.n}</a>` : '<span></span>'}
        <a class="btn" href="#/n/${slug}">Оглавление</a>
        ${next ? `<a class="btn btn-primary" href="#/n/${slug}/c/${next.n}">Гл. ${next.n} →</a>` : '<span class="btn ghost">Конец</span>'}
      </nav>
    </article>`;

  const s = settings.get();
  glossary.annotate($app, n, s.glossary);
  progress.touch(slug, n);

  // Тап по термину — инлайн-сноска под абзацем с плавной анимацией раскрытия/скрытия
  const closeInlineCard = () => {
    $app.querySelectorAll('.gl-inline-wrap:not(.closing)').forEach(el => {
      el.classList.add('closing');
      el.classList.remove('open');
      setTimeout(() => el.remove(), 270);
    });
    $app.querySelectorAll('.gl-term.active').forEach(el => el.classList.remove('active'));
  };
  const onClick = e => {
    if (e.target.closest('[data-close-card]')) {
      e.stopPropagation();
      closeInlineCard();
      return;
    }
    const t = e.target.closest('.gl-term');
    if (t) {
      e.stopPropagation();
      const wasActive = t.classList.contains('active');
      closeInlineCard();
      if (wasActive) return;
      t.classList.add('active');
      const wrap = document.createElement('aside');
      wrap.className = 'gl-inline-wrap';
      wrap.innerHTML = `<div class="gl-inline-inner">${glossary.cardHtml(t.dataset.term, n)}</div>`;
      const anchor = t.closest('p, blockquote') || t;
      anchor.insertAdjacentElement('afterend', wrap);
      requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
    }
  };
  $app.addEventListener('click', onClick);

  // Восстановление позиции
  const saved = progress.get(slug).pos[n];
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - innerHeight;
    window.scrollTo(0, saved && saved < 0.98 ? saved * max : 0);
  });

  // Прогресс, автоскрытие панели, отметка «прочитано»
  let lastY = scrollY;
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      const ratio = Math.min(1, Math.max(0, scrollY / max));
      $progress.style.transform = `scaleX(${ratio})`;
      const dy = scrollY - lastY;
      if (dy > 8 && scrollY > 80) $bar.classList.add('hidden');
      else if (dy < -8) $bar.classList.remove('hidden');
      lastY = scrollY;
      progress.savePos(slug, n, ratio);
      if (ratio > 0.97) progress.markRead(slug, n);
    });
  };
  addEventListener('scroll', onScroll, { passive: true });

  current.cleanup = () => {
    removeEventListener('scroll', onScroll);
    $app.removeEventListener('click', onClick);
  };
}

// ---------- Глоссарий ----------

async function viewGlossary(slug) {
  const novel = findNovel(slug);
  if (!novel) { location.hash = '#/'; return; }
  setBar('Глоссарий', `#/n/${slug}`);
  const g = await loadGlossary(slug);
  const p = progress.get(slug);
  // Без спойлеров: только то, что известно к самой дальней открытой главе.
  const upTo = Math.max(p.maxSeen || 0, p.maxRead || 0, 0);

  const render = (filter = '') => {
    const q = filter.trim().toLowerCase();
    const terms = g.known(upTo).filter(t =>
      !q || t.name.toLowerCase().includes(q) || (t.original || '').toLowerCase().includes(q));
    const groups = new Map();
    for (const t of terms) {
      const c = t.category || 'Термины';
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(t);
    }
    const order = [...CATEGORY_ORDER, ...[...groups.keys()].filter(k => !CATEGORY_ORDER.includes(k))];
    const html = order.filter(c => groups.has(c)).map(c => `
      <h2 class="gl-group">${esc(c)}</h2>
      ${groups.get(c).sort((a, b) => a.name.localeCompare(b.name, 'ru')).map(t => `
        <button class="gl-row" data-term="${esc(t.id)}">
          <span class="gl-row-name">${esc(t.name)}</span>
          ${t.original ? `<span class="gl-row-orig">${esc(t.original)}</span>` : ''}
        </button>`).join('')}`).join('');
    document.getElementById('gl-list').innerHTML = html ||
      `<div class="empty">${upTo ? 'Ничего не найдено.' : 'Откройте хотя бы одну главу — глоссарий заполняется по мере чтения.'}</div>`;
  };

  $app.innerHTML = `
    <div class="page">
      <input class="search" id="gl-search" type="search" placeholder="Поиск по глоссарию" autocomplete="off">
      <div class="gl-hint">Показано то, что известно к главе ${upTo || '—'}.</div>
      <div id="gl-list"></div>
    </div>`;
  render();
  document.getElementById('gl-search').oninput = e => render(e.target.value);
  const glList = document.getElementById('gl-list');
  const closeGlInline = () => {
    glList.querySelectorAll('.gl-inline-wrap:not(.closing)').forEach(el => {
      el.classList.add('closing');
      el.classList.remove('open');
      setTimeout(() => el.remove(), 270);
    });
    glList.querySelectorAll('.gl-row.active').forEach(el => el.classList.remove('active'));
  };
  glList.onclick = e => {
    if (e.target.closest('[data-close-card]')) {
      closeGlInline();
      return;
    }
    const b = e.target.closest('.gl-row');
    if (!b) return;
    const wasActive = b.classList.contains('active');
    closeGlInline();
    if (wasActive) return;
    b.classList.add('active');
    const wrap = document.createElement('div');
    wrap.className = 'gl-inline-wrap';
    wrap.innerHTML = `<div class="gl-inline-inner">${g.cardHtml(b.dataset.term, upTo)}</div>`;
    b.insertAdjacentElement('afterend', wrap);
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  };
}

// ---------- Настройки ----------

function settingsControls() {
  const s = settings.get();
  const seg = (key, options) => `
    <div class="seg" data-key="${key}">
      ${options.map(([v, label]) => `<button class="${String(s[key]) === String(v) ? 'on' : ''}" data-v="${v}">${label}</button>`).join('')}
    </div>`;
  return `
    <div class="set-group">
      <div class="set-label">Стиль интерфейса системы</div>
      ${seg('ui', [['minimal', 'Сдержанный'], ['game', 'Игровой']])}
    </div>
    <div class="set-group">
      <div class="set-label">Тема</div>
      ${seg('theme', [['dark', 'Тёмная'], ['black', 'Чёрная'], ['sepia', 'Сепия'], ['light', 'Светлая']])}
    </div>
    <div class="set-group">
      <div class="set-label">Шрифт</div>
      ${seg('font', [['sans', 'Без засечек'], ['serif', 'С засечками']])}
    </div>
    <div class="set-group">
      <div class="set-label">Размер текста <span class="set-val" id="val-size">${s.fontSize}px</span></div>
      <div class="stepper" data-key="fontSize" data-step="1" data-min="14" data-max="28">
        <button data-d="-1">A−</button><button data-d="1">A+</button>
      </div>
    </div>
    <div class="set-group">
      <div class="set-label">Межстрочный интервал <span class="set-val" id="val-lh">${s.lineHeight}</span></div>
      <div class="stepper" data-key="lineHeight" data-step="0.1" data-min="1.3" data-max="2.2">
        <button data-d="-1">−</button><button data-d="1">+</button>
      </div>
    </div>
    <div class="set-group">
      <div class="set-label">Подсветка терминов глоссария</div>
      ${seg('glossary', [['first', 'Первое упоминание'], ['all', 'Все'], ['off', 'Выкл.']])}
    </div>`;
}

function bindSettings(container, onChange) {
  container.querySelectorAll('.seg').forEach(seg => {
    seg.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      settings.set({ [seg.dataset.key]: b.dataset.v });
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      onChange?.(seg.dataset.key);
    };
  });
  container.querySelectorAll('.stepper').forEach(st => {
    st.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      const key = st.dataset.key;
      const step = Number(st.dataset.step);
      const cur = settings.get()[key];
      const v = Math.round(Math.min(Number(st.dataset.max), Math.max(Number(st.dataset.min), cur + step * Number(b.dataset.d))) * 10) / 10;
      settings.set({ [key]: v });
      const label = container.querySelector(key === 'fontSize' ? '#val-size' : '#val-lh');
      if (label) label.textContent = key === 'fontSize' ? v + 'px' : v;
      onChange?.(key);
    };
  });
}

function viewSettings() {
  setBar('Настройки', '#/');
  $app.innerHTML = `
    <div class="page">
      ${settingsControls()}
      <div class="preview-box">
        <div class="set-label">Предпросмотр</div>
        <div class="prose">
          <p>Я медленно поднял голову и посмотрел на <span class="gl-term">стоявшую</span> передо мной девушку.</p>
          ${renderComponent({ type: 'component', kind: 'block', name: 'status', raw: 'name: Кайя Астреан\nlevel: 90\nrace: Человек\nelements: [Ветер, Лёд]\ndanger: ✕' }, { hero: { name: 'Исаак', level: 26 }, inlineSpell })}
          ${renderComponent({ type: 'component', name: 'spell', data: { name: 'Создание льда', element: 'Льда', stars: 1 } }, { inlineSpell })}
        </div>
      </div>
      <div class="about" id="about"></div>
    </div>`;
  bindSettings($app);
  showBuildInfo();
}

async function showBuildInfo() {
  const el = document.getElementById('about');
  if (!el) return;
  let build = '—';
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.active) {
      const ch = new MessageChannel();
      build = await new Promise(res => {
        ch.port1.onmessage = e => res(e.data);
        reg.active.postMessage('build-id', [ch.port2]);
        setTimeout(() => res('—'), 800);
      });
    }
  } catch { /* нет SW */ }
  el.textContent = `Сборка: ${build} · данные: ${new Date(library.generated).toLocaleString('ru-RU')}`;
}

// ---------- Нижний лист (карточки, настройки в главе) ----------

function openSheet(html) {
  $sheetBody.innerHTML = html;
  $sheet.classList.add('open');
  $sheet.setAttribute('aria-hidden', 'false');
}

function closeSheet() {
  $sheet.classList.remove('open');
  $sheet.setAttribute('aria-hidden', 'true');
}

$sheet.addEventListener('click', e => {
  if (e.target === $sheet || e.target.closest('[data-close]')) closeSheet();
});

$aa.onclick = () => {
  openSheet(`<div class="sheet-settings">${settingsControls()}</div>`);
  bindSettings($sheetBody, key => {
    if (key === 'glossary' && current.view === 'chapter') {
      // Перерисовать главу с новым режимом подсветки, сохранив позицию
      const y = scrollY;
      viewChapter(current.slug, current.n).then(() => scrollTo(0, y));
    }
  });
};

// ---------- Service Worker и обновления ----------

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast();
      });
    });
    // Проверять обновление при возвращении в приложение
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(err => console.warn('SW:', err));
}

function showUpdateToast() {
  const t = document.getElementById('toast');
  t.innerHTML = 'Читалка обновилась <button id="toast-reload">Перезапустить</button>';
  t.classList.add('show');
  document.getElementById('toast-reload').onclick = () => location.reload();
}

// Новые главы: при возврате в приложение перечитываем library.json
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  try {
    const before = library?.generated;
    await loadLibrary(true);
    glossaryCache.clear();
    if (before && before !== library.generated && (current.view === 'library' || current.view === 'novel')) route();
  } catch { /* офлайн */ }
});

addEventListener('hashchange', route);
route();
