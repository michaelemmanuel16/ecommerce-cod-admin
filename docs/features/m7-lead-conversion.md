# M7 Lead Conversion

Milestone M7 of the CodAdmin rebuild: lead conversion. Reps log call outcomes, add upsells, and earn commission on confirmed orders that deliver. Plan: `docs/plan/M7.md`.

---

## COD-63 — Schema, commission, call outcomes and upsell (M7-T01 to T04)
**Date:** 2026-11-09 | **Type:** feat | **Branch:** feature/m7-lead-conversion | **Commits:** b32e78e5, d12fbb1f, 2b3a2f69, 9e7bff39, 6b157745, 6ef0bfd4, 13ed9250

### Summary
Backend for lead conversion. Built by agy (Gemini) from `docs/plan/M7-I01-agy-spec.md`; reviewed by Opus; two agy fix rounds (`M7-I01-agy-fix1.md`, `M7-I01-agy-fix2.md`) and one inline fixture fix.

### Changes
- **Database (`20261109100000_m7_lead_conversion_schema`):** new tables `upsell_lines` and `confirm_tokens`, both with a required `tenant_id` and in the tenant-scoped list. `CallOutcome` final values: confirmed, not_reachable, call_back, declined, wrong_number; old `other` rows stay as legacy "Other". `customers` gets COD block and override fields, `risk_level` and `wrong_number`. `orders` gets `auto_confirm_sent_at`, `customer_response` and `said_no`. Calls get a decline reason and call-back time. Money is Decimal(19,4).
- **Commission (`commissionService`, `commissionBackfillService`):** on a rep-confirmed order, a GH₵8 `base` entry and an `upsell` entry (10% of active upsell extra value), both `pending`. Delivery sets them `earned` once. Only the confirming rep is paid (rule P6). No entries for auto-confirmed, self-service, no-rep or AI-agent orders. Return or cancel voids open entries; earned entries reverse through the M5 posting path. Backfill: delivered orders not yet paid out; dry run prints counts and total first.
- **Call outcomes (`callService`, `callController`, `orderStateMachine`):** rules and effects per M7-T03. Call and order effects save in one transaction (review round 1).
- **Upsell (`upsellService`, `upsellController`, `orderRoutes`):** server-computed extra value, order total raised, lines void on cancel, row locks, permission checks, archived packages not offered, overlap warning.
- **Clean-up:** dropped outcome values removed from services, validators and tests; `numbersFixture` uses the new enum.

### Verification
- Backend tsc and lint clean. Unit 1786/1786. 27 integration files 434/434, with fixture totals asserted: Adwoa base 2,024 + upsell 610; Nana 104 + 30.
- Pre-push check green (lint, tsc, unit, workflows).
- No screens changed in this ticket, so no browser check.

### Open points
- Frontend still uses the old outcome labels (`frontend/src/types/index.ts`, `TeamTab`). Fix in the rep screen ticket.
