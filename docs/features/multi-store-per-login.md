# Multi-Store Per Login

Lets a single user login belong to more than one store (tenant), switch the active store, and self-serve provision additional stores — without duplicating accounts per store.

---

## MAN-100 — Store switcher in Header
**Date:** 2026-07-11 | **Type:** feat | **Branch:** feature/multi-store-per-login | **Commit:** 2416980

### Summary
Adds a `StoreSwitcher` to the Header: hidden for users with zero stores, a minimal store-name trigger for single-store owners, and a full dropdown (default-first sort, active-store checkmark, pending "Pending pay" un-switchable rows) for owners with 2+ stores. Scope was expanded during brainstorming to include a self-serve "+ Add a store" modal, wired to the existing `POST /api/stores` provisioning endpoint (MAN-89), distinct from MAN-102's admin-console-only creation flow.

### Changes
- **Backend:** minor `authController.ts` tweak (no route/schema changes — `GET /api/stores` and `POST /api/stores` already existed from MAN-89/MAN-108)
- **Frontend:** new `StoreSwitcher.tsx` + `stores.service.ts`; `authStore.ts` gained `stores`, `fetchStores`, `switchStore`; `Header.tsx` renders the switcher; `Dropdown.tsx` extended to support the panel

### Key Files
- `frontend/src/components/layout/StoreSwitcher.tsx` — switcher + add-store modal (new)
- `frontend/src/services/stores.service.ts` — `getStores`/`createStore`/`switchStore` client (new)
- `frontend/src/stores/authStore.ts` — store list + switch-store state
- `frontend/src/components/layout/Header.tsx` — mounts `StoreSwitcher`
- `frontend/src/components/ui/Dropdown.tsx` — panel width support
- `backend/src/controllers/authController.ts` — minor tweak
