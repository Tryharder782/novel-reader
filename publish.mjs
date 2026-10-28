// Быстрая проверка и публикация новых глав в облако:
//   node publish.mjs "Глава 9"
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const msg = process.argv.slice(2).join(' ').trim() || `Обновление глав (${new Date().toISOString().slice(0, 10)})`;

const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });

run(process.execPath, ['build.mjs', '--check']);
run('git', ['add', '-A']);
try {
  run('git', ['commit', '-m', msg]);
} catch {
  console.log('Нет новых изменений для коммита.');
}
run('git', ['push', '-u', 'origin', 'main']);
console.log('✓ Опубликовано! Через ~20–30 сек новые главы появятся в приложении.');
