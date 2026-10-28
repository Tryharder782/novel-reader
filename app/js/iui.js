// Intelligent UI — рендеры компонентов.
// Каждый компонент выдаёт HTML с классами iui-*. Внешний вид задаётся в css/iui.css
// и переключается атрибутом data-ui="minimal" | "game" на <html>.
import { escapeHtml as esc, parseFields, renderInline, renderMiniMarkdown, matchSpellLine } from './markdown.js';
import { BLOCK_COMPONENTS, LINE_COMPONENTS } from './components-list.js';

// ---------- Справочники ----------

const ELEMENTS = [
  { key: 'ice',       re: /^(лёд|лед|льд|ледян)/i,          label: 'Лёд',      icon: '❄' },
  { key: 'wind',      re: /^(ветер|ветр|воздух)/i,          label: 'Ветер',    icon: '🌀' },
  { key: 'water',     re: /^(вод)/i,                        label: 'Вода',     icon: '💧' },
  { key: 'fire',      re: /^(огон|огн|плам)/i,              label: 'Огонь',    icon: '🔥' },
  { key: 'dark',      re: /^(тьм|тёмн|темн|мрак)/i,         label: 'Тьма',     icon: '🌑' },
  { key: 'light',     re: /^(свет|свя)/i,                   label: 'Свет',     icon: '✦' },
  { key: 'lightning', re: /^(молни|гром|электр)/i,          label: 'Молния',   icon: '⚡' },
  { key: 'earth',     re: /^(земл|камн|камен|скал)/i,       label: 'Земля',    icon: '⛰' },
  { key: 'plant',     re: /^(растен|растит|дерев|природ)/i, label: 'Растения', icon: '🌿' },
];

export function elementOf(name) {
  const n = String(name || '').trim();
  for (const e of ELEMENTS) if (e.re.test(n)) return e;
  return { key: 'neutral', label: n || '—', icon: '◆' };
}

function dangerLevel(v) {
  const s = String(v || '').toLowerCase();
  if (/крайн|смерт|катастроф|экстрем|запредел/.test(s)) return 'extreme';
  if (/высок/.test(s)) return 'high';
  if (/средн|умерен/.test(s)) return 'medium';
  if (/низк|слаб/.test(s)) return 'low';
  return 'none';
}

// Тир: 9 — самый обычный, 1 — самый редкий.
function tierInfo(t) {
  const n = parseInt(String(t).match(/\d+/)?.[0] ?? '', 10);
  if (!n) return null;
  let rarity = 'common';
  if (n <= 1) rarity = 'legendary';
  else if (n <= 3) rarity = 'epic';
  else if (n <= 5) rarity = 'rare';
  else if (n <= 7) rarity = 'uncommon';
  return { n, rarity, filled: Math.max(1, Math.min(9, 10 - n)) };
}

const list = v => (Array.isArray(v) ? v : String(v || '').split(',').map(s => s.trim()).filter(Boolean));
const inline = (s, ctx) => renderInline(s, { inlineSpell: ctx.inlineSpell });
const md = (s, ctx) => renderMiniMarkdown(s, { inlineSpell: ctx.inlineSpell });

function elementChips(v) {
  return list(v).map(x => {
    const e = elementOf(x);
    return `<span class="iui-chip el-${e.key}">${esc(x)}</span>`;
  }).join('');
}

// ---------- Компоненты ----------

const R = {};

R.status = ({ fields: f, body }, ctx) => {
  const danger = f['danger'] ?? f['опасность'];
  const level = parseInt(f.level ?? f['уровень'], 10);
  const name = f.name ?? f['имя'] ?? '???';
  const rows = [];
  const add = (label, html) => html && rows.push(`<div class="iui-cell"><div class="iui-k">${label}</div><div class="iui-v">${html}</div></div>`);
  add('Уровень', isNaN(level) ? esc(f.level ?? '') : String(level));
  add('Раса', esc(f.race ?? f['раса'] ?? ''));
  const els = f.elements ?? f['стихии'];
  if (els && list(els).length) add(list(els).length > 1 ? 'Стихии' : 'Стихия', `<div class="iui-chips">${elementChips(els)}</div>`);

  let compare = '';
  const hero = ctx.hero;
  if (hero && hero.level && !isNaN(level) && hero.name && !name.startsWith(hero.name) && f.compare !== 'нет' && f.compare !== 'no') {
    const diff = level - hero.level;
    const ratio = Math.max(4, Math.min(100, (hero.level / Math.max(level, 1)) * 100));
    const label = diff > 0 ? `разрыв: ${diff} ур.` : diff < 0 ? `${hero.name} сильнее на ${-diff} ур.` : 'равные уровни';
    compare = `
      <div class="iui-compare">
        <div class="iui-compare-head"><span>${esc(hero.name)} — ур. ${hero.level}</span><span>${label}</span></div>
        <div class="iui-bar"><div class="iui-bar-fill ${diff > 0 ? '' : 'ok'}" style="width:${diff > 0 ? ratio : 100}%"></div></div>
      </div>`;
  }

  const dl = dangerLevel(danger);
  return `
    <section class="iui iui-status">
      <header class="iui-head">
        <div>
          <div class="iui-label">${esc(f.label ?? 'Статус')}</div>
          <div class="iui-title">${esc(name)}</div>
          ${f.title ? `<div class="iui-subtitle">${esc(f.title)}</div>` : ''}
        </div>
        ${danger !== undefined && danger !== '' ? `<span class="iui-danger d-${dl}">${dl === 'none' && /^[✕x×-]$/i.test(String(danger).trim()) ? 'Угрозы нет' : 'Опасность: ' + esc(danger)}</span>` : ''}
      </header>
      <div class="iui-grid">${rows.join('')}</div>
      ${body ? `<div class="iui-body">${md(body, ctx)}</div>` : ''}
      ${compare}
    </section>`;
};

R.item = ({ fields: f, body }, ctx) => {
  const t = tierInfo(f.tier ?? f['тир'] ?? f['ранг']);
  const segs = t ? Array.from({ length: 9 }, (_, i) => `<i class="${i < t.filled ? 'on' : ''}"></i>`).join('') : '';
  return `
    <section class="iui iui-item ${t ? 'r-' + t.rarity : ''}">
      <header class="iui-head">
        <div>
          <div class="iui-label">${esc(f.label ?? 'Предмет')}</div>
          <div class="iui-title">${esc(f.name ?? f['название'] ?? '???')}</div>
        </div>
        ${t ? `<span class="iui-tier">${t.n}-й тир</span>` : ''}
      </header>
      ${body ? `<div class="iui-body">${md(body, ctx)}</div>` : ''}
      ${t ? `<div class="iui-rarity"><span>Редкость</span><div class="iui-segs">${segs}</div></div>` : ''}
    </section>`;
};

R.skill = ({ fields: f, body }, ctx) => `
  <section class="iui iui-skill">
    <header class="iui-head">
      <div>
        <div class="iui-label">${esc(f.label ?? (f.type ? 'Навык · ' + f.type : 'Навык'))}</div>
        <div class="iui-title">${esc(f.name ?? '???')}</div>
      </div>
      ${f.level ? `<span class="iui-tier">${esc(f.level)}</span>` : ''}
    </header>
    ${body ? `<div class="iui-body">${md(body, ctx)}</div>` : ''}
  </section>`;

R.stats = ({ fields: f, body }, ctx) => {
  const rows = list(f.rows ?? f['строки']).map(r => {
    const m = r.match(/^(.+?)\s*:\s*(.+)$/);
    if (!m) return `<div class="iui-row"><span class="iui-k">${inline(r, ctx)}</span></div>`;
    let val = m[2];
    let badge = '';
    const b = val.match(/\s*\((UP|MAX|↑|NEW|НОВОЕ)\)\s*$/i) || val.match(/\s+(UP|MAX|↑)\s*$/);
    if (b) {
      val = val.slice(0, b.index);
      const kind = /max/i.test(b[1]) ? 'max' : /new|нов/i.test(b[1]) ? 'new' : 'up';
      badge = `<span class="iui-badge b-${kind}">${esc(b[1].toUpperCase())}</span>`;
    }
    const v = esc(val).replace(/\s*(→|->)\s*/g, ' <span class="iui-arrow">→</span> ');
    return `<div class="iui-row"><span class="iui-k">${inline(m[1], ctx)}</span><span class="iui-v">${v}${badge}</span></div>`;
  }).join('');
  return `
    <section class="iui iui-stats">
      <header class="iui-head"><div>
        <div class="iui-label">${esc(f.label ?? 'Характеристики')}</div>
        ${f.title ? `<div class="iui-title">${esc(f.title)}</div>` : ''}
      </div></header>
      <div class="iui-rows">${rows}</div>
      ${body ? `<div class="iui-body">${md(body, ctx)}</div>` : ''}
    </section>`;
};

const SYSTEM_KINDS = {
  info:    { label: 'Система',     icon: 'ⓘ' },
  warning: { label: 'Внимание',    icon: '⚠' },
  danger:  { label: 'Опасность',   icon: '⛔' },
  success: { label: 'Успех',       icon: '✓' },
  quest:   { label: 'Задание',     icon: '◈' },
  levelup: { label: 'Повышение',   icon: '▲' },
};

R.system = ({ fields: f, body }, ctx) => {
  const kind = SYSTEM_KINDS[f.kind] ? f.kind : 'info';
  const k = SYSTEM_KINDS[kind];
  return `
    <section class="iui iui-system k-${kind}">
      <div class="iui-label"><span class="iui-icon">${k.icon}</span>${esc(f.label ?? k.label)}</div>
      ${f.title ? `<div class="iui-title">${inline(f.title, ctx)}</div>` : ''}
      ${body ? `<div class="iui-body">${md(body, ctx)}</div>` : ''}
    </section>`;
};

R.quest = ({ fields: f, body }, ctx) => {
  const sect = (title, items, cls) => {
    const arr = list(items);
    if (!arr.length) return '';
    return `<div class="iui-qsect ${cls}"><div class="iui-k">${title}</div><ul>${arr.map(x => `<li>${inline(x, ctx)}</li>`).join('')}</ul></div>`;
  };
  return `
    <section class="iui iui-quest">
      <div class="iui-label"><span class="iui-icon">◈</span>${esc(f.label ?? 'Задание')}</div>
      ${f.title ? `<div class="iui-title">${inline(f.title, ctx)}</div>` : ''}
      ${body ? `<div class="iui-body">${md(body, ctx)}</div>` : ''}
      ${sect('Условия', f.conditions ?? f['условия'], 'q-cond')}
      ${sect('Награда', f.rewards ?? f['награда'], 'q-reward')}
      ${sect('Провал', f.fail ?? f['провал'], 'q-fail')}
    </section>`;
};

R.timer = ({ fields: f, body }, ctx) => `
  <section class="iui iui-timer">
    ${f.title ? `<div class="iui-label">${esc(f.title)}</div>` : ''}
    <div class="iui-time">${esc(f.value ?? f.time ?? '00:00')}</div>
    ${f.caption || body ? `<div class="iui-caption">${inline(f.caption ?? body, ctx)}</div>` : ''}
  </section>`;

R.note = ({ fields: f, body }, ctx) => `
  <aside class="iui-note">
    <div class="iui-note-label">${esc(f.label ?? 'Примечание')}</div>
    ${md(body, ctx)}
  </aside>`;

// --- однострочные ---

R.break = () => `<div class="iui-break" role="separator"><span></span></div>`;

R.pov = ({ raw }) => `
  <div class="iui-pov" role="separator"><span class="iui-pov-line"></span><span class="iui-pov-name">${esc(raw || '…')}</span><span class="iui-pov-line"></span></div>`;

R.sfx = ({ raw }) => `<p class="iui-sfx">${esc(raw)}</p>`;

R.spell = ({ data, raw }) => {
  let s = data;
  if (!s && raw) {
    const parts = raw.split('|').map(x => x.trim());
    s = matchSpellLine(raw) || { name: parts[0], element: parts[1] || '', stars: Number(parts[2]) || 0 };
  }
  const e = elementOf(s.element);
  return `
    <div class="iui-spell-line">
      <span class="iui-spell el-${e.key}">
        <span class="iui-spell-icon">${e.icon}</span>
        <span class="iui-spell-name">${esc(s.name)}</span>
        <span class="iui-spell-meta">${esc(e.key === 'neutral' ? s.element : e.label)}${s.stars ? ` · ★${s.stars}` : ''}</span>
      </span>
    </div>`;
};

// Инлайн-заклинание внутри абзаца
export function inlineSpell(inner) {
  const s = matchSpellLine(`「${inner}」`);
  if (!s) return null;
  const e = elementOf(s.element);
  return `<span class="iui-spell inline el-${e.key}"><span class="iui-spell-icon">${e.icon}</span>${esc(s.name)}<span class="iui-spell-meta">★${s.stars}</span></span>`;
}

// ---------- Точка входа ----------

export function renderComponent(block, ctx) {
  const fn = R[block.name];
  const known = BLOCK_COMPONENTS.includes(block.name) || LINE_COMPONENTS.includes(block.name);
  if (!fn || !known) {
    // Неизвестный компонент — показываем как цитату, чтобы текст не терялся.
    const text = block.raw ?? '';
    return `<blockquote class="iui-fallback">${renderMiniMarkdown(text, { inlineSpell: ctx.inlineSpell })}</blockquote>`;
  }
  try {
    if (block.kind === 'block') {
      const parsed = parseFields(block.raw || '');
      return fn({ ...parsed, raw: block.raw }, ctx);
    }
    return fn({ raw: block.raw, data: block.data, fields: {} }, ctx);
  } catch (err) {
    console.error('IUI render error', block, err);
    return `<blockquote class="iui-fallback">${esc(block.raw || '')}</blockquote>`;
  }
}
