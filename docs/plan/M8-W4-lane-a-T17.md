# M8 wave 4, lane A: COD-75 task T17 (Meta Ads card in Settings, Integrations)

Worktree `.claude/worktrees/m8-a`, branch `m8/lane-a` (reset to `feature/m8-marketing` after the T05/T06 merge). **Frontend only**, no backend changes (if a backend gap blocks you, stop and report it). Lane B is building backend marketing KPI files: do not touch `backend/`.

Read first: repo `CLAUDE.md`, `frontend` conventions in it, `docs/plan/M8.md` row T17. Copy the patterns of the existing WhatsApp card, do not invent a new look: `frontend/src/components/settings/IntegrationsPanel.tsx` (section nav, `?section=` handling), `integrations/WhatsAppIntegration.tsx`, `WhatsAppOAuthButton.tsx`, `WhatsAppPhonePickerModal.tsx` (OAuth popup or redirect, picker modal), the frontend API service those use.

## Backend API (already built, `/api/meta-ads`, all need login)
- `POST /oauth/initiate` (marketing:update) -> `{ authUrl }`. Send the browser to it (same way WhatsApp does).
- Meta redirects back to `/settings?tab=integrations&section=meta-ads&metaAds=pick&pick=<pickId>` or `...&metaAds=error&message=<text>`.
- `GET /oauth/pick/:pickId` -> `{ accounts: [{ accountId, name, currency, timezone, ... }] }`; `POST /oauth/pick/:pickId` body `{ accountIds: string[] }` saves them. The pick lasts 10 minutes.
- `GET /accounts` (marketing:view) -> `{ accounts: [{ id, accountId, name, currency, timezone, enabled, status ('connected'|'disconnected'), statusReason, tokenType ('system_user'|'user'), tokenExpiresAt, lastPulledAt, lastPullError }] }`. Read the controller/service for exact names.
- `PATCH /accounts/:id` `{ enabled }`; `DELETE /accounts/:id`; `POST /accounts/:id/refresh` -> `{ lastPulledAt, days: string[], lastPullError }`, 429 `{ error: 'Refresh again in a few minutes.' }`.

## Build
1. New section `meta-ads` ("Meta Ads", "Ad spend") in `IntegrationsPanel` nav, component `integrations/MetaAdsIntegration.tsx`.
2. No accounts: one "Connect Meta Ads" button and one line: "CodAdmin reads your ad spend each day at 05:00. It never changes your ads."
3. On `metaAds=pick`: open a picker modal with the accounts (checkbox each, name, `act_` id, currency). Save -> list refreshes, URL params cleared. On `metaAds=error`: show the message as an inline error, clear the params.
4. Account list (one row each): name, currency, switch for `enabled`, status chip (Connected / Disconnected with `statusReason`), token line ("Never expires" for system_user; "Expires <date>" for user, amber when 7 days or less), "Last pull <relative time>" or `lastPullError` in red, buttons: Refresh now (spinner, shows 429 text inline), Remove (confirm with the app's own dialog component, not `window.confirm`).
5. Any disconnected account: a "Reconnect Meta Ads" button (same initiate call).
6. Users without marketing:update see the list read-only (no buttons, no switch). Use the app's existing permission hook.
7. Plain words, no emojis, v2 tokens, light and dark.

## Tests
Vitest + Testing Library, mocked API: empty state, picker save, error param shows message, disconnected shows Reconnect, refresh 429 shows the text, read-only user sees no buttons, expiry warning at 7 days.

## Checks
`cd frontend && npx tsc --noEmit && npm run lint`, the new test file by name with `npx vitest run <file>`. No full suite.

## Report
One commit `feat(M8): Meta Ads card in Settings, Integrations (COD-75)`. Do not push. Reply: sha, files, check output, changes from spec and why.
