/**
 * M2-T04: the tool registry rules that code checks, not runtime.
 * 1. ESLint fails a planted `import prisma` in a tool file and passes after removal.
 * 2. Only files in src/tools/ register tools.
 */
import { describe, it, expect } from '@jest/globals';
import { ESLint } from 'eslint';
import fs from 'fs';
import path from 'path';

const backendRoot = path.join(__dirname, '../../..');
const srcRoot = path.join(backendRoot, 'src');

async function lint(code: string, file = 'src/tools/fixtureTool.ts') {
  const eslint = new ESLint({ cwd: backendRoot });
  const [result] = await eslint.lintText(code, { filePath: path.join(backendRoot, file) });
  return result.messages.filter((m) => m.ruleId === '@typescript-eslint/no-restricted-imports');
}

describe('lint rule: no Prisma in src/tools', () => {
  it('fails on a planted `import prisma` and passes once it is removed', async () => {
    const planted = "import prisma from '../utils/prisma';\nexport const x = prisma;\n";
    expect(await lint(planted)).toHaveLength(1);
    expect(await lint("export const x = 1;\n")).toHaveLength(0);
  });

  it('also fails on @prisma/client and on a deep relative path', async () => {
    expect(await lint("import { PrismaClient } from '@prisma/client';\nexport const x = PrismaClient;\n")).toHaveLength(1);
    expect(await lint("import { prismaBase } from '../../utils/prisma';\nexport const x = prismaBase;\n", 'src/tools/sub/deep.ts')).toHaveLength(1);
  });

  it('allows a type-only import from @prisma/client', async () => {
    expect(await lint("import type { UserKind } from '@prisma/client';\nexport type K = UserKind;\n")).toHaveLength(0);
  });

  it('does not touch files outside src/tools', async () => {
    expect(await lint("import prisma from '../utils/prisma';\nexport const x = prisma;\n", 'src/services/someService.ts')).toHaveLength(0);
  });
});

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(full);
    return e.name.endsWith('.ts') ? [full] : [];
  });
}

describe('registry-only', () => {
  it('no file outside src/tools calls registerToolDef', () => {
    const toolsDir = path.join(srcRoot, 'tools') + path.sep;
    const self = __filename;
    const offenders = sourceFiles(srcRoot)
      .filter((f) => !f.startsWith(toolsDir) && f !== self)
      .filter((f) => /\bregisterToolDef\s*\(/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(srcRoot, f));
    expect(offenders).toEqual([]);
  });

  it('the scan sees the registry itself (guards against a broken scan)', () => {
    const registry = fs.readFileSync(path.join(srcRoot, 'tools/registry.ts'), 'utf8');
    expect(/\bregisterToolDef\s*\(/.test(registry)).toBe(true);
  });
});
