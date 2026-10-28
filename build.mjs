// Сборка сайта: app/ + content/ -> dist/
//   node build.mjs          — собрать dist/
//   node build.mjs --check  — только проверить главы и глоссарии (ничего не пишет)
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BLOCK_COMPONENTS, LINE_COMPONENTS } from './app/js/components-list.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(ROOT, 'app');
const CONTENT = path.join(ROOT, 'content');
const DIST = path.join(ROOT, 'dist');
const CHECK_ONLY = process.argv.includes('--check');

const warnings = [];
const errors = [];
const warn = (file, msg) => warnings.push(`${path.relative(ROOT, file)}: ${msg}`);
const fail = (file, msg) => errors.push(`${path.relative(ROOT, file)}: ${msg}`);

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

function parseFrontmatter(text) {
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

function checkChapterBody(file, body) {
  const lines = body.split(/\r?\n/);
  let inBlock = null;
  lines.forEach((line, i) => {
    const fence = line.match(/^```\s*([\w-]*)\s*$/);
    if (fence) {
      if (inBlock === null) {
        inBlock = fence[1] || '';
        if (inBlock && !BLOCK_COMPONENTS.includes(inBlock)) {
          warn(file, `строка ${i + 1}: неизвестный блок \`\`\`${inBlock} (будет показан как цитата)`);
        }
      } else {
        inBlock = null;
      }
      return;
    }
    if (inBlock !== null) return;
    const dir = line.match(/^::([\w-]+)/);
    if (dir && !LINE_COMPONENTS.includes(dir[1])) {
      warn(file, `строка ${i + 1}: неизвестная директива ::${dir[1]}`);
    }
  });
  if (inBlock !== null) fail(file, `незакрытый блок \`\`\`${inBlock}`);
}

function countWords(body) {
  return (body.replace(/```[\s\S]*?```/g, ' ').match(/[\p{L}\p{N}]+/gu) || []).length;
}

async function buildLibrary() {
  const novels = [];
  if (!(await exists(CONTENT))) return novels;

  for (const e of await fs.readdir(CONTENT, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const slug = e.name;
    const dir = path.join(CONTENT, slug);
    const novelFile = path.join(dir, 'novel.json');
    if (!(await exists(novelFile))) continue;

    let novel;
    try {
      novel = JSON.parse(await fs.readFile(novelFile, 'utf8'));
    } catch (err) {
      fail(novelFile, `некорректный JSON: ${err.message}`);
      continue;
    }

    const glossaryFile = path.join(dir, 'glossary.json');
    if (await exists(glossaryFile)) {
      try {
        const g = JSON.parse(await fs.readFile(glossaryFile, 'utf8'));
        const ids = new Set();
        for (const t of g.terms || []) {
          if (!t.id || !t.name) fail(glossaryFile, `термин без id/name: ${JSON.stringify(t).slice(0, 80)}`);
          if (ids.has(t.id)) fail(glossaryFile, `повтор id "${t.id}"`);
          ids.add(t.id);
          if (!Array.isArray(t.entries) || !t.entries.length) warn(glossaryFile, `у "${t.id}" нет entries`);
          for (const en of t.entries || []) {
            if (typeof en.from !== 'number') fail(glossaryFile, `у "${t.id}" entry без числового from`);
          }
        }
      } catch (err) {
        fail(glossaryFile, `некорректный JSON: ${err.message}`);
      }
    }

    const chapters = [];
    const chDir = path.join(dir, 'chapters');
    if (await exists(chDir)) {
      for (const f of (await fs.readdir(chDir)).filter(f => f.endsWith('.md'))) {
        const file = path.join(chDir, f);
        const { meta, body } = parseFrontmatter(await fs.readFile(file, 'utf8'));
        if (typeof meta.number !== 'number') {
          fail(file, 'во frontmatter нет числового поля number');
          continue;
        }
        if (!meta.title) warn(file, 'во frontmatter нет title');
        checkChapterBody(file, body);
        chapters.push({
          n: meta.number,
          volume: meta.volume || novel.volume || 1,
          title: meta.title || `Глава ${meta.number}`,
          date: meta.date || '',
          file: `content/${slug}/chapters/${f}`,
          words: countWords(body),
        });
      }
    }
    chapters.sort((a, b) => a.n - b.n);
    for (let i = 1; i < chapters.length; i++) {
      if (chapters[i].n === chapters[i - 1].n) fail(chDir, `две главы с номером ${chapters[i].n}`);
    }

    novels.push({
      slug,
      title: novel.title,
      original: novel.original || '',
      type: novel.type || 'Ранобэ',
      status: novel.status || 'Онгоинг',
      translation: novel.translation || 'Переводится',
      year: novel.year || '',
      rating: novel.rating || '',
      cover: novel.cover || '',
      tags: novel.tags || [],
      description: novel.description || '',
      hero: novel.hero || null,
      hasGlossary: await exists(glossaryFile),
      chapters,
    });
  }
  novels.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  return novels;
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

async function main() {
  const novels = await buildLibrary();

  if (warnings.length) console.log('Предупреждения:\n  ' + warnings.join('\n  '));
  if (errors.length) {
    console.error('Ошибки:\n  ' + errors.join('\n  '));
    process.exit(1);
  }
  const total = novels.reduce((s, n) => s + n.chapters.length, 0);
  console.log(`Проверено: ${novels.length} тайтл(ов), ${total} глав.`);
  if (CHECK_ONLY) return;

  await fs.rm(DIST, { recursive: true, force: true });
  await copyDir(APP, DIST);
  if (await exists(CONTENT)) await copyDir(CONTENT, path.join(DIST, 'content'));

  const library = { generated: new Date().toISOString(), novels };
  await fs.writeFile(path.join(DIST, 'content', 'library.json'), JSON.stringify(library, null, 1));

  // Список файлов оболочки (всё, кроме контента) — для офлайн-кэша Service Worker.
  // Относительные пути (./...), чтобы одинаково работало и на корневом домене, и на GitHub Pages (/repo/).
  const all = await walk(DIST);
  const rel = p => './' + path.relative(DIST, p).split(path.sep).join('/');
  const shell = all
    .map(rel)
    .filter(p => !p.startsWith('./content/') && p !== './sw.js' && p !== './_headers' && p !== './.nojekyll');
  shell.unshift('./');

  // ID сборки = хэш всех файлов контента и оболочки.
  // Любое изменение (новая глава, обновление обложки или правка UI) генерирует новый хэш.
  const hash = crypto.createHash('sha1');
  for (const p of all.filter(p => !rel(p).endsWith('sw.js') && !rel(p).endsWith('_headers') && !rel(p).endsWith('.nojekyll')).sort()) {
    hash.update(rel(p));
    hash.update(await fs.readFile(p));
  }
  const buildId = hash.digest('hex').slice(0, 10);

  // Добавляем версию к обложкам в library.json для мгновенного сброса кэша изображений
  for (const n of novels) {
    if (n.cover && !n.cover.includes('?v=')) {
      n.cover = `${n.cover}?v=${buildId}`;
    }
  }
  await fs.writeFile(path.join(DIST, 'content', 'library.json'), JSON.stringify(library, null, 1));

  // Подставляем ID сборки в sw.js
  const swPath = path.join(DIST, 'sw.js');
  let sw = await fs.readFile(swPath, 'utf8');
  sw = sw.replaceAll('__BUILD_ID__', buildId).replaceAll('__SHELL_FILES__', JSON.stringify(shell));
  await fs.writeFile(swPath, sw);

  // Подставляем ID сборки в index.html (для css/base.css?v=..., js/app.js?v=...)
  const htmlPath = path.join(DIST, 'index.html');
  let html = await fs.readFile(htmlPath, 'utf8');
  html = html.replaceAll('__BUILD_ID__', buildId);
  await fs.writeFile(htmlPath, html);

  // Cloudflare Pages: не кэшировать агрессивно sw.js и library.json
  await fs.writeFile(path.join(DIST, '_headers'), [
    '/sw.js',
    '  Cache-Control: no-cache',
    '/content/*',
    '  Cache-Control: no-cache',
    '',
  ].join('\n'));

  // GitHub Pages: отключить Jekyll
  await fs.writeFile(path.join(DIST, '.nojekyll'), '');

  console.log(`Собрано в dist/ (build ${buildId}).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
