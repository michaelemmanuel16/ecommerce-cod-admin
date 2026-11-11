# M7 COD-193 /simplify fixes — builder spec

Repo: /Users/mac/Downloads/claude/ecommerce-cod-admin, branch `feature/m7-lead-conversion` (HEAD 599ab893). Work directly on this branch (no worktree). Read `CLAUDE.md` in the repo first.

Rules: behaviour must stay the same except where a step says otherwise. No new features. Touch only the files named. Do not commit or push; Opus reviews the diff and commits.

## Fixes

1. **Senders report whether they sent** (replaces `assertDispatched`).
   - `backend/src/services/whatsappService.ts`: `dispatch()` returns `{ sent: boolean; providerMessageId?: string }`. `sent: false` on the early "not configured" return; `sent: true` after a successful API call. `sendTemplate` and `sendText` return `{ messageLogId, providerMessageId, sent }`.
   - `backend/src/services/smsService.ts`: same for `dispatch()` / `sendSms` (`sent: false` for "not configured" and "disabled").
   - Existing callers that read only `messageLogId`/`providerMessageId` keep working. Do not change other callers.
   - `backend/src/services/autoConfirmService.ts`: delete `assertDispatched`; throw when a send returns `sent !== true`.
   - Update unit/integration test mocks of `sendTemplate`/`sendSms` that auto-confirm uses so success mocks return `sent: true` (e.g. `src/__tests__/integration/autoConfirm.test.ts` mocks returning `{ messageLogId: 1 }` or a string). The test "releases the claim when neither channel is set up" must still pass with no spies.

2. **autoConfirmService send block**: one local `sendSmsFallback()` (sendSms + sent check) used for both the SMS channel and the WhatsApp fallback; remove the `sent` flag and nested try/catch duplication. Keep: WhatsApp first when channel is whatsapp, SMS fallback on WhatsApp failure, release claim (delete token, null `autoConfirmSentAt`) and throw "could not be sent" when nothing went out.
   - Move the `systemConfig` + `tenant` lookups (used only for the SMS store prefix) to after the atomic claim succeeds.

3. **One package label helper.** `upsellService.ts:~143` (in `getUpsellOptions`) and `autoConfirmService.ts:~124-134` both build the package label. Export one function from `upsellService.ts` (e.g. `packageLabelFor(order)`) using upsellService's current logic (line with `itemType === 'package'`, `metadata.packageName`, else `${qty} × ${productName}`), and call it from both. Note: auto-confirm text changes from "1 x Name" to "1 × Name" — accepted.

4. **whatsappController button handling** (`backend/src/controllers/whatsappController.ts` ~166-179 and ~303-378):
   - Replace the payload if/else chain with `const PAYLOAD_KIND = { CONFIRM: 'yes', CHANGE: 'change', CANCEL: 'cancel' } as const`.
   - Collapse change/cancel/no into one branch driven by a reply-text table; one `confirmToken.updateMany` for all kinds. Keep every current reply text, status update, tag and log message meaning exactly.

5. **Workflow executor duplicate**: `workflowQueue.ts:~358-366` and `workflowService.ts:~476-482` both normalise the channel and map null to a skip reason for `send_auto_confirm`. Export one helper from `autoConfirmService.ts` and call it from both.

6. `payoutService.ts:~54-55`: one `byAge` comparator used twice; partition with two `filter` calls.

7. `commissionService.ts`:
   - `let deduction` reassigned but never read (~252, 273): make it `const`, drop the unused reassignment.
   - Delete the comment that restates the `where` clause (~236).
   - `voidOpenEntriesForOrder` (~2233-2245 in diff, two locking queries): one locking query with `status IN ('pending','earned','paid')`, split the rows in code. Same locks, same results.

8. `rewardService.ts`:
   - `getRepPay` duplicates `getRewardFeatures` (`tenantFeatures.ts:54`). Give `getRewardFeatures` an optional Prisma client param; make `getRepPay` = `repPayOf(await getRewardFeatures(client))`. Keep `getRepPay`'s signature for its callers.
   - Fix the stale doc comment (~40) that says GL posting reads `User.commissionAmount` until M7.
   - Find the Settings > Rep pay notice text (frontend) that says changes apply to orders "delivered after the save". Amounts are fixed at confirm time; change it to "confirmed after the save".

9. `repService.ts:~483`: move the `getRepPay` call into the existing `Promise.all` above it.

10. `frontend/src/pages/rep/RepNumbersPage.tsx:~12-19`: replace `formatPeriodMonth` with `monthName` from `frontend/src/pages/targets/model.ts` (e.g. `` `${monthName(period)} ${period.slice(0,4)}` ``). Output must stay "November 2026".

## Checks to run (report results)
- `cd backend && npx tsc --noEmit -p . && npx eslint <touched files>`
- `cd backend && timeout 400 npx jest --config jest.unit.config.js --forceExit`
- `cd backend && timeout 600 npx jest --config jest.integration.config.js src/__tests__/integration/autoConfirm.test.ts <commission/payout/rep/whatsapp integration tests touched> --forceExit`
- `cd frontend && npx tsc --noEmit && npx vitest run <touched page/component tests>`

Report: files changed, each fix done or skipped (with reason), check results.
