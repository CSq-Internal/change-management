# CAB "Add member" fix — design

Date: 2026-07-13

## Problem

A group admin cannot add CAB members:

1. **Per-OpCo tab — Add button does nothing.** In `cab-client.tsx`, `perOpcoSlug`
   resolves to `undefined` for a group admin (their manageable scope is `"all"`, not a
   concrete slug) whenever no per-OpCo member exists yet. That disables the Add button
   (`disabled={!isAdmin || (tab === "perOpco" && !addSlug)}`), so the first member can
   never be added. The UI has no way for a group admin to pick *which* OpCo the member
   belongs to.

2. **Group tab — picker is empty.** The Add dialog lists candidates via
   `listOpCoApprovers`, which filters `role: "approver"` only. But `addCabMember`
   accepts `approver` **or** `admin`. On prod, users are assigned as OpCo admins (no pure
   approvers), so the picker shows no one.

`addCabMember` / `removeCabMember` / `listCabMembers` are correctly wired to Postgres —
the fault is entirely in candidate listing and the per-OpCo target selection.

## Decisions

- Per-OpCo target OpCo is chosen via a `<select>` **inside the Add dialog**; the per-OpCo
  table keeps showing all OpCos' members (mixed).
- The eligible-candidates picker lists **approver AND admin** users, matching what
  `addCabMember` already accepts.

## Changes

### 1. New server action `listCabEligible(opcoSlug)` — `src/server/actions/users.ts`

Same authz as `listOpCoApprovers` (group_admin for `null`; `canManageUsers(...)` for a
slug) but `where: { role: { in: ["approver", "admin"] }, isActive: true, ...slugFilter }`,
`distinct: ["userId"]`. Returns `{ id, name, email }[]`.

`listOpCoApprovers` is left unchanged — it is also used by the delegations dialog
(`delegation-create-dialog.tsx`), where approver-only semantics are correct.

### 2. `cab/page.tsx`

Compute `manageableOpcos: { slug, name }[]` from `manageableOpCoSlugs(orgs, realmRoles)`:

```ts
const scope = manageableOpCoSlugs(session.user.organizations, session.user.realmRoles)
const manageableOpcos = await db.opCo.findMany({
  where: { archivedAt: null, ...(scope === "all" ? {} : { slug: { in: scope } }) },
  orderBy: { name: "asc" },
  select: { slug: true, name: true },
})
```

Pass `manageableOpcos` to `CabClient`.

### 3. `cab-client.tsx`

- Add-button enable rule:
  - group tab: enabled only when `isGroupAdmin(realmRoles)` (group CAB add is group_admin-only server-side).
  - per-OpCo tab: enabled when `manageableOpcos.length > 0`.
- Dialog props: pass `opcos` = `null` on the group tab, `manageableOpcos` on the per-OpCo
  tab; pass `existing` = the per-OpCo members mapped to `{ userId, opcoSlug }` (group tab
  passes the group members as `{ userId, opcoSlug: null }`).
- `perOpcoSlug`/`addSlug` derivation is removed.

### 4. `cab-add-dialog.tsx`

New props:

```ts
interface CabAddDialogProps {
  language: Language
  opcos: { slug: string; name: string }[] | null // null = group CAB
  existing: { userId: string; opcoSlug: string | null }[]
  onClose: () => void
  onAdded: () => void
}
```

- `opcos === null` → group mode: no picker, `selectedSlug = null` (unchanged behavior).
- `opcos` is a list → per-OpCo mode: `selectedSlug` state defaults to `opcos[0].slug`,
  render an OpCo `<select>`.
- `useEffect` on `selectedSlug` calls `listCabEligible(selectedSlug)`.
- Exclude candidates already on the selected OpCo's CAB:
  `existing.filter(e => e.opcoSlug === selectedSlug).map(e => e.userId)`.
- `add(userId)` calls `addCabMember(userId, selectedSlug)`.

### 5. i18n — `src/lib/i18n.ts`

- `cabAdmin.pick`: change "Only users with the approver role are listed." →
  "Only users with the approver or admin role are listed." (EN) and the FR equivalent.
- Add `cabAdmin.opcoLabel`: "OpCo" (EN) / "OpCo" (FR).

### 6. Tests

- `src/test/actions/users-authz.test.ts`: `listCabEligible` — Forbidden for non-admin;
  includes admin-role users (not just approvers).
- `src/test/app/cab/cab-add-dialog.test.tsx`: per-OpCo mode renders the OpCo `<select>`;
  selecting an OpCo lists eligible users and `add` calls `addCabMember` with the selected
  slug. (Mock `listCabEligible`.)
- `src/test/app/cab/cab-client.test.tsx` (new): per-OpCo Add button enabled for a group
  admin when `manageableOpcos` is non-empty; group-tab Add disabled for a non-group-admin.

## Out of scope

No change to `addCabMember`/`removeCabMember` server logic — they already enforce
per-OpCo authz and approver-or-admin eligibility.
