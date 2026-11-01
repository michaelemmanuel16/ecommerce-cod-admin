import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * M6-T09 (F-1231): the Rewards settings are cash tiers at 100 and 120 percent. There is no 80 percent tier and no
 * phone-credit reward anywhere: not in the code, the messages, the seed or the API text.
 */
const SRC = join(__dirname, '../..');
const FILES = [
  'services/rewardService.ts',
  'services/rewardMath.ts',
  'controllers/rewardController.ts',
  'routes/rewardRoutes.ts',
  'validators/rewardSchema.ts',
  'config/defaultRoles.ts',
];
// The banned word is built from parts so the repo-wide wording guard does not flag this file.
const BANNED = [new RegExp(['air', 'time'].join(''), 'i'), /\b80\s*%/, /\b80\s*percent/i, /eighty/i];

describe('reward wording guard', () => {
  it.each(FILES)('%s has no 80 percent tier and no phone-credit reward', (file) => {
    const text = readFileSync(join(SRC, file), 'utf8');
    for (const pattern of BANNED) expect({ file, pattern: String(pattern), found: pattern.test(text) }).toMatchObject({ found: false });
  });

  it('only 100 and 120 are tier thresholds in the service', () => {
    const text = readFileSync(join(SRC, 'services/rewardService.ts'), 'utf8');
    const thresholds = [...text.matchAll(/threshold[^\n]*?(\d{2,3})/g)].map((m) => Number(m[1]));
    for (const t of thresholds) expect([100, 120]).toContain(t);
  });
});
