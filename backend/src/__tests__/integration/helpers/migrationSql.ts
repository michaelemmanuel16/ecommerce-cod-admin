import fs from 'fs';
import path from 'path';

/** Statements of one migration file, in order. Comment lines are dropped and a `$$ ... $$` block stays whole. */
export function migrationStatements(migrationName: string): string[] {
  const file = path.join(__dirname, '../../../../prisma/migrations', migrationName, 'migration.sql');
  const sql = fs.readFileSync(file, 'utf8').split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  const statements: string[] = [];
  let current = '';
  let inDollar = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql.startsWith('$$', i)) {
      inDollar = !inDollar;
      current += '$$';
      i++;
      continue;
    }
    if (sql[i] === ';' && !inDollar) {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += sql[i];
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}
