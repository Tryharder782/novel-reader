// Разбор текста главы: Markdown-подмножество + компоненты Intelligent UI.
// Без зависимостей. Работает и в браузере, и в Node (для тестов).

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function parseFrontmatter(text) {
  const m = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
    meta[kv[1]] = v;
  }
  return { meta, body: text.slice(m[0].length) };
}

// Мини-YAML для тела компонента:
//   ключ: значение
//   ключ: [a, b, c]
//   ключ:
//     - элемент
//     - элемент
//   (пустая строка)
//   Всё после первой пустой строки — свободный текст (body), Markdown.
export function parseFields(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const fields = {};
  let i = 0;
  let lastKey = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { i++; break; }
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && lastKey) {
      if (!Array.isArray(fields[lastKey])) fields[lastKey] = [];
      fields[lastKey].push(item[1].trim());
      continue;
    }
    const kv = line.match(/^([\p{L}\w\s—-]+?)\s*:\s*(.*)$/u);
    if (kv) {
      lastKey = kv[1].trim().toLowerCase();
      let v = kv[2].trim();
      const isListKey = /^(elements|стихии|tags|теги|conditions|условия|rewards|награды)$/i.test(lastKey);
      if (isListKey && /^\[.*\]$/.test(v)) {
        v = v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
      } else if (/^".*"$/.test(v) || /^'.*'$/.test(v)) {
        v = v.slice(1, -1);
      }
      fields[lastKey] = v === '' ? [] : v;
      continue;
    }
    // Строка без "ключ:" в начале — значит полей нет, всё это body.
    return { fields: {}, body: lines.join('\n').trim() };
  }
  return { fields, body: lines.slice(i).join('\n').trim() };
}

// Инлайн-разметка: **жирный**, *курсив*, ~~зачёркнутый~~, 「заклинание」
export function renderInline(text, opts = {}) {
  let s = escapeHtml(text);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\p{L}])\*(?!\s)(.+?)(?<!\s)\*(?![*\p{L}])/gu, '$1<em>$2</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  if (opts.inlineSpell) {
    s = s.replace(/「([^「」]+?)」/g, (m, inner) => opts.inlineSpell(inner) ?? m);
  }
  return s;
}

// Строка вида 「Создание льда (Стихия Льда, ★1)」
const SPELL_RE = /^「\s*(.+?)\s*\(\s*(?:Стихия\s+)?([^,()]+?)\s*,\s*★\s*(\d+)\s*\)\s*」$/u;
export function matchSpellLine(line) {
  const m = line.trim().match(SPELL_RE);
  if (!m) return null;
  return { name: m[1], element: m[2], stars: Number(m[3]) };
}

// Разбор тела главы в список блоков.
// Типы: p, h, quote, component(block|line), break
export function parseBlocks(body) {
  const lines = body.replace(/\r/g, '').split('\n');
  const blocks = [];
  let para = [];

  const flush = () => {
    if (!para.length) return;
    const single = para.length === 1;
    const text = para.join('\n');
    para = [];
    const spell = single && matchSpellLine(text);
    if (spell) {
      blocks.push({ type: 'component', name: 'spell', data: spell });
    } else {
      blocks.push({ type: 'p', text });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = line.match(/^```\s*([\w-]*)\s*$/);
    if (fence) {
      flush();
      const name = fence[1] || 'code';
      const buf = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) buf.push(lines[i]);
      blocks.push({ type: 'component', kind: 'block', name, raw: buf.join('\n') });
      continue;
    }

    const dir = line.match(/^::([\w-]+)\s*(.*)$/);
    if (dir) {
      flush();
      blocks.push({ type: 'component', kind: 'line', name: dir[1], raw: dir[2].trim() });
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      flush();
      blocks.push({ type: 'h', level: h[1].length, text: h[2].trim() });
      continue;
    }

    if (/^\s*<(div|section|aside|table|details)\b/i.test(line)) {
      flush();
      const tagMatch = line.match(/^\s*<([a-zA-Z0-9]+)/);
      const tag = tagMatch ? tagMatch[1].toLowerCase() : 'div';
      const buf = [line];
      const closeRe = new RegExp(`</${tag}>`, 'i');
      if (!closeRe.test(line)) {
        for (i++; i < lines.length; i++) {
          buf.push(lines[i]);
          if (closeRe.test(lines[i])) break;
        }
      }
      blocks.push({ type: 'html', html: buf.join('\n') });
      continue;
    }

    if (/^\s*(\*\s*\*\s*\*|-{3,}|_{3,})\s*$/.test(line)) {
      flush();
      blocks.push({ type: 'component', kind: 'line', name: 'break', raw: '' });
      continue;
    }

    if (/^>\s?/.test(line)) {
      flush();
      const buf = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) buf.push(lines[i].replace(/^>\s?/, ''));
      i--;
      blocks.push({ type: 'quote', text: buf.join('\n') });
      continue;
    }

    if (!line.trim()) { flush(); continue; }
    para.push(line.replace(/\s+$/, ''));
  }
  flush();
  return blocks;
}

// Абзацы внутри компонентов (body): простые параграфы + инлайн.
export function renderMiniMarkdown(text, opts) {
  if (!text) return '';
  return text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      const lines = p.split('\n');
      if (lines.every(l => /^\s*[-•]\s+/.test(l))) {
        return '<ul>' + lines.map(l => `<li>${renderInline(l.replace(/^\s*[-•]\s+/, ''), opts)}</li>`).join('') + '</ul>';
      }
      return `<p>${lines.map(l => renderInline(l, opts)).join('<br>')}</p>`;
    })
    .join('');
}
