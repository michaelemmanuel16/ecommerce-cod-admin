import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// M3-T33 and M3-T38: the Mobile View switch, MOBILE_OPT_IN, the rep tour, the rep Help menu and the hard-coded RoleGuard are gone.
const SRC = path.resolve(__dirname, '..', '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '__tests__') sourceFiles(p, out);
    } else if (/\.(tsx?|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

const REMOVED = [
  'MOBILE_OPT_IN', 'DESKTOP_FLAG', 'mobile_opt_in', 'prefer-desktop', 'Switch to Desktop', 'Mobile View',
  'MobileRedirect', 'CustomerRepOnboarding', 'OnboardingWelcomeModal', 'OnboardingProvider', 'useOnboarding',
  'customerRepTourSteps', 'Take Tour Again', 'RoleGuard', 'allowedRoles',
  // M3-T38 (F-115, F-327): unrouted files and the Kanban toggle
  'ordersDefaultView', 'components/kanban', 'KanbanBoard', 'OrdersKanban', 'OrdersList', 'CallsDashboard',
  'WorkflowEditor', 'MobilePlaceholder', 'MobileNav', 'AgentCreateModal', 'components/workflow/',
];

describe('removed symbols', () => {
  const files = sourceFiles(SRC);
  it.each(REMOVED)('%s appears nowhere in src', (symbol) => {
    const hits = files.filter((f) => fs.readFileSync(f, 'utf8').includes(symbol)).map((f) => path.relative(SRC, f));
    expect(hits).toEqual([]);
  });
});
