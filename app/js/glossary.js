// Глоссарий: подсветка терминов в тексте и карточки без спойлеров.
import { escapeHtml as esc, renderInline } from './markdown.js';

// Паттерн термина -> регулярное выражение.
//   "Кайя"      — точное слово
//   "Тристан*"  — слово + любое окончание (Тристана, Тристаном…)
//   "Громов* птиц* Гали*" — словосочетание с изменяемыми окончаниями
// Если паттерн начинается со строчной буквы, он также ловит заглавную (начало предложения).
function patternToRegex(p) {
  const words = p.trim().split(/\s+/).map(w => {
    let src = w.replace(/[.*+?^${}()|[\]\\]/g, ch => (ch === '*' ? '*' : '\\' + ch));
    src = src.replace(/\*/g, '[\\p{L}]*');
    return src;
  });
  let src = words.join('\\s+');
  const first = p.trim()[0];
  if (first && first !== first.toUpperCase()) {
    src = `[${first}${first.toUpperCase()}]` + src.slice(1);
  }
  return src;
}

export function termFirstChapter(t) {
  return Math.min(...(t.entries || []).map(e => e.from ?? Infinity));
}

export function entriesUpTo(t, chapter) {
  return (t.entries || []).filter(e => (e.from ?? Infinity) <= chapter);
}

export class Glossary {
  constructor(data) {
    this.terms = (data?.terms || []).map(t => ({ ...t, first: termFirstChapter(t) }));
    this.byId = new Map(this.terms.map(t => [t.id, t]));
  }

  // Термины, известные к главе chapter.
  known(chapter) {
    return this.terms.filter(t => t.first <= chapter);
  }

  buildMatcher(chapter) {
    const pats = [];
    for (const t of this.known(chapter)) {
      if (t.highlight === false) continue;
      const forms = [t.name, ...(t.match || [])];
      for (const f of forms) pats.push({ id: t.id, f, src: patternToRegex(f) });
    }
    if (!pats.length) return null;
    // Длинные варианты первыми, чтобы «Громовая птица Галия» победила «Галия».
    pats.sort((a, b) => b.f.length - a.f.length);
    const src = pats.map(p => `(${p.src})`).join('|');
    return {
      re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`, 'gu'),
      ids: pats.map(p => p.id),
    };
  }

  // Оборачивает упоминания терминов в <span class="gl-term">.
  // mode: 'first' — только первое упоминание в главе, 'all' — все, 'off' — нет.
  annotate(root, chapter, mode = 'first') {
    if (mode === 'off') return;
    const matcher = this.buildMatcher(chapter);
    if (!matcher) return;
    const seen = new Set();
    const targets = root.querySelectorAll('.prose > p:not(.iui-sfx), .prose > blockquote p');

    for (const el of targets) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);

      for (const node of nodes) {
        if (node.parentElement.closest('.gl-term, .iui-spell')) continue;
        const text = node.nodeValue;
        matcher.re.lastIndex = 0;
        let m;
        let last = 0;
        const frag = document.createDocumentFragment();
        let changed = false;
        while ((m = matcher.re.exec(text))) {
          const gi = m.slice(1).findIndex(x => x !== undefined);
          const id = matcher.ids[gi];
          if (mode === 'first' && seen.has(id)) continue;
          seen.add(id);
          if (m.index > last) frag.append(text.slice(last, m.index));
          const span = document.createElement('span');
          span.className = 'gl-term';
          span.dataset.term = id;
          span.textContent = m[0];
          frag.append(span);
          last = m.index + m[0].length;
          changed = true;
        }
        if (!changed) continue;
        if (last < text.length) frag.append(text.slice(last));
        node.replaceWith(frag);
      }
    }
  }

  cardHtml(id, chapter) {
    const t = this.byId.get(id);
    if (!t) return '';
    const entries = entriesUpTo(t, chapter);
    return `
      <div class="gl-card" data-term-id="${esc(id)}">
        <div class="gl-card-head">
          <div>
            <div class="gl-card-name">${esc(t.name)}</div>
            ${t.original ? `<div class="gl-card-orig">${esc(t.original)}</div>` : ''}
          </div>
          <div class="gl-card-actions">
            ${t.category ? `<span class="gl-card-cat">${esc(t.category)}</span>` : ''}
            <button type="button" class="gl-card-close" data-close-card aria-label="Скрыть" title="Скрыть">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
            </button>
          </div>
        </div>
        <div class="gl-card-body">
          ${entries.map(e => `<p>${renderInline(e.text)}</p>`).join('') || '<p class="muted">Пока ничего не известно.</p>'}
        </div>
        <div class="gl-card-foot">Известно на главу ${chapter}</div>
      </div>`;
  }
}

// Категории в фиксированном порядке для страницы глоссария
export const CATEGORY_ORDER = ['Персонажи', 'Существа', 'Места', 'Организации', 'Предметы', 'Магия', 'Термины'];
