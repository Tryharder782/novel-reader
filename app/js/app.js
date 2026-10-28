// Читалка в стиле RanobeLib: каталог, страница тайтла с вкладками, читалка с верхней/нижней панелями и шторками.
import { parseFrontmatter, parseBlocks, renderInline, escapeHtml as esc } from './markdown.js';
import { renderComponent, inlineSpell } from './iui.js';
import { Glossary, CATEGORY_ORDER } from './glossary.js';
import { settings, applySettings, progress } from './store.js';

const $app = document.getElementById('app');
const $bar = document.getElementById('topbar');
const $center = document.getElementById('topbar-center');
const $title = document.getElementById('topbar-title');
const $sub = document.getElementById('topbar-sub');
const $back = document.getElementById('btn-back');
const $toc = document.getElementById('btn-toc');
const $fs = document.getElementById('btn-fs');
const $aa = document.getElementById('btn-aa');
const $bbar = document.getElementById('bottombar');
const $sheet = document.getElementById('sheet');
const $sheetBody = document.getElementById('sheet-body');
const $progress = document.getElementById('read-progress');

let library = null;
const glossaryCache = new Map();
let current = { view: null, slug: null, n: null, tab: 'chapters', sortDesc: true, cleanup: null };

const EYE_SVG = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

applySettings();

// ---------- Полноэкранный иммерсивный режим (скрытие системных панелей и шторки) ----------

const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

async function toggleFullscreen(force) {
  const isFs = isFullscreen();
  const target = typeof force === 'boolean' ? force : !isFs;
  try {
    if (target && !isFs) {
      const el = document.documentElement;
      if (el.requestFullscreen) {
        await el.requestFullscreen({ navigationUI: 'hide' }).catch(() => el.requestFullscreen());
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      }
    } else if (!target && isFs) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
  } catch (err) {
    console.warn('Fullscreen:', err);
  }
}

function updateFullscreenIcon() {
  const isFs = isFullscreen();
  const enter = document.getElementById('fs-icon-enter');
  const exit = document.getElementById('fs-icon-exit');
  if (enter && exit) {
    enter.hidden = isFs;
    exit.hidden = !isFs;
  }
}
document.addEventListener('fullscreenchange', updateFullscreenIcon);
document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);

// Блокировка отключения экрана во время чтения
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* unsupported */ }
}
function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

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

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'n' && parts[1]) {
    if (parts[2] === 'c' && parts[3]) return { view: 'chapter', slug: parts[1], n: Number(parts[3]) };
    if (parts[2] === 'glossary') return { view: 'novel', slug: parts[1], tab: 'glossary' };
    if (parts[2] === 'about') return { view: 'novel', slug: parts[1], tab: 'about' };
    return { view: 'novel', slug: parts[1], tab: current.slug === parts[1] ? current.tab : 'chapters' };
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
  $bbar.hidden = r.view !== 'chapter';
  $bar.classList.remove('hidden');
  $bbar.classList.remove('hidden');

  try {
    await loadLibrary();
    if (r.view === 'library') return viewLibrary();
    if (r.view === 'novel') return viewNovel(r.slug, r.tab);
    if (r.view === 'chapter') return viewChapter(r.slug, r.n);
    if (r.view === 'settings') return viewSettings();
  } catch (err) {
    console.error(err);
    setBar({ title: 'Ошибка', backHref: '#/' });
    $app.innerHTML = `<div class="page"><div class="empty">Не удалось загрузить данные.<br><small>${esc(err.message)}</small><br><br>
      Если вы офлайн, откройте главы, которые уже были сохранены.</div></div>`;
  }
}

function setBar({ logo = false, title = '', sub = '', backHref = null, onCenter = null, showToc = false, showFs = false }) {
  if (logo) {
    $title.innerHTML = `<span class="rl-logo">Ranobe<span>Lib</span></span>`;
  } else {
    $title.innerHTML = esc(title) + (onCenter ? ' <span style="opacity:.6;font-size:12px">▾</span>' : '');
  }
  $sub.textContent = sub;
  $sub.hidden = !sub;
  $center.classList.toggle('clickable', !!onCenter);
  $center.onclick = onCenter || null;
  $back.hidden = !backHref;
  $back.onclick = () => { location.hash = backHref; };
  $toc.hidden = !showToc;
  if ($fs) {
    $fs.hidden = !showFs;
    updateFullscreenIcon();
  }
}

// ---------- Каталог / Библиотека ----------

function viewLibrary() {
  setBar({ logo: true });
  const cards = library.novels.map(n => {
    const p = progress.get(n.slug);
    const last = p.last && n.chapters.find(c => c.n === p.last);
    const first = n.chapters[0];
    const target = last || first;
    const vol = target?.volume || 1;
    return `
      <article class="rl-catalog-card">
        <a class="rl-catalog-cover" href="#/n/${n.slug}">
          ${n.cover ? `<img src="${esc(n.cover)}" alt="" loading="lazy">` : ''}
          ${n.rating ? `<span class="rl-rating-badge">★ ${esc(n.rating)}</span>` : ''}
        </a>
        <div class="rl-catalog-body">
          <a href="#/n/${n.slug}">
            <div class="rl-catalog-type">${esc(n.type || 'Ранобэ')} · ${esc(n.status || 'Онгоинг')}</div>
            <div class="rl-catalog-title">${esc(n.title)}</div>
            ${n.original ? `<div class="rl-catalog-orig">${esc(n.original)}</div>` : ''}
          </a>
          <div class="rl-catalog-foot">
            <span class="rl-catalog-meta">${p.read.length}/${n.chapters.length} гл.</span>
            ${target ? `<a class="btn btn-primary" href="#/n/${n.slug}/c/${target.n}">${last ? `▶ Том ${vol} Гл. ${target.n}` : '▶ Читать'}</a>` : ''}
          </div>
        </div>
      </article>`;
  }).join('');

  $app.innerHTML = `
    <div class="page">
      <div class="section-head"><span>Каталог тайтлов</span></div>
      ${cards || '<div class="empty">Пока нет ни одного тайтла.</div>'}
    </div>`;
}

// ---------- Страница тайтла (RanobeLib Title Page) ----------

async function viewNovel(slug, initialTab = 'chapters') {
  const novel = findNovel(slug);
  if (!novel) { location.hash = '#/'; return; }
  setBar({ title: novel.title, backHref: '#/' });
  scrollTo(0, 0);

  const glossary = await loadGlossary(slug);
  const p = progress.get(slug);
  const last = p.last && novel.chapters.find(c => c.n === p.last);
  const first = novel.chapters[0];
  const target = last || first;
  const upTo = Math.max(p.maxSeen || 0, p.maxRead || 0, first?.n || 0);
  const knownTerms = glossary.known(upTo);

  const descHtml = (novel.description || '')
    .split(/\n\s*\n/)
    .map(par => `<p>${renderInline(par.trim())}</p>`)
    .join('');

  const tagsHtml = (novel.tags || []).map(t => `<span class="rl-tag">${esc(t)}</span>`).join('');

  $app.innerHTML = `
    <div class="rl-title-wrap">
      <section class="rl-hero">
        ${novel.cover ? `<div class="rl-hero-bg" style="background-image:url('${esc(novel.cover)}')"></div>` : ''}
        <div class="rl-hero-grad"></div>
        <div class="rl-hero-content">
          <div class="rl-poster">
            ${novel.cover ? `<img src="${esc(novel.cover)}" alt="">` : ''}
          </div>
          <div class="rl-hero-info">
            <div class="rl-badges">
              ${novel.rating ? `<span class="rl-badge rl-badge-star">★ ${esc(novel.rating)}</span>` : ''}
              <span class="rl-badge">${esc(novel.type || 'Корея')}</span>
              ${novel.year ? `<span class="rl-badge">${esc(novel.year)}</span>` : ''}
              <span class="rl-badge">${esc(novel.translation || 'Переводится')}</span>
            </div>
            <h1 class="rl-main-title">${esc(novel.title)}</h1>
            ${novel.original ? `<div class="rl-sub-title">${esc(novel.original)}</div>` : ''}
          </div>
        </div>
        <div class="rl-hero-actions">
          ${target ? `<a class="btn btn-primary" href="#/n/${slug}/c/${target.n}">▶ ${last ? `Продолжить · Том ${target.volume || 1} Гл. ${target.n}` : 'Начать читать'}</a>` : ''}
          <button class="btn btn-icon-only" id="btn-offline" title="Скачать все главы для офлайна" aria-label="Скачать для офлайна">⤓</button>
        </div>
        <div class="offline-status" id="offline-status" style="position:relative;z-index:2;font-size:12px;color:var(--text-dim);margin-top:6px"></div>
      </section>

      <div class="rl-tabs" role="tablist">
        <button class="rl-tab" data-tab="about">О тайтле</button>
        <button class="rl-tab" data-tab="chapters">Главы <span class="rl-tab-count">${novel.chapters.length}</span></button>
        ${novel.hasGlossary ? `<button class="rl-tab" data-tab="glossary">База знаний <span class="rl-tab-count">${knownTerms.length}</span></button>` : ''}
      </div>

      <!-- О ТАЙТЛЕ -->
      <section class="rl-tab-panel" id="panel-about" hidden>
        <div class="rl-card">
          <div class="rl-info-grid">
            <div class="rl-info-item"><div class="k">Тип</div><div class="v">${esc(novel.type || 'Корея')}</div></div>
            <div class="rl-info-item"><div class="k">Статус тайтла</div><div class="v">${esc(novel.status || 'Онгоинг')}</div></div>
            <div class="rl-info-item"><div class="k">Статус перевода</div><div class="v">${esc(novel.translation || 'Переводится')}</div></div>
            <div class="rl-info-item"><div class="k">Загружено глав</div><div class="v">${novel.chapters.length}</div></div>
            <div class="rl-info-item"><div class="k">Прочитано</div><div class="v">${p.read.length} из ${novel.chapters.length}</div></div>
            ${novel.hero?.name ? `<div class="rl-info-item"><div class="k">Главный герой</div><div class="v">${esc(novel.hero.name)}</div></div>` : ''}
          </div>
        </div>
        <div class="rl-card">
          <div class="rl-desc">${descHtml || '<p class="muted">Описание отсутствует.</p>'}</div>
          ${tagsHtml ? `<div class="rl-tags">${tagsHtml}</div>` : ''}
        </div>
      </section>

      <!-- ГЛАВЫ -->
      <section class="rl-tab-panel" id="panel-chapters" hidden>
        <div class="rl-ch-toolbar">
          <input class="rl-ch-filter" id="ch-filter" type="search" placeholder="Быстрый поиск главы…" autocomplete="off">
          <button class="rl-sort-btn" id="ch-sort">${current.sortDesc ? '↓ Сначала новые' : '↑ По порядку'}</button>
        </div>
        <div class="rl-ch-list" id="ch-list"></div>
      </section>

      <!-- БАЗА ЗНАНИЙ / ГЛОССАРИЙ -->
      <section class="rl-tab-panel" id="panel-glossary" hidden>
        <input class="search" id="gl-search" type="search" placeholder="Поиск персонажа, места или предмета…" autocomplete="off">
        <div class="gl-hint">Защита от спойлеров активна (открыто до главы ${upTo || '—'}).</div>
        <div id="gl-list"></div>
      </section>
    </div>`;

  // Переключение вкладок
  const switchTab = tab => {
    current.tab = tab;
    $app.querySelectorAll('.rl-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    ['about', 'chapters', 'glossary'].forEach(t => {
      const el = document.getElementById('panel-' + t);
      if (el) el.hidden = t !== tab;
    });
  };
  $app.querySelectorAll('.rl-tab').forEach(b => {
    b.onclick = () => switchTab(b.dataset.tab);
  });
  switchTab(initialTab);

  // Отрисовка списка глав
  const chListEl = document.getElementById('ch-list');
  const chFilterEl = document.getElementById('ch-filter');
  const chSortEl = document.getElementById('ch-sort');

  const renderChapters = () => {
    const q = chFilterEl.value.trim().toLowerCase();
    const prog = progress.get(slug);
    let list = [...novel.chapters];
    if (current.sortDesc) list.reverse();
    if (q) {
      list = list.filter(c => String(c.n).includes(q) || c.title.toLowerCase().includes(q));
    }
    chListEl.innerHTML = list.map(c => {
      const isRead = prog.read.includes(c.n);
      const isCur = prog.last === c.n;
      return `
        <div class="rl-ch-item ${isRead ? 'read' : ''} ${isCur ? 'current' : ''}" data-n="${c.n}">
          <a class="rl-ch-link" href="#/n/${slug}/c/${c.n}">
            <div class="rl-ch-main">
              <span class="rl-ch-vol">Том ${c.volume || 1} Глава ${c.n}</span>
              <span class="rl-ch-name">— ${esc(c.title)}</span>
            </div>
            <div class="rl-ch-sub">${c.date ? esc(c.date) + ' · ' : ''}${c.words} слов</div>
          </a>
          <button class="rl-eye-btn" data-eye="${c.n}" title="${isRead ? 'Отметить непрочитанной' : 'Отметить прочитанной'}" aria-label="Статус прочтения">${EYE_SVG}</button>
        </div>`;
    }).join('') || '<div class="empty">Главы не найдены.</div>';
  };
  renderChapters();

  chFilterEl.oninput = renderChapters;
  chSortEl.onclick = () => {
    current.sortDesc = !current.sortDesc;
    chSortEl.textContent = current.sortDesc ? '↓ Сначала новые' : '↑ По порядку';
    renderChapters();
  };
  chListEl.onclick = e => {
    const eye = e.target.closest('[data-eye]');
    if (!eye) return;
    e.preventDefault();
    e.stopPropagation();
    const n = Number(eye.dataset.eye);
    const nowRead = progress.toggleRead(slug, n);
    eye.closest('.rl-ch-item')?.classList.toggle('read', nowRead);
  };

  // Отрисовка глоссария
  const glList = document.getElementById('gl-list');
  const glSearch = document.getElementById('gl-search');
  if (glList && glSearch) {
    const renderGl = (filter = '') => {
      const q = filter.trim().toLowerCase();
      const terms = glossary.known(upTo).filter(t =>
        !q || t.name.toLowerCase().includes(q) || (t.original || '').toLowerCase().includes(q));
      const groups = new Map();
      for (const t of terms) {
        const c = t.category || 'Термины';
        if (!groups.has(c)) groups.set(c, []);
        groups.get(c).push(t);
      }
      const order = [...CATEGORY_ORDER, ...[...groups.keys()].filter(k => !CATEGORY_ORDER.includes(k))];
      glList.innerHTML = order.filter(c => groups.has(c)).map(c => `
        <h2 class="gl-group">${esc(c)}</h2>
        ${groups.get(c).sort((a, b) => a.name.localeCompare(b.name, 'ru')).map(t => `
          <button class="gl-row" data-term="${esc(t.id)}">
            <span class="gl-row-name">${esc(t.name)}</span>
            ${t.original ? `<span class="gl-row-orig">${esc(t.original)}</span>` : ''}
          </button>`).join('')}`).join('') || '<div class="empty">Ничего не найдено.</div>';
    };
    renderGl();
    glSearch.oninput = e => renderGl(e.target.value);

    const closeGlInline = () => {
      glList.querySelectorAll('.gl-inline-wrap:not(.closing)').forEach(el => {
        el.classList.add('closing');
        el.classList.remove('open');
        setTimeout(() => el.remove(), 270);
      });
      glList.querySelectorAll('.gl-row.active').forEach(el => el.classList.remove('active'));
    };
    glList.onclick = e => {
      if (e.target.closest('[data-close-card]')) { closeGlInline(); return; }
      const b = e.target.closest('.gl-row');
      if (!b) return;
      const wasActive = b.classList.contains('active');
      closeGlInline();
      if (wasActive) return;
      b.classList.add('active');
      const wrap = document.createElement('div');
      wrap.className = 'gl-inline-wrap';
      wrap.innerHTML = `<div class="gl-inline-inner">${glossary.cardHtml(b.dataset.term, upTo)}</div>`;
      b.insertAdjacentElement('afterend', wrap);
      requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
    };
  }

  document.getElementById('btn-offline').onclick = () => downloadOffline(novel);
}

async function downloadOffline(novel) {
  const status = document.getElementById('offline-status');
  if (!('caches' in window)) { status.textContent = 'Браузер не поддерживает офлайн-кэш.'; return; }
  const cache = await caches.open('content-v1');
  const urls = [
    'content/library.json',
    ...(novel.cover ? [novel.cover] : []),
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
    status.textContent = `Загрузка в кэш: ${done} / ${urls.length}`;
  }
  status.textContent = `✓ Сохранено в память (${novel.chapters.length} гл.)`;
}

// ---------- Экран чтения главы (RanobeLib Reader) ----------

async function viewChapter(slug, n) {
  const novel = findNovel(slug);
  if (!novel) { location.hash = '#/'; return; }
  const idx = novel.chapters.findIndex(c => c.n === n);
  if (idx < 0) { location.hash = `#/n/${slug}`; return; }
  const ch = novel.chapters[idx];
  const prev = novel.chapters[idx - 1];
  const next = novel.chapters[idx + 1];
  const vol = ch.volume || 1;

  setBar({
    title: `Том ${vol} Глава ${n}`,
    sub: ch.title,
    backHref: `#/n/${slug}`,
    onCenter: () => openTocSheet(novel, n),
    showToc: true,
    showFs: true,
  });
  $toc.onclick = () => openTocSheet(novel, n);
  if ($fs) $fs.onclick = () => toggleFullscreen();
  requestWakeLock();

  // Нижняя панель RanobeLib
  const bbPrev = document.getElementById('bb-prev');
  const bbNext = document.getElementById('bb-next');
  bbPrev.disabled = !prev;
  bbNext.disabled = !next;
  bbPrev.onclick = () => { if (prev) location.hash = `#/n/${slug}/c/${prev.n}`; };
  bbNext.onclick = () => { if (next) location.hash = `#/n/${slug}/c/${next.n}`; };
  document.getElementById('bb-toc').onclick = () => openTocSheet(novel, n);
  document.getElementById('bb-gl').onclick = () => openGlossarySheet(novel, n);
  document.getElementById('bb-aa').onclick = openSettingsSheet;

  $app.innerHTML = '<div class="page"><div class="empty">Загрузка главы…</div></div>';

  const [text, glossary] = await Promise.all([
    fetch(ch.file, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }),
    loadGlossary(slug),
  ]);
  if (current.view !== 'chapter' || current.n !== n) return;

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
        <div class="chapter-num">Том ${vol} · Глава ${n}</div>
        <h1 class="chapter-title">${esc(meta.title || ch.title)}</h1>
      </header>
      <div class="prose">${html}</div>
      <nav class="chapter-nav">
        ${prev ? `<a class="btn" href="#/n/${slug}/c/${prev.n}">← Глава ${prev.n}</a>` : '<span></span>'}
        <a class="btn" href="#/n/${slug}">К тайтлу</a>
        ${next ? `<a class="btn btn-primary" href="#/n/${slug}/c/${next.n}">Глава ${next.n} →</a>` : '<span class="btn ghost">Последняя</span>'}
      </nav>
    </article>`;

  const s = settings.get();
  glossary.annotate($app, n, s.glossary);
  progress.touch(slug, n);

  // Тап по термину — плавная инлайн-сноска; тап по пустому месту текста — скрыть/показать панели RanobeLib
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
      return;
    }
    // Тап по тексту (если не выделяется текст и не нажата кнопка/ссылка) — переключает панели
    if (e.target.closest('a, button, .gl-inline-wrap')) return;
    if (window.getSelection?.().toString()) return;
    const hide = !$bar.classList.contains('hidden');
    $bar.classList.toggle('hidden', hide);
    $bbar.classList.toggle('hidden', hide);
    if (hide && settings.get().immersive === 'on') {
      toggleFullscreen(true);
    }
  };
  $app.addEventListener('click', onClick);

  // Восстановление скролла
  const saved = progress.get(slug).pos[n];
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - innerHeight;
    window.scrollTo(0, saved && saved < 0.98 ? saved * max : 0);
  });

  // Скролл: прогресс, автоскрытие панелей, автоотметка прочтения
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
      if (dy > 10 && scrollY > 80) {
        $bar.classList.add('hidden');
        $bbar.classList.add('hidden');
      } else if (dy < -12 || scrollY < 40 || ratio > 0.97) {
        $bar.classList.remove('hidden');
        $bbar.classList.remove('hidden');
      }
      lastY = scrollY;
      progress.savePos(slug, n, ratio);
      if (ratio > 0.96) progress.markRead(slug, n);
    });
  };
  addEventListener('scroll', onScroll, { passive: true });

  current.cleanup = () => {
    releaseWakeLock();
    removeEventListener('scroll', onScroll);
    $app.removeEventListener('click', onClick);
  };
}

// ---------- Шторки в главе: Оглавление, Глоссарий, Настройки ----------

function openTocSheet(novel, currentN) {
  const prog = progress.get(novel.slug);
  const rows = novel.chapters.map(c => {
    const isRead = prog.read.includes(c.n);
    const isCur = c.n === currentN;
    return `
      <a class="rl-ch-item ${isRead ? 'read' : ''} ${isCur ? 'current' : ''}" href="#/n/${novel.slug}/c/${c.n}" data-close>
        <div class="rl-ch-link">
          <div class="rl-ch-main">
            <span class="rl-ch-vol">Том ${c.volume || 1} Глава ${c.n}</span>
            <span class="rl-ch-name">— ${esc(c.title)}</span>
          </div>
        </div>
        <span style="color:var(--accent);font-size:13px">${isCur ? '●' : isRead ? '✓' : ''}</span>
      </a>`;
  }).join('');
  openSheet(`
    <div class="sheet-title"><span>Список глав (${novel.chapters.length})</span></div>
    <div class="rl-ch-list">${rows}</div>
  `);
}

async function openGlossarySheet(novel, currentN) {
  const g = await loadGlossary(novel.slug);
  const terms = g.known(currentN);
  const items = terms.map(t => `
    <button class="gl-row" data-term="${esc(t.id)}">
      <span class="gl-row-name">${esc(t.name)}</span>
      <span class="gl-row-orig">${esc(t.category || '')}</span>
    </button>`).join('');
  openSheet(`
    <div class="sheet-title"><span>База знаний (на главу ${currentN})</span></div>
    <div id="sheet-gl-list">${items || '<div class="empty">Нет записей.</div>'}</div>
  `);
  const box = document.getElementById('sheet-gl-list');
  if (!box) return;
  const closeAll = () => {
    box.querySelectorAll('.gl-inline-wrap:not(.closing)').forEach(el => {
      el.classList.add('closing');
      el.classList.remove('open');
      setTimeout(() => el.remove(), 270);
    });
    box.querySelectorAll('.gl-row.active').forEach(el => el.classList.remove('active'));
  };
  box.onclick = e => {
    if (e.target.closest('[data-close-card]')) { closeAll(); return; }
    const b = e.target.closest('.gl-row');
    if (!b) return;
    const wasActive = b.classList.contains('active');
    closeAll();
    if (wasActive) return;
    b.classList.add('active');
    const wrap = document.createElement('div');
    wrap.className = 'gl-inline-wrap';
    wrap.innerHTML = `<div class="gl-inline-inner">${g.cardHtml(b.dataset.term, currentN)}</div>`;
    b.insertAdjacentElement('afterend', wrap);
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  };
}

// ---------- Настройки читалки (RanobeLib Reader Menu) ----------

const THEMES = [
  ['dark',  'Тёмная',  '#141416'],
  ['black', 'OLED',    '#000000'],
  ['dusk',  'Сумерки', '#161922'],
  ['sepia', 'Сепия',   '#f4ecd8'],
  ['light', 'Светлая', '#ffffff'],
];

function settingsControls() {
  const s = settings.get();
  const seg = (key, options) => `
    <div class="seg" data-key="${key}">
      ${options.map(([v, label]) => `<button class="${String(s[key]) === String(v) ? 'on' : ''}" data-v="${v}">${label}</button>`).join('')}
    </div>`;
  const swatches = THEMES.map(([id, label, color]) => `
    <button class="theme-swatch ${s.theme === id ? 'on' : ''}" data-theme-id="${id}">
      <span class="swatch-dot" style="background:${color}"></span>
      <span>${label}</span>
    </button>`).join('');

  return `
    <div class="set-group">
      <div class="set-label">Цветовая схема</div>
      <div class="theme-swatches">${swatches}</div>
    </div>
    <div class="set-group">
      <div class="set-label">Стиль окон системы (Intelligent UI)</div>
      ${seg('ui', [['minimal', 'Сдержанный'], ['game', 'Игровой']])}
    </div>
    <div class="set-group">
      <div class="set-label">Шрифт и выравнивание</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${seg('font', [['sans', 'Без засечек'], ['serif', 'С засечками']])}
        ${seg('align', [['left', 'По левому'], ['justify', 'По ширине']])}
      </div>
    </div>
    <div class="set-group">
      <div class="set-label">Размер шрифта <span class="set-val" id="val-fontSize">${s.fontSize}px</span></div>
      <div class="stepper" data-key="fontSize" data-step="1" data-min="14" data-max="26">
        <button data-d="-1">A−</button><button data-d="1">A+</button>
      </div>
    </div>
    <div class="set-group">
      <div class="set-label">Межстрочный интервал <span class="set-val" id="val-lineHeight">${s.lineHeight}</span></div>
      <div class="stepper" data-key="lineHeight" data-step="0.05" data-min="1.35" data-max="2.1">
        <button data-d="-1">−</button><button data-d="1">+</button>
      </div>
    </div>
    <div class="set-group">
      <div class="set-label">Отступ между абзацами <span class="set-val" id="val-paraGap">${s.paraGap}em</span></div>
      <div class="stepper" data-key="paraGap" data-step="0.1" data-min="0.4" data-max="1.6">
        <button data-d="-1">−</button><button data-d="1">+</button>
      </div>
    </div>
    <div class="set-group">
      <div class="set-label">Подсветка терминов в тексте</div>
      ${seg('glossary', [['first', 'Первое упом.'], ['all', 'Все'], ['off', 'Выкл.']])}
    </div>
    <div class="set-group">
      <div class="set-label">Полноэкранный режим (скрывать шторку и кнопки)</div>
      ${seg('immersive', [['on', 'Вкл.'], ['off', 'Выкл.']])}
    </div>
    <div class="set-group" style="padding-top:8px">
      <button id="btn-force-reload" class="action-btn" style="width:100%;justify-content:center;padding:11px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;color:#ff7675;font-weight:600;font-size:13.5px;cursor:pointer;display:flex;align-items:center;gap:8px">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
        <span>Сбросить кэш и обновить</span>
      </button>
    </div>`;
}

function bindSettings(container, onChange) {
  const btnReset = container.querySelector('#btn-force-reload');
  if (btnReset) {
    btnReset.onclick = async () => {
      btnReset.disabled = true;
      btnReset.textContent = 'Очищаю кэш...';
      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const r of regs) await r.unregister();
        }
      } catch (e) {
        console.warn(e);
      }
      location.reload(true);
    };
  }
  container.querySelectorAll('.theme-swatch').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.themeId;
      settings.set({ theme: id });
      container.querySelectorAll('.theme-swatch').forEach(x => x.classList.toggle('on', x === btn));
      onChange?.('theme');
    };
  });
  container.querySelectorAll('.seg').forEach(seg => {
    seg.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      const key = seg.dataset.key;
      const val = b.dataset.v;
      settings.set({ [key]: val });
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      if (key === 'immersive') {
        if (val === 'off' && isFullscreen()) toggleFullscreen(false);
        else if (val === 'on' && !isFullscreen() && current.view === 'chapter') toggleFullscreen(true);
      }
      onChange?.(key);
    };
  });
  container.querySelectorAll('.stepper').forEach(st => {
    st.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      const key = st.dataset.key;
      const step = Number(st.dataset.step);
      const cur = settings.get()[key];
      const v = Math.round(Math.min(Number(st.dataset.max), Math.max(Number(st.dataset.min), cur + step * Number(b.dataset.d))) * 100) / 100;
      settings.set({ [key]: v });
      const label = container.querySelector('#val-' + key);
      if (label) label.textContent = key === 'fontSize' ? v + 'px' : key === 'paraGap' ? v + 'em' : v;
      onChange?.(key);
    };
  });
}

function openSettingsSheet() {
  openSheet(`
    <div class="sheet-title"><span>Настройки читалки</span></div>
    <div class="sheet-settings">${settingsControls()}</div>
  `);
  bindSettings($sheetBody, key => {
    if (key === 'glossary' && current.view === 'chapter') {
      const y = scrollY;
      viewChapter(current.slug, current.n).then(() => scrollTo(0, y));
    }
  });
}

function viewSettings() {
  setBar({ title: 'Настройки читалки', backHref: '#/' });
  $app.innerHTML = `
    <div class="page">
      ${settingsControls()}
      <div class="preview-box">
        <div class="set-label">Предпросмотр</div>
        <div class="prose">
          <p>Я медленно поднял голову и посмотрел на стоявшую передо мной <span class="gl-term">Кайю Астреан</span>.</p>
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
  el.textContent = `RanobeLib Reader · сборка ${build} · обновлено ${new Date(library.generated).toLocaleString('ru-RU')}`;
}

// ---------- Нижняя шторка ----------

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

$aa.onclick = openSettingsSheet;

// ---------- Service Worker и автообновление ----------

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    if (current.view === 'chapter') {
      showUpdateToast('Доступны обновления сайта / новые главы');
    } else {
      refreshing = true;
      window.location.reload();
    }
  });

  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    // Проверка обновлений при возврате на вкладку или в PWA
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
    // Периодическая проверка раз в 10 минут
    setInterval(() => reg.update().catch(() => {}), 10 * 60 * 1000);
  }).catch(err => console.warn('SW:', err));
}

function showUpdateToast(text = 'Доступно обновление интерфейса') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerHTML = `${esc(text)} <button id="toast-reload">Обновить</button>`;
  t.classList.add('show');
  const btn = document.getElementById('toast-reload');
  if (btn) btn.onclick = () => window.location.reload();
}

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
