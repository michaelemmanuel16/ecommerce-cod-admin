# M7 COD-193 — no "sent" when nothing was sent (all callers) — builder spec

Repo: /Users/mac/Downloads/claude/ecommerce-cod-admin, branch `feature/m7-lead-conversion`, in place (no worktree). Read repo `CLAUDE.md` first. Do not commit or push.

## Background
After the /simplify round, `whatsappService.sendTemplate` / `sendText` and `smsService.sendSms` return `{ messageLogId, providerMessageId, sent }`. `sent: false` means the channel is not set up (or SMS is disabled): the message log stays `pending` and nothing went out. Auto-confirm already treats that as a failure. Other callers still report success. Owner wants this fixed everywhere (2026-11-11).

## Rule
A send with `sent: false` is never shown or counted as sent. Pick the behaviour per caller:

1. **Workflow send actions** — `backend/src/queues/workflowQueue.ts` (~338-344) and `backend/src/services/workflowService.ts` (~435-441), send_whatsapp / send_sms: when `sent` is false, the action fails with a clear error, e.g. `WhatsApp is not set up: message not sent`, using the same failure path a provider error already takes (so the workflow run shows the step as failed). Do not change how real provider errors are handled.
2. **Bulk sends** — `backend/src/services/communicationService.ts` (~158, ~197): count `sent: false` as failed (or the existing skipped/failed bucket, whichever exists), not as sent. Keep the response shape; only the counts change. If a reason field exists per recipient, set it to "not set up".
3. **Test-message endpoints** — `backend/src/controllers/smsController.ts` (~64) and `whatsappController.ts` (~575): when `sent` is false, return 4xx (400 or 409, match nearby error style) with message `SMS is not set up` / `WhatsApp is not set up`, not a success.
4. **Callers that ignore the result** — `whatsappController.ts` (~452 and the button auto-replies ~310/333/356), `agingService.ts` (~285), `digitalDeliveryService.ts` (~158): add a `logger.warn` with the order/customer id when `sent` is false. Do not change their control flow, except: if `digitalDeliveryService` marks a delivery as sent/delivered after the call, it must not do so when `sent` is false (keep it retryable the same way a provider error is).
5. Grep for any other caller of `sendTemplate(`, `sendText(`, `sendSms(` in `backend/src` (not tests) and apply the matching rule above. List each in the report.

## Frontend
If a screen shows a success toast for the test-message buttons, check it now shows the error message from the 4xx. Only change frontend code if it would show success on a 4xx.

## Tests
- One integration or unit test per rule 1-3 with the channel not set up (no spies on the sender, or spy returning `{ sent: false }`), asserting failure / failed count / 4xx.
- Update existing mocks that return success so they include `sent: true`.

## Checks (report results)
- `cd backend && npx tsc --noEmit -p . && npx eslint <touched files>`
- `cd backend && timeout 400 npx jest --config jest.unit.config.js --forceExit`
- `cd backend && timeout 600 npx jest --config jest.integration.config.js <touched/related integration tests> --forceExit`
- frontend `npx tsc --noEmit` and touched vitest, if frontend changed.

Report: each caller and what it now does, files changed, check results.
