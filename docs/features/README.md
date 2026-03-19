# Feature Documentation

Each file documents one feature area. Related Linear issues are appended as work progresses.

| Feature | File | Status |
|---------|------|--------|
| Agent Inventory Tracking | [agent-inventory-tracking.md](agent-inventory-tracking.md) | Complete |
| Agent Blocking | [agent-blocking.md](agent-blocking.md) | Complete |
| Agent Deposit Reconciliation | [agent-deposit-reconciliation.md](agent-deposit-reconciliation.md) | Complete |
| Net Collection Accountability | [net-collection-accountability.md](net-collection-accountability.md) | Complete |
| Cash Flow Report | [cash-flow-report.md](cash-flow-report.md) | Complete |
| Bulk Orders | [bulk-orders.md](bulk-orders.md) | Planning |
| Financial Module | [financial-module-prd.md](financial-module-prd.md) | PRD |

## Adding a new feature doc

When starting work on a new feature area, create a file named `{feature-slug}.md` with this structure:

```markdown
# Feature Name

Brief description of what this feature does and why it exists.

---

## MAN-## — Issue Title
**Date:** YYYY-MM-DD | **Type:** feat/fix | **Branch:** feature/man-##-name | **Commit:** abc1234

### Summary
1-3 sentences describing what was implemented and why.

### Changes
- **Backend:** [key changes]
- **Frontend:** [key changes]
- **Database:** [schema changes if any]

### Key Files
- `path/to/file.ts` — what changed
```

Then add it to the table above.
