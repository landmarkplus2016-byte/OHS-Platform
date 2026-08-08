# CLAUDE.md — OHS Platform
> This file is Claude Code's persistent memory for this project.
> Read this at the start of every session before writing any code.

---

## What We Are Building

A modular safety and compliance platform for Landmark's Occupational Health & Safety department. The successor to OHS-DB, built to scale across multiple safety domains (employees, equipment, vehicles, and future modules) with a real backend, proper multi-admin permissions, and no manual file-shuffling workflow.

- **1 super admin (Khaled):** Full access to everything — user management, all modules, all settings
- **Multiple module admins (future):** Each admin manages one or more modules with per-module view/edit permissions. Cannot manage users. No default access to modules they don't own.
- **~10 safety officers:** Mobile PWA — read-only field verdict lookup across all modules the platform tracks
- **1 developer (Khaled):** Only person with direct Google Sheet access. Everyone else uses the platform.
- Hosted on **GitHub Pages** (static site — no server)
- **Google Sheets** as the sole database, accessed ONLY through a single Google Apps Script Web App
- **No Firebase. No npm. No build tools. No frameworks.** Pure HTML, CSS, and vanilla JavaScript, served as-is. All dependencies via CDN.

---

## What's Different From OHS-DB

OHS Platform is not an evolution of OHS-DB — it's a rebuild designed for the workload OHS-DB was never architected for. The key differences:

| Concern | OHS-DB (legacy) | OHS Platform (this repo) |
|---|---|---|
| Backend | JSON file on Drive + manual export/upload | Google Sheets via Apps Script Web App |
| Admin sync ritual | Export JSON → drag to Drive after every editing session | None — every write goes to Sheets in real time |
| Officer data freshness | Officers pull the last-published snapshot | Officers always fetch fresh data from Sheets |
| Modules | Employees only (RDT bolted on) | Modular — employees, equipment, and future modules as first-class citizens |
| Admin count | Single admin | Multi-admin with per-module permissions |
| Permission enforcement | Client-side (visual only) | Server-side in Apps Script — the security gate |
| Officer app writes | Read-only | Read-only (unchanged — feedback happens outside the app) |
| Session persistence | CURRENT_USER cleared on every reload | Session tokens with configurable expiry, validated server-side |

OHS-DB stays running untouched during the OHS Platform build. Users cut over on one day when OHS Platform reaches feature parity plus the equipment module. OHS-DB is then marked legacy and receives no further updates.

---

## Tech Stack — Plain HTML/CSS/JS, No Build Tools

This project is intentionally framework-free and build-tool-free:

- **No npm, no package.json, no node_modules, no Vite, no webpack, no bundler of any kind**
- **No React, no Vue, no framework** — UI is built with plain JS functions that return HTML strings (template literals), inserted via `innerHTML`, exactly like OHS-DB and LMP Attendance
- **No Tailwind** — plain CSS files using CSS custom properties (variables) for design tokens
- **No npm packages** — any third-party library (SheetJS for Excel, jsPDF for PDF) is loaded via a `<script src="https://cdn...">` tag directly in `index.html`, pinned to a specific version
- **Routing** — hash-based routing (`#/dashboard`, `#/employees/field`, `#/equipment/active`, etc.) implemented in plain JS by reading `location.hash`
- **i18n** — plain JS objects with `en` and `ar` keys, same pattern as OHS-DB
- **Backend** — a single Google Apps Script Web App deployment, accessed only via `js/api.js`

### Deployment

GitHub Pages serves the repo directly — no build/deploy script, no `gh-pages` branch, no `dist/` folder. Push to `main`, GitHub Pages serves the root. Editing a file and pushing is the entire deployment process. The Apps Script is deployed once from the Apps Script editor and its Web App URL is stored in `localStorage` on each user's device (not in code — never in code).

---

## User Roles — Quick Reference

| Role | Device | Navigation | Key permissions |
|---|---|---|---|
| Super admin | Desktop | Left sidebar, grouped | Everything: user management, all modules, all settings, all reports |
| Module admin | Desktop | Left sidebar, filtered by permissions | Full edit access to owned modules only. Dashboard visible in full. No user management. No view access to non-owned modules. |
| Officer | Mobile PWA | Bottom shell | Read-only verdict lookup across all modules (employees, equipment, future). No write access anywhere. |
| Developer (Khaled) | — | Google Sheet + Apps Script editor | Only person with direct Sheet and Script access. Never uses the Sheet as a manual interface for data entry — everything goes through the platform. |

> ⚠️ Nobody except the developer opens the Google Sheet. All admins — including the super admin — manage data through the platform. The Sheet is a locked, silent database.

---

## Non-Negotiable Rules

These are the rules that everything downstream depends on. Never break one without explicitly confirming with the project owner (Khaled).

### Backend and data

1. **Never call Google Sheets directly from the frontend** — ALL reads and writes go through `js/api.js` → Apps Script. No exceptions.
2. **The Apps Script URL is never in code** — it lives in `localStorage` as `ohsp_script_url`, set on each device's first launch. Never committed to the repo.
3. **The Google Sheet ID never leaves the Apps Script** — no frontend code, no client-side config, no documentation outside the Apps Script itself mentions the Sheet ID.
4. **Session token on every call except `login` and `get_config`** — Apps Script validates the token at the top of every action handler before doing anything else.
5. **Role and permission enforcement is server-side** — Apps Script checks `can_edit(module)` and `can_view(module)` on every relevant action. The frontend hides UI based on permissions for UX, but the server is the gate.
6. **Never hard-delete any record** — employees, equipment, users all deactivate/archive. Historical records and audit trails must be preserved forever.
7. **Passwords are always hashed** — SHA-256 hex, computed in the browser before sending. Plain-text passwords never travel over the network, never land in Sheets, never appear in logs.
8. **Every write includes `updated_at` and `updated_by`** — set server-side from the session, never trusted from the client payload.

### Frontend architecture

9. **No backend calls from any file except `js/api.js`** — pages, components, and modules never fetch directly. They call `api.call('action_name', payload)` and get typed results.
10. **HashRouter pattern only** — routes are `#/...` fragments handled by reading `location.hash`. GitHub Pages doesn't support server-side routing.
11. **One file, one job** — never add logic to a file that belongs in another file. See the File Map section.
12. **Modules are self-contained** — every module lives in `js/modules/<name>/` and registers itself with the router, sidebar, dashboard, and officer search via a module manifest. Modules never reach into each other's folders.
13. **Compliance and verdict logic is centralized per module** — a module's verdict logic lives in its own folder (`js/modules/<name>/verdict.js`) and is shared between admin and officer apps by import. Never duplicated.
14. **All UI text through `t('key')`** — never hardcode English or Arabic strings in JS template literals. Every key must exist in both `en.js` and `ar.js`.
15. **No hardcoded hex colors outside `css/tokens.css`** — always reference the CSS variable.

### Officer app

16. **Officer app is read-only in v1** — no writes to Sheets from officer sessions. Feedback happens outside the app (WhatsApp, phone, etc.). API and permission model designed so officer writes can be added later without a rebuild.
17. **Officer app is cache-first for verdict lookups** — the officer taps an entity, the app shows the cached verdict instantly with no server call. A manual "Refresh" button on the verdict page lets the officer force a fresh fetch when they want confirmation.
18. **Fail-closed on stale cache** — if the officer's cache is older than `max_stale_hours` (default 72, configurable), lock the app until re-sync succeeds. No override, no supervisor bypass. Officers who work at remote sites without signal must sync before leaving.
19. **Officers never see users, passwords, comments, or audit history** — Apps Script strips these fields before returning any snapshot to an officer session.

### Governance

20. **Cannot delete or demote the last super admin** — validated server-side on every user mutation.
21. **User management is super admin only** — Apps Script rejects `add_user`, `update_user`, `deactivate_user` from any non-super-admin session.
22. **Never add a feature not in this file without confirming with Khaled.**

---

## Non-Goals (Explicit)

Things this platform intentionally does NOT do, and shouldn't drift into:

- **Real-time collaboration.** Two admins editing the same record simultaneously results in last-write-wins with no merge. Concurrency handling is left for Supabase.
- **Offline admin editing.** Admins need connectivity. The platform doesn't queue admin writes. Officers get offline read-only cache, admins don't.
- **Officer writes in v1.** Officers report issues via WhatsApp or phone. Door left open: API and permission model designed so this can be added later without a rebuild.
- **Automated notifications.** No email/SMS/push for expiring certs. Admins check the dashboard.
- **File uploads.** Certificate PDFs and equipment inspection PDFs are stored as URL strings pointing to Google Drive. The platform never uploads, downloads, or stores the files themselves.
- **Multi-tenancy.** This is Landmark-only. SaaS multi-tenancy waits for the Supabase rebuild.
- **Import/export of the entire database.** Individual entity Excel imports/exports exist. There is no "download everything as JSON" — the Sheet is the database.

---

# Section 2 — Google Sheets Schema

This is the foundation. Every tab, every column, every key. Once locked, the Apps Script API surface (Section 3), the session model (Section 4), and the module manifest structure (Section 5) all reference this schema.

## Design principles

1. **Every entity gets its own tab.** Employees, Equipment, Users, Sessions, Config — separate tabs. No mixing entity types.
2. **Every row has a stable primary key.** Never reuse IDs. Never rename them. Never derive them from mutable fields (like national_id).
3. **Compliance state is never stored.** Derived at read time from dates + Config thresholds.
4. **Deletion is deactivation.** No row is ever removed. Employees archive, equipment gets rejected, users deactivate. Historical records live forever.

## The tabs (13 total)

### System tabs (3)

**`Config`** — key-value pairs for platform-wide settings.
**`Users`** — all admin and officer accounts.
**`Sessions`** — active login tokens, auto-cleaned nightly.

### Employee module tabs (3)

**`Employees`** — the employee records.
**`RenewalHistory`** — append-only log of certificate renewals per employee.
**`RdtLog`** — one row per random-drug-test event: who was selected, when, and what happened.

### Equipment module tabs (2)

**`Equipment`** — the equipment records.
**`InspectionHistory`** — append-only log of third-party inspection changes per equipment item.

### Shared module tabs (3)

**`FieldOptions`** — dropdown list options (subcontractors, titles, item types, brands, etc.), grouped by list name.
**`ModuleSettings`** — per-module configuration (thresholds, defaults, custom rules).
**`Permissions`** — the permission matrix. Rows are (user_id, module_name) → view + edit flags.

### Future-reserved tabs (2)

**`Vehicles`** — reserved for the cars-tracking module. Empty for v1, tab created upfront so schema evolution stays clean.
**`VehicleHistory`** — same. Append-only vehicle event log.

---

## Column reference — full detail

### `Config`

| Column | Type | Purpose |
|---|---|---|
| `key` | text | Setting name |
| `value` | text | Setting value (string form; parsed by Apps Script) |
| `updated_at` | ISO datetime | When last changed |
| `updated_by` | user_id | Who changed it |

**Required rows on setup:**

| Key | Default value | Purpose |
|---|---|---|
| `app_name` | `OHS Platform` | Displayed in shell + login |
| `company_name` | `Landmark` | Displayed in shell + reports |
| `primary_language` | `en` | Default language for new devices |
| `session_expiry_hours` | `8` | How long a login token stays valid |
| `max_stale_hours` | `72` | Officer cache lockout threshold |
| `employee_id_prefix` | `LM-EMP-` | Format for new employee IDs |
| `equipment_id_prefix` | `LM-EQP-` | Format for new equipment IDs |
| `vehicle_id_prefix` | `LM-VEH-` | Reserved for future |
| `next_employee_number` | `1` | Auto-increment counter |
| `next_equipment_number` | `1` | Auto-increment counter |
| `next_vehicle_number` | `1` | Auto-increment counter |
| `urgent_days` | `30` | Compliance derivation threshold |
| `soon_days` | `60` | Compliance derivation threshold |
| `drive_folder_url` | (empty) | Configurable, opens on export UX flow |

### `Users`

| Column | Type | Purpose |
|---|---|---|
| `user_id` | text | Primary key (e.g. `USR001`) |
| `username` | text | Unique login handle |
| `password_hash` | text | SHA-256 hex |
| `force_password_change` | boolean | True on account creation, cleared after first successful change |
| `display_name` | text | Shown in UI |
| `role` | text | `super_admin` \| `module_admin` \| `officer` |
| `is_super_admin` | boolean | Overrides all module permission checks |
| `active` | boolean | False = cannot log in |
| `created_at` | ISO datetime | |
| `created_by` | user_id | Who created this user |
| `updated_at` | ISO datetime | |
| `updated_by` | user_id | |
| `last_login_at` | ISO datetime | Populated by Auth.gs on successful login |

**Rules:**
- `role = super_admin` implies `is_super_admin = true`. Redundant but keeps the check simple everywhere.
- Never delete a user row. Deactivate via `active = false`.
- Cannot demote or deactivate the last row where `is_super_admin = true`. Server-side check on every user mutation.
- `force_password_change` is set to `TRUE` on user creation and on admin-initiated password resets. Cleared to `FALSE` on any user-initiated password change (see Section 4).

### `Sessions`

| Column | Type | Purpose |
|---|---|---|
| `token` | UUID | Primary key, generated on login |
| `user_id` | text | FK to Users |
| `role` | text | Cached from Users at login time |
| `is_super_admin` | boolean | Cached from Users at login time |
| `expires_at` | ISO datetime | Now + `session_expiry_hours` |
| `device_id` | text | Client-generated device fingerprint |
| `created_at` | ISO datetime | |

**Rules:**
- Auto-cleaned nightly by a scheduled Apps Script trigger — rows where `expires_at < now()` are deleted.
- On logout, the row is deleted immediately.
- On new login, all existing sessions for the same `user_id` are deleted before the new one is inserted (single-active-session policy — see Section 4).
- Session data (role, is_super_admin) is cached in the row for performance — every action lookup avoids a re-read of Users. But permission checks against `Permissions` tab happen fresh every time.

### `Permissions`

| Column | Type | Purpose |
|---|---|---|
| `user_id` | text | FK to Users |
| `module` | text | `employees` \| `equipment` \| `vehicles` \| future |
| `can_view` | boolean | |
| `can_edit` | boolean | |
| `updated_at` | ISO datetime | |
| `updated_by` | user_id | |

**Rules:**
- Composite key: (`user_id`, `module`). One row per user per module.
- Missing row = no access (default deny).
- Super admins bypass this table entirely — `is_super_admin = true` grants everything.
- Officers have implicit view access to all modules for lookup; they never have edit access under any circumstance.
- Modifying this table is restricted to super admins server-side.

### `Employees`

Full column list. Mirrors OHS-DB with adjustments for the new architecture.

| Column | Type | Purpose |
|---|---|---|
| `employee_id` | text | Primary key (e.g. `LM-EMP-0001`) |
| `national_id` | text | Egyptian 14-digit ID, searchable |
| `name` | text | Full name |
| `team` | text | `field` \| `safety` |
| `title` | text | From FieldOptions |
| `contractor` | text | From FieldOptions |
| `subcontractor` | text | From FieldOptions |
| `hired_date` | date | ISO |
| `employment_status` | text | From FieldOptions (`Active` \| `Suspended` \| etc.) |
| `legal_permission` | text | From FieldOptions (`Approved` \| `Not approved` \| `Pending`) |
| `archived` | boolean | Terminated/resigned flag |
| `archived_at` | ISO datetime | |
| `archived_by` | user_id | |
| `cert_wah_practical_expiry` | date | |
| `cert_wah_practical_link` | text | External Drive URL |
| `cert_wah_practical_na` | boolean | Not required for this employee |
| `cert_wah_practical_suspended` | boolean | Required, but void right now |
| `cert_wah_theoretical_expiry` | date | |
| `cert_wah_theoretical_link` | text | |
| `cert_wah_theoretical_na` | boolean | |
| `cert_wah_theoretical_suspended` | boolean | |
| `cert_ra_expiry` | date | |
| `cert_ra_link` | text | |
| `cert_ra_na` | boolean | |
| `cert_ra_suspended` | boolean | |
| `cert_fa_expiry` | date | |
| `cert_fa_link` | text | |
| `cert_fa_na` | boolean | |
| `cert_fa_suspended` | boolean | |
| `cert_ff_expiry` | date | |
| `cert_ff_link` | text | |
| `cert_ff_na` | boolean | |
| `cert_ff_suspended` | boolean | |
| `cert_ec_expiry` | date | |
| `cert_ec_link` | text | |
| `cert_ec_na` | boolean | |
| `cert_ec_suspended` | boolean | |
| `cert_mcu_expiry` | date | |
| `cert_mcu_link` | text | |
| `cert_mcu_na` | boolean | |
| `cert_mcu_suspended` | boolean | |
| `cert_ppe_expiry` | date | Safety team only, blank for field |
| `cert_ppe_link` | text | |
| `cert_ppe_na` | boolean | |
| `cert_ppe_suspended` | boolean | |
| `cert_lifting_expiry` | date | Safety team only |
| `cert_lifting_link` | text | |
| `cert_lifting_na` | boolean | |
| `cert_lifting_suspended` | boolean | |
| `cert_scaffolding_expiry` | date | Safety team only |
| `cert_scaffolding_link` | text | |
| `cert_scaffolding_na` | boolean | |
| `cert_scaffolding_suspended` | boolean | |
| `qual_nebosh` | boolean | Safety team only |
| `qual_iso_45001` | boolean | Safety team only |
| `qual_osha` | boolean | Safety team only |
| `created_at` | ISO datetime | |
| `created_by` | user_id | |
| `updated_at` | ISO datetime | |
| `updated_by` | user_id | |

**Key change from OHS-DB:** Certificates are flat columns instead of a nested object. Sheets doesn't do nested structures. Every cert has four flat columns — `cert_<key>_expiry`, `cert_<key>_link`, `cert_<key>_na`, `cert_<key>_suspended` — where OHS-DB had one nested object with four properties.

**The two flag columns** are admin decisions that override the expiry date at derivation time (Section 6.1). `_na` means the certificate does not apply to this employee at all; `_suspended` means it applies but is void right now. Both are stored independently and neither ever rewrites the other or the date — the precedence between them is applied in `Compliance.gs`, so unticking a flag restores exactly what was underneath it.

**Adding these columns to an existing Sheet:** run `addEmployeeCertFlagColumns()` once from the Apps Script editor. It appends any of the 20 columns that are missing and backfills every existing row with `FALSE`. It is idempotent. Until it has run the platform still works — an absent column reads as `false` and every certificate derives from its date exactly as before.

**No RDT columns on this tab.** Drug testing is an event log, not a date field — one employee can be tested many times in a year, and each test carries a status, a result, and notes. It lives on `RdtLog`. The flat `rdt_1` / `rdt_2` / `rdt` columns that shipped in the first cut of this schema are retired; nothing reads or writes them.

### `RenewalHistory`

Append-only. One row per certificate renewal event.

| Column | Type | Purpose |
|---|---|---|
| `history_id` | text | Primary key (e.g. `RH-0001`) |
| `employee_id` | text | FK |
| `cert_key` | text | `wah_practical`, `mcu`, etc. |
| `old_expiry` | date | |
| `new_expiry` | date | |
| `renewed_at` | ISO datetime | |
| `renewed_by` | user_id | |

### `RdtLog`

One row per random-drug-test event. An employee may have many rows per fiscal year.

| Column | Type | Purpose |
|---|---|---|
| `log_id` | text | Primary key (e.g. `RDT-000001`) |
| `employee_id` | text | FK to Employees |
| `fiscal_year` | text | `"2026-2027"` — computed at selection time, never recomputed |
| `selected_at` | date | ISO date the monthly selection was generated |
| `selected_by` | user_id | Who generated it |
| `test_date` | date | ISO date the test actually happened. Blank until completed; stays blank for missed |
| `status` | text | `selected` \| `completed` \| `missed` |
| `result` | text | `pass` \| `fail` \| blank. Only meaningful when `status = completed` |
| `notes` | text | Free text, ≤500 chars |
| `updated_at` | ISO datetime | |
| `updated_by` | user_id | |

**Rules:**
- `fiscal_year` is stamped once at selection and never recalculated. A test selected in March 2027 belongs to FY 2026-2027 even if it completes in April.
- A `completed` row is the only kind that counts toward yearly coverage. `missed` re-opens the employee for a later month; it counts for nothing.
- Deleting a row is permitted here and nowhere else in the schema. An RdtLog row is a *plan*, not a record of an entity — a selection that was generated in error and never carried out is noise in the audit trail, not history worth keeping. The UI confirms before every delete. This is the sole documented exception to rule 6.

### `Equipment`

| Column | Type | Purpose |
|---|---|---|
| `equipment_id` | text | Primary key (e.g. `LM-EQP-0001`) |
| `team_leader_id` | text | FK to Employees, can be empty (unassigned) |
| `subcontractor` | text | Owning company. From FieldOptions (`subcontractors`) — the same list Employees uses |
| `item` | text | From FieldOptions (`equipment_items`) |
| `brand` | text | From FieldOptions (`equipment_brands`) |
| `date_of_manufacture` | date | |
| `serial_no` | text | Required, searchable |
| `third_party_sn` | text | Required, searchable |
| `third_party_inspection_end_date` | date | Primary compliance date |
| `wave_1_date` | date | |
| `wave_1_result` | text | `pass` \| `fail` \| empty |
| `wave_2_date` | date | |
| `wave_2_result` | text | |
| `wave_3_date` | date | |
| `wave_3_result` | text | |
| `comments` | text | Admin-only, stripped from officer snapshots |
| `rejected` | boolean | Terminated equivalent |
| `rejection_date` | date | |
| `rejected_by` | user_id | |
| `rejection_reason` | text | |
| `created_at` | ISO datetime | |
| `created_by` | user_id | |
| `updated_at` | ISO datetime | |
| `updated_by` | user_id | |

**Two ownership columns, on purpose.** `team_leader_id` is who is *carrying* the item; `subcontractor` is who *owns* it. In-house gear names a team leader and carries Landmark as its subcontractor; a subcontractor's gear names the company and usually no leader, because the people holding it are not on the platform's roster. Neither can be derived from the other, and the question "whose expired harness is this" is answered by the second one.

It borrows the employees' `subcontractors` FieldOptions list rather than getting one of its own — the company that supplies the people supplies the gear, and two lists would drift the first time somebody renamed one.

**Adding this column to an existing Sheet:** run `addEquipmentSubcontractorColumn()` once from the Apps Script editor. It is idempotent. Nothing is backfilled — blank means "not recorded", and guessing that every existing row is in-house would be inventing ownership. Until it has run the platform still works: an absent column reads as `''` and every item behaves exactly as before, simply with no owner on file.

### `InspectionHistory`

Append-only. One row per third-party inspection date change.

| Column | Type | Purpose |
|---|---|---|
| `history_id` | text | Primary key (e.g. `IH-0001`) |
| `equipment_id` | text | FK |
| `old_expiry` | date | |
| `new_expiry` | date | |
| `renewed_at` | ISO datetime | |
| `renewed_by` | user_id | |

### `FieldOptions`

The dropdown options for every list-driven field, unified in one tab.

| Column | Type | Purpose |
|---|---|---|
| `list_key` | text | Which list this option belongs to |
| `option_value` | text | The option itself |
| `sort_order` | integer | For display ordering |
| `active` | boolean | False = hidden from new dropdowns but preserved on old records |
| `updated_at` | ISO datetime | |
| `updated_by` | user_id | |

**List keys used at launch:**

- `field_titles`, `safety_titles`
- `contractors`, `subcontractors`
- `employment_status`, `legal_permission`
- `equipment_items`, `equipment_brands`

Composite lookup: (`list_key`, `option_value`).

### `ModuleSettings`

Per-module config that would otherwise clutter Config.

| Column | Type | Purpose |
|---|---|---|
| `module` | text | `employees` \| `equipment` \| etc. |
| `setting_key` | text | |
| `setting_value` | text | |
| `updated_at` | ISO datetime | |
| `updated_by` | user_id | |

**Example rows at launch:**

- (`employees`, `blocker_certs`, `wah_practical,wah_theoretical,mcu`)
- (`employees`, `warning_certs`, `fa,ff,ra,ec`)
- (`equipment`, `blocker_condition`, `third_party_expired_or_latest_wave_failed`)

**RDT configuration** lives here too, all under the `employees` module. The RDT page is off until `rdt_enabled` is `TRUE`; the page offers a one-click enable that seeds every row below with its default.

| `setting_key` | Default | Purpose |
|---|---|---|
| `rdt_enabled` | `FALSE` | Master switch. `FALSE` → the RDT page shows its onboarding card |
| `rdt_fiscal_year_start_month` | `4` | 1–12. April starts Landmark's RDT year |
| `rdt_monthly_target_pct` | `10` | Percent of the eligible pool selected each month |
| `rdt_yearly_target_pct` | `120` | Yearly coverage goal |
| `rdt_hire_grace_months` | `3` | New hires are covered by their hiring medical for this long |
| `rdt_repeat_months` | `2,3` | Months that draw from already-tested employees instead of untested ones |
| `rdt_safety_title` | `Safety Officer` | The only safety-team title in scope. Field team is in scope at every title |

The retired `rdt_year_start` and `rdt_target_pct` keys are superseded by these.

### `Vehicles` and `VehicleHistory`

Reserved tabs, columns TBD when the cars module gets spec'd. Empty for v1. The tabs exist so the schema doesn't require a migration when we add them — just start populating.

---

## Data type conventions

Standardizing across the whole schema:

- **Dates:** stored as ISO strings `YYYY-MM-DD`. Never as Sheet date serials (auto-converts are lossy).
- **Datetimes:** stored as ISO `YYYY-MM-DDTHH:MM:SS`. UTC assumed.
- **Booleans:** stored as literal strings `TRUE` or `FALSE` — never `1/0`, never blank-for-false.
- **Empty values:** blank cells for empty. Never null strings, never dashes, never `N/A`.
- **User references:** always `user_id`, never `username`. Usernames can change; user_ids can't.

## Server-side lookups

Apps Script maintains an in-memory cache during each request for repeated Sheet reads:

- Users tab loaded once per request → all permission checks reuse it
- FieldOptions loaded once per request → all dropdown validations reuse it
- Config loaded once per request

This is a small optimization but matters for actions that touch multiple tabs.

---

# Section 3 — Apps Script API Surface

This is the contract between the frontend (`js/api.js`) and the Google Apps Script Web App. Every action the platform can perform is listed here with its payload, response, and permission check. Nothing calls Sheets except Apps Script. Nothing calls Apps Script except `js/api.js`.

## 3.1 Transport and envelope

### Single endpoint, action-dispatched

There is exactly one deployed Apps Script Web App. It exposes one function: `doPost(e)`. Every action the platform performs is a POST to that URL with a JSON body.

```
POST {ohsp_script_url}
Content-Type: text/plain;charset=utf-8

{
  "action": "list_employees",
  "token": "a1b2c3d4-...",
  "payload": { "team": "field", "include_archived": false }
}
```

**Why `text/plain`:** Apps Script Web Apps do not support CORS preflight for `application/json`. Sending as `text/plain` avoids the preflight entirely. The body is still JSON; only the header lies. This is the same pattern LMP Attendance uses.

**Why POST for everything, even reads:** Apps Script's `doGet` has stricter URL length limits and worse logging. All actions go through `doPost` for consistency. There is no `doGet` handler except a trivial health check that returns `{ok: true, service: "OHS Platform API"}`.

### Request shape

Every request has three top-level fields:

| Field | Type | Required | Purpose |
|---|---|---|---|
| `action` | string | Always | Which action to run (see catalog below) |
| `token` | string | All actions except `login` and `get_config` | Session token from a prior `login` call |
| `payload` | object | Depends on action | Action-specific data |

Unknown top-level fields are ignored. Unknown fields inside `payload` cause `validation_failed`.

### Response envelope

Every response — success or failure — is one of two shapes:

**Success:**
```json
{
  "ok": true,
  "data": { ...action-specific... }
}
```

**Failure:**
```json
{
  "ok": false,
  "error": "error_code",
  "message": "Human-readable text for logging or fallback display"
}
```

The frontend never displays `message` to end users directly — it maps `error` to an `i18n` key. `message` exists for developer console visibility and error logging only.

### Fixed error codes

Every failure must use one of these codes. No ad-hoc error strings.

| Code | HTTP-equivalent | When | Frontend behavior |
|---|---|---|---|
| `unauthenticated` | 401 | Token missing, expired, not in Sessions tab, OR session was superseded by a newer login on another device | Force logout, redirect to login, show "logged in elsewhere" message if applicable |
| `forbidden` | 403 | Token valid but user lacks permission for this action | Toast the localized permission error, stay on page |
| `not_found` | 404 | Target row does not exist | Toast "Not found", navigate back |
| `validation_failed` | 400 | Payload missing required fields, wrong types, or business-rule violation (e.g. duplicate national_id) | Show inline field errors from `data.field_errors` |
| `conflict` | 409 | Concurrent-edit collision, or attempting to demote the last super admin | Toast the localized conflict message, refresh the record |
| `rate_limited` | 429 | Too many calls from one session in a short window | Toast "Slow down", disable action briefly |
| `server_error` | 500 | Unhandled Apps Script exception | Toast generic error, log full response to console |

`validation_failed` responses may include a `field_errors` object inside the failure envelope:

```json
{
  "ok": false,
  "error": "validation_failed",
  "message": "Payload validation failed",
  "field_errors": {
    "national_id": "duplicate",
    "hired_date": "invalid_format"
  }
}
```

Field error values are stable codes, not sentences — the frontend maps them to `i18n` keys.

### `js/api.js` contract

`js/api.js` exposes exactly one function to the rest of the app:

```
api.call(action, payload) → Promise<data>
```

Behavior:
- Reads `ohsp_script_url` from `localStorage`; throws if missing (frontend routes user to setup)
- Reads the current session `token` from memory (populated on `login`)
- Sends the POST, parses the response
- On `ok: true` → resolves with `data`
- On `ok: false, error: "unauthenticated"` → clears session, redirects to `#/login`, rejects
- On any other `ok: false` → rejects with an `ApiError` object `{code, message, field_errors?}` that callers can catch
- On network failure → rejects with `{code: "network_error", message: ...}`

Callers never handle the raw response envelope. They either `await api.call(...)` and get `data`, or they catch and inspect `err.code`.

## 3.2 Authentication actions (2)

### `login`

Exchanges username + password hash for a session token.

**Token required:** no.
**Permission:** any active user.

**Payload:**
```json
{
  "username": "khaled",
  "password_hash": "sha256-hex-of-plaintext",
  "device_id": "browser-generated-uuid"
}
```

**Server behavior:**
1. Look up `username` in `Users` tab (case-insensitive match)
2. If not found, or `active = FALSE`, or `password_hash` mismatch → `unauthenticated`
3. **Single-session enforcement:** delete ALL existing rows in `Sessions` for this `user_id`. Any other device using this account is now kicked out (their next call returns `unauthenticated`).
4. Generate UUID token, insert new row in `Sessions` with `expires_at = now + Config.session_expiry_hours`
5. Update `Users.last_login_at`
6. Return session info + `must_change_password` flag if `force_password_change = TRUE`

**Success `data`:**
```json
{
  "token": "uuid-v4",
  "user": {
    "user_id": "USR001",
    "username": "khaled",
    "display_name": "Khaled",
    "role": "super_admin",
    "is_super_admin": true,
    "must_change_password": false
  },
  "permissions": [
    { "module": "employees", "can_view": true, "can_edit": true },
    { "module": "equipment", "can_view": true, "can_edit": true }
  ]
}
```

Super admins receive a synthesized `permissions` array covering every registered module with both flags true — the frontend never special-cases super-admin permission checks.

If `must_change_password` is true, the frontend immediately routes to the change-password screen after login. All other actions except `reset_user_password` (self) and `logout` are blocked by the frontend until password change succeeds. The server does NOT block them — the enforcement is UI-only, since forcing password change is a usability policy, not a security policy (the account is already authenticated).

### `logout`

Deletes the session row. Idempotent.

**Token required:** yes.
**Permission:** any authenticated user (any role).

**Payload:** none (or `{}`).

**Server behavior:** delete the row in `Sessions` where `token` matches. Return `{ok: true, data: {}}` even if the row was already gone.

**Success `data`:** `{}`

## 3.3 Config actions (2)

### `get_config`

Returns the small subset of `Config` values the frontend needs at boot to render the login page (app name, primary language, company name).

**Token required:** no.
**Permission:** anyone.

**Payload:** none.

**Success `data`:**
```json
{
  "app_name": "OHS Platform",
  "company_name": "Landmark",
  "primary_language": "en",
  "session_expiry_hours": 8,
  "max_stale_hours": 72
}
```

The full `Config` tab is only returned via `list_config` (super-admin only, see 3.5).

### `update_config`

Updates one or more Config rows.

**Token required:** yes.
**Permission:** super admin only.

**Payload:**
```json
{
  "updates": {
    "urgent_days": "30",
    "session_expiry_hours": "12"
  }
}
```

All values arrive as strings — Config stores strings. Type coercion happens when values are read by the actions that use them.

**Server behavior:**
1. Check `is_super_admin` → else `forbidden`
2. Reject unknown keys (against a hardcoded allowlist of settable keys) → `validation_failed` with `field_errors`
3. Update each row, stamping `updated_at` and `updated_by`
4. Return the updated Config

**Success `data`:** the same shape as `list_config`.

## 3.4 User and permission actions (6)

All six require super admin. This is the strictest gate in the API.

### `list_users`

**Permission:** super admin only.

**Payload:**
```json
{ "include_inactive": false }
```

**Success `data`:**
```json
{
  "users": [
    {
      "user_id": "USR001",
      "username": "khaled",
      "display_name": "Khaled",
      "role": "super_admin",
      "is_super_admin": true,
      "active": true,
      "force_password_change": false,
      "created_at": "2026-08-01T10:00:00",
      "last_login_at": "2026-08-04T09:15:00",
      "permissions": [
        { "module": "employees", "can_view": true, "can_edit": true }
      ]
    }
  ]
}
```

Password hashes are never returned by any action, ever.

### `create_user`

**Permission:** super admin only.

**Payload:**
```json
{
  "username": "sara",
  "password_hash": "sha256-hex",
  "display_name": "Sara Ahmed",
  "role": "module_admin",
  "active": true,
  "permissions": [
    { "module": "employees", "can_view": true, "can_edit": true },
    { "module": "equipment", "can_view": true, "can_edit": false }
  ]
}
```

**Validation:**
- `username` unique across all users, case-insensitive → else `validation_failed` with `field_errors: {username: "duplicate"}`
- `role` must be `super_admin` | `module_admin` | `officer` → else `validation_failed`
- If `role === "super_admin"` → `is_super_admin` is forced true server-side, `permissions` array ignored (super admins bypass the table)
- If `role === "officer"` → `permissions` array ignored (officers have implicit view-only across all modules)
- If `role === "module_admin"` and `permissions` is empty → allowed but user will see nothing until permissions are granted

**Server behavior:**
1. Generate next `user_id` (`USR###`, zero-padded 3 digits)
2. Insert row in `Users` with `force_password_change = TRUE`, `created_at`, `created_by`
3. Insert rows in `Permissions` for module admins only
4. Return the created user

**Success `data`:** `{ "user": {...same shape as list_users entry...} }`

### `update_user`

**Permission:** super admin only.

**Payload:**
```json
{
  "user_id": "USR002",
  "updates": {
    "display_name": "Sara A.",
    "active": true,
    "role": "module_admin"
  },
  "permissions": [
    { "module": "employees", "can_view": true, "can_edit": true }
  ]
}
```

Any field in `updates` is optional. `permissions` is optional; if omitted, existing permissions are untouched. If present, it fully replaces the user's permission set.

**Validation:**
- `username` cannot be changed (silently ignored if present)
- Cannot demote the last remaining super admin — count active super admins server-side; if this update would leave zero, return `conflict` with `message: "cannot_demote_last_super_admin"`
- Cannot deactivate the last remaining super admin — same check

### `reset_user_password`

Separate from `update_user` because it's a distinct operation with distinct auditing.

**Permission:** super admin only, OR the user themselves changing their own password.

**Payload:**
```json
{
  "user_id": "USR002",
  "new_password_hash": "sha256-hex",
  "current_password_hash": "sha256-hex-of-current"
}
```

`current_password_hash` is required when a user resets their own password. Super admins resetting someone else's password omit it.

**Server behavior:**
1. If super admin resetting another user → update `password_hash`, set `force_password_change = TRUE`
2. If user resetting own → verify `current_password_hash` matches, else `validation_failed`; update `password_hash`, set `force_password_change = FALSE`
3. Invalidate all existing sessions for that user (delete their rows in `Sessions`)
4. Return `{ok: true, data: {}}`

### `deactivate_user`

Distinct from `update_user` because it's the "soft delete" and needs its own permission trail.

**Permission:** super admin only.

**Payload:** `{ "user_id": "USR002" }`

**Server behavior:**
1. Cannot deactivate the last active super admin → `conflict`
2. Set `active = FALSE`, stamp `updated_at`, `updated_by`
3. Delete all rows in `Sessions` for that user
4. Return updated user

### `list_permissions`

Returns the raw `Permissions` tab for the super admin's permissions management UI.

**Permission:** super admin only.

**Payload:** none.

**Success `data`:**
```json
{
  "permissions": [
    { "user_id": "USR002", "module": "employees", "can_view": true, "can_edit": true }
  ]
}
```

Individual permission grants are always mutated through `create_user` / `update_user`, never as a standalone action. There is intentionally no `set_permission` action — it would create a second write path for the same data.

## 3.5 Employee actions (10)

Every employee action checks module permission for `employees`. Super admins bypass. Module admins with `can_view` see; with `can_edit` mutate.

### `list_employees`

**Permission:** `view employees`.

**Payload:**
```json
{
  "team": "field",
  "include_archived": false,
  "search": "ahmed",
  "filters": {
    "subcontractor": "Landmark",
    "title": "Team Leader",
    "worst_state": "expired"
  },
  "page": 1,
  "page_size": 50
}
```

All fields optional. Defaults: `team` = both, `include_archived` = false, `page` = 1, `page_size` = 50 (capped at 200 server-side).

**Server behavior:**
- Filter server-side by team, archived, subcontractor, title
- `search` matches `name` (case-insensitive contains) OR `national_id` (contains)
- `worst_state` filter runs derivation server-side and filters after — this is more expensive but keeps client fast
- Return only the requested page

**Success `data`:**
```json
{
  "employees": [ ...employee objects... ],
  "total_matching": 137,
  "page": 1,
  "page_size": 50
}
```

Each employee object mirrors the Sheet row exactly plus a derived block:
```json
{
  "employee_id": "LM-EMP-0001",
  "national_id": "...",
  "name": "...",
  "team": "field",
  "title": "Team Leader",
  ...
  "derived": {
    "worst_state": "urgent",
    "expired_count": 0,
    "expiring_soon_count": 2,
    "per_cert": { "wah_practical": "valid", "mcu": "urgent", ... }
  }
}
```

The frontend never re-derives what the server has already derived. Compliance derivation logic lives in the Apps Script (Section 6 defines the shared spec), the frontend just displays.

### `get_employee`

**Permission:** `view employees`.

**Payload:** `{ "employee_id": "LM-EMP-0001" }`

**Success `data`:**
```json
{
  "employee": { ...full employee object with derived... },
  "renewal_history": [ ...RenewalHistory rows for this employee, sorted desc by renewed_at... ],
  "rdt_history": [ ...RdtLog rows for this employee, sorted desc by selected_at... ],
  "assigned_equipment": [ ...brief equipment refs: {equipment_id, item, brand, serial_no, verdict}... ]
}
```

`assigned_equipment` is populated by looking up `Equipment` rows where `team_leader_id === employee_id` and running the equipment verdict on each.

### `create_employee`

**Permission:** `edit employees`.

**Payload:** the employee object minus `employee_id`, `created_at`, `created_by`, `updated_at`, `updated_by`, `archived*` fields (all server-set).

**Validation:**
- `national_id` required, must not collide with an existing non-archived employee → else `validation_failed` with `field_errors: {national_id: "duplicate"}`
- `name` required
- `team` must be `field` or `safety`
- Every dropdown field validated against `FieldOptions` — unknown values → `validation_failed`
- Cert dates must be ISO `YYYY-MM-DD` or empty

**Server behavior:**
1. Read `Config.next_employee_number`, generate `employee_id`, increment counter
2. Stamp `created_at`, `created_by`, `updated_at`, `updated_by`
3. Insert row
4. Return the full new employee (with derived)

### `update_employee`

**Permission:** `edit employees`.

**Payload:**
```json
{
  "employee_id": "LM-EMP-0001",
  "updates": { ...any subset of employee fields... }
}
```

**Server behavior:**
1. Load current row → if archived, `conflict` (must unarchive first)
2. `team` cannot change — silently ignored if present
3. For each cert `<key>_expiry` in `updates` where the value differs from the current row → insert a row into `RenewalHistory` with `old_expiry`, `new_expiry`, `renewed_at`, `renewed_by`
4. Apply updates, stamp `updated_at`, `updated_by`
5. Return the full updated employee

### `archive_employee`

**Permission:** `edit employees`.

**Payload:** `{ "employee_id": "...", "reason": "terminated" }` (reason optional, stored in a note).

**Server behavior:** set `archived = TRUE`, `archived_at`, `archived_by`. Does NOT delete assigned equipment — equipment records their `team_leader_id` verbatim and the equipment list will flag "owner archived" as a non-blocking warning.

### `unarchive_employee`

**Permission:** `edit employees`.

**Payload:** `{ "employee_id": "..." }`

**Server behavior:** clear archived fields, stamp updated_at/by. Validates that `national_id` doesn't now collide with another active employee — if so, `conflict`.

### `list_renewal_history`

**Permission:** `view employees`.

**Payload:**
```json
{
  "employee_id": "LM-EMP-0001",
  "cert_key": "mcu"
}
```

Both fields optional. If both omitted, returns entire tab (capped at 500 rows, sorted desc) — used by an audit view.

### `bulk_import_employees`

**Permission:** `edit employees`.

**Payload:**
```json
{
  "rows": [ ...array of employee-shaped objects... ],
  "on_duplicate": "skip" | "overwrite",
  "auto_add_unknown_options": true
}
```

**Server behavior:**
1. Validate every row; return `validation_failed` with a per-row error array if any invalid — nothing is written unless all valid
2. If `auto_add_unknown_options` and a row has an unknown subcontractor/title → add to `FieldOptions` and continue
3. Insert new rows, or update existing ones per `on_duplicate` policy
4. Return `{added: N, updated: N, skipped: N, list_added: {subcontractor: [...], title: [...]}}`

**The `archived` exception.** A row in `rows` may carry `archived: true`, and the employee is then created already archived. This is the only place in the API where a client sets that flag — everywhere else it is server-owned (Section 3.9) and moved solely by `archive_employee` / `unarchive_employee`. It exists because the legacy Landmark workbook has a *Resigned* tab: a roster of people who already left, which would otherwise import as active and have to be archived again by hand, one at a time.

It applies to **creates only**. On an `overwrite` the flag is left exactly as it stands, so re-importing the same workbook can neither bury a rehired employee nor resurrect an archived one. `archived_at` and `archived_by` are still stamped server-side from the clock and the session — the import asserts *that* someone left, never when or by whose hand.

On the frontend this is reached only through a sheet rule: `js/constants/importSpecs.js` maps a *Resigned* / *Terminated* / *Ex-Employees* tab name to `defaults: {archived: 'TRUE'}`, the same mechanism that gives the *Field Team* and *Safety Team* tabs their `team`. That tab carries no team column, so the spec's `derive` hook assigns one from the row's title: a title present in `safety_titles` reads as safety, anything else — including a blank — reads as field.

### `list_rdt_overview`

Everything the RDT dashboard draws, in one call: settings, the current fiscal year, the phase, the eligible pool, this month's quota, this month's selection, yearly progress, and recent activity.

**Permission:** `view employees`.

**Payload:** none.

**Success `data`:**
```json
{
  "enabled": true,
  "settings": {
    "fiscal_year_start_month": 4, "monthly_target_pct": 10, "yearly_target_pct": 120,
    "hire_grace_months": 3, "repeat_months": [2, 3], "safety_title": "Safety Officer"
  },
  "fiscal_year": { "label": "2026-2027", "start_date": "2026-04-01", "end_date": "2027-03-31" },
  "month": { "iso": "2026-08", "is_repeat_phase": false, "quota": 14 },
  "pool": { "size": 137, "mcu_excluded": 6 },
  "progress": {
    "pool_size": 137, "yearly_target": 164, "completed_count": 48,
    "unique_tested_count": 48, "coverage_pct": 35.0, "target_pct": 29.3
  },
  "this_month": [ { ...entry with employee fields joined... } ],
  "recent": [ { ...15 newest entries this fiscal year... } ]
}
```

When RDT is not enabled the response is `{ "enabled": false }` and nothing else — the frontend renders the onboarding card.

Every entry object carries the RdtLog row plus `name`, `team`, and `title` joined from Employees, so the page never makes a second call to render a table.

### `list_rdt_history`

The full fiscal-year log, filtered and paged.

**Permission:** `view employees`.

**Payload:**
```json
{
  "fiscal_year": "2026-2027",
  "month": "2026-08",
  "team": "field",
  "status": "completed",
  "result": "pass",
  "page": 1,
  "page_size": 100
}
```

All fields optional. `fiscal_year` defaults to the current one. Sorted by `selected_at` descending. `page_size` capped at 500.

**Success `data`:** `{ "entries": [...], "total_matching": 212, "page": 1, "page_size": 100 }`

### `generate_rdt_selection`

Runs the monthly random selection and writes the resulting `selected` rows.

**Permission:** `edit employees`.

**Payload:** `{ "regenerate": false }`

**Server behavior:**
1. Reject unless `rdt_enabled` → `validation_failed` with `field_errors: {rdt: "disabled"}`
2. If `regenerate` is true, delete every `selected` row whose `selected_at` falls in the current calendar month. `completed` and `missed` rows are never touched.
3. Recompute the eligible pool *now* — never a pool frozen at the start of the year
4. Exclude anyone already `selected` or `completed` this calendar month
5. Apr–Jan: draw only from employees with no `completed` row this fiscal year. Feb–Mar (`rdt_repeat_months`): draw only from employees who *do* have one.
6. Fisher–Yates shuffle, slice to `round(monthly_target_pct% × pool)`. Never pad past the candidates available.
7. Append one `selected` row per pick, IDs from the highest existing `RDT-######` under a script lock

**Success `data`:** `{ "created": [...entries...], "quota": 14, "pool_size": 137 }`

### `update_rdt_entry`

Every state change to one log row: mark completed, mark missed, revert to selected, or correct a completed entry.

**Permission:** `edit employees`.

**Payload:**
```json
{
  "log_id": "RDT-000042",
  "status": "completed",
  "test_date": "2026-08-11",
  "result": "pass",
  "notes": ""
}
```

`status` is optional — omit it to edit `test_date` / `result` / `notes` in place without changing state.

**Validation:**
- `status = completed` requires a `test_date` and a `result` of `pass` or `fail`
- `status = missed` forces `test_date` and `result` blank; `notes` is the reason
- `status = selected` (revert) clears `test_date` and `result`
- `notes` ≤ 500 chars

### `swap_rdt_selection`

Replaces one selected employee with a random draw from the remaining eligible pool — for someone known in advance to be unavailable.

**Permission:** `edit employees`.

**Payload:** `{ "log_id": "RDT-000042" }`

**Server behavior:** deletes the original row (a swap is "we knew in advance", not "we tried and failed" — that is what `missed` is for), draws one replacement from the pool excluding anyone already selected or completed this month, and appends a new `selected` row for them. The replacement pool respects every eligibility rule including the MCU exclusion.

Returns `conflict` with `message: "no_replacement_available"` when the pool is exhausted. The original row is left intact in that case.

**Success `data`:** `{ "removed_employee_id": "...", "entry": {...the replacement...} }`

### `delete_rdt_entry`

**Permission:** `edit employees`.

**Payload:** `{ "log_id": "RDT-000042" }`

Hard-deletes the row. The documented exception to rule 6 — see the `RdtLog` notes in Section 2. Idempotent: deleting an already-gone row succeeds.

### RDT eligibility — the one rule every action above shares

An employee is in the RDT pool when **all** of these hold:

- `archived === false`
- `employment_status === 'Active'`
- Team is `field` (any title), **or** team is `safety` and `title === rdt_safety_title`
- `hired_date` is set and at least `rdt_hire_grace_months` before today — new hires are covered by their hiring medical
- `cert_mcu_expiry` is set and `>= today`, and the MCU is flagged neither `na` nor `suspended`

That last one is a hard exclusion, not a warning: an expired MCU means the employee is in the medical-renewal window, and the renewal itself includes a drug test. Selecting them for a standalone RDT is redundant work. They re-enter the pool automatically the moment a renewed MCU expiry is recorded. The boundary is `>= today`, matching how `deriveCertState` treats it.

The two flag columns fail the check whatever the date holds. `na` means the employee has no medical on the platform's books; `suspended` means the one on file is void. Either way there is no live medical to reason from — and testing the date alone would let an N/A medical with a stale future date keep somebody in the pool.

The pool is recomputed at the moment of every selection. It is never frozen at the start of the fiscal year — hires crossing the grace period mid-year join it, and archived or resigned employees drop out.

## 3.6 Equipment actions (8)

Same permission model as employees but keyed to the `equipment` module.

### `list_equipment`

**Permission:** `view equipment`.

**Payload:**
```json
{
  "include_rejected": false,
  "search": "SN-12345",
  "filters": {
    "item": "Harness",
    "brand": "3M",
    "subcontractor": "Upper",
    "team_leader_id": "LM-EMP-0001",
    "worst_state": "blocked"
  },
  "page": 1,
  "page_size": 50
}
```

`search` matches `serial_no`, `third_party_sn`, `subcontractor`, or `item` name.

**Success `data`:**
```json
{
  "equipment": [
    {
      "equipment_id": "LM-EQP-0001",
      "item": "Harness",
      "brand": "3M",
      "serial_no": "...",
      "third_party_sn": "...",
      "team_leader_id": "LM-EMP-0001",
      "team_leader_name": "Ahmed Hassan",
      "team_leader_archived": false,
      ...
      "derived": {
        "verdict": "warning",
        "blockers": [],
        "warnings": [ {"type": "third_party_missing"} ]
      }
    }
  ],
  "total_matching": 42,
  "page": 1,
  "page_size": 50
}
```

`team_leader_name` and `team_leader_archived` are joined server-side from Employees for convenience — the frontend never has to do a second call to render the list.

### `get_equipment`

**Permission:** `view equipment`.

**Payload:** `{ "equipment_id": "LM-EQP-0001" }`

**Success `data`:** full equipment object + inspection history + resolved team leader details.

### `create_equipment`

**Permission:** `edit equipment`.

**Payload:** the equipment object minus server-set fields.

**Validation:**
- `item` and `brand` validated against `FieldOptions`
- `serial_no` and `third_party_sn` required, unique across active (non-rejected) equipment
- `team_leader_id` if present must reference an existing employee (archived or not — assignment survives archival)

**Server behavior:** generate `equipment_id` from `Config.next_equipment_number`, stamp, insert. Return full equipment with derived.

### `update_equipment`

**Permission:** `edit equipment`.

**Payload:** `{ "equipment_id": "...", "updates": {...} }`

**Server behavior:** if `third_party_inspection_end_date` changed → insert row into `InspectionHistory`. If `rejected` changes true→false, `conflict` (use `unreject_equipment`). Stamp, return.

### `reject_equipment`

**Permission:** `edit equipment`.

**Payload:**
```json
{
  "equipment_id": "...",
  "rejection_date": "2026-08-01",
  "rejection_reason": "Damaged beyond repair"
}
```

**Server behavior:** set `rejected = TRUE`, `rejection_date`, `rejected_by`, `rejection_reason`. Stamp.

### `unreject_equipment`

**Permission:** `edit equipment`.

**Payload:** `{ "equipment_id": "..." }`

**Server behavior:** clear rejection fields. Validates that `serial_no` and `third_party_sn` don't now collide with another active piece of equipment.

### `list_inspection_history`

**Permission:** `view equipment`.

**Payload:** `{ "equipment_id": "..." }` (optional; omit for full audit view, capped 500)

### `bulk_import_equipment`

Same shape and semantics as `bulk_import_employees`.

## 3.7 FieldOptions and ModuleSettings actions (4)

### `list_field_options`

**Permission:** any authenticated user (dropdowns are needed everywhere).

**Payload:** `{ "list_key": "subcontractors" }` (optional; omit to get all)

**Success `data`:**
```json
{
  "options": {
    "subcontractors": [
      { "option_value": "Landmark", "sort_order": 1, "active": true }
    ],
    "field_titles": [...]
  }
}
```

### `update_field_options`

**Permission:** super admin only. Rationale: dropdown edits touch every module.

**Payload:**
```json
{
  "list_key": "subcontractors",
  "options": [
    { "option_value": "Landmark", "sort_order": 1, "active": true },
    { "option_value": "Upper Telecom", "sort_order": 2, "active": true }
  ]
}
```

Full replacement of the list. Server-side: soft-delete missing values (`active = FALSE`), not hard-delete, so existing employees/equipment referencing removed options still display their value.

### `list_module_settings`

**Permission:** any authenticated admin (view of at least one module).

**Payload:** `{ "module": "employees" }` (optional)

### `update_module_settings`

**Permission:** super admin only.

**Payload:**
```json
{
  "module": "employees",
  "updates": {
    "blocker_certs": "wah_practical,wah_theoretical,mcu"
  }
}
```

## 3.8 Officer actions (3)

Officer sessions use the same `login` action as admins — role is determined server-side from `Users.role`. The Sessions row records the role; officer-only actions check it. Officers cannot call any admin action; admin actions check `role !== 'officer'` at the top or check specific permissions that officers never have.

### `officer_sync`

Returns the full stripped snapshot for offline caching.

**Token required:** yes.
**Permission:** officer role.

**Payload:** none.

**Server behavior:**
1. Load all non-archived employees, non-rejected equipment, `FieldOptions`, thresholds
2. Strip: `comments`, `renewal_history`, `inspection_history`, all `_link` fields, users list
3. Run verdict derivation server-side and include it — the officer app never re-derives (matches admin listings)
4. Stamp `synced_at`

**Success `data`:**
```json
{
  "synced_at": "2026-08-04T10:00:00",
  "max_stale_hours": 72,
  "thresholds": { "urgent_days": 30, "soon_days": 60, "plan_days": 90 },
  "employees": [ ...stripped employee objects with derived... ],
  "equipment": [ ...stripped equipment objects with derived... ],
  "field_options": { ...for display of dropdown values... }
}
```

### `officer_get_employee`

Live single-employee lookup, used only when the officer taps the "Refresh" button on the verdict page. Normal verdict card display uses cached data.

**Token required:** yes.
**Permission:** officer role.

**Payload:** `{ "employee_id": "LM-EMP-0001" }`

**Success `data`:** stripped employee object with derived. Returns `not_found` if archived.

### `officer_get_equipment`

Same shape for equipment. Returns `not_found` if rejected.

## 3.9 Cross-cutting rules

### Timestamping and authorship

Every write action sets `updated_at` and `updated_by` server-side from the session. The client cannot supply these; if present in payload, they are ignored. `created_at` and `created_by` are set once on insert and never overwritten by `update_*` actions.

`renewed_by`, `archived_by`, `rejected_by` follow the same rule — always from the session, never trusted from client.

### ID generation

`employee_id`, `equipment_id`, `user_id` are generated server-side by reading and incrementing the relevant `Config.next_*_number`. This happens inside a `LockService.getScriptLock()` block to prevent duplicate IDs under concurrent requests. Lock timeout: 10 seconds; on timeout return `server_error`.

### Rate limiting

Per session token: max 60 actions per minute, tracked in a `CacheService` bucket. Exceeding returns `rate_limited`. The bucket resets on a rolling window. This is defensive against a runaway frontend loop, not against attackers — admin sessions realistically make 5-10 calls per minute.

### Idempotency

`logout`, `archive_employee`, `unarchive_employee`, `reject_equipment`, `unreject_equipment`, `deactivate_user` are idempotent — calling them twice with the same payload has the same effect as calling once. Create actions are NOT idempotent — a duplicate `create_employee` call will attempt to create a second row and fail on `national_id` uniqueness.

### Session validation

Every action that requires a token performs this sequence at the top, before any action-specific logic:

1. Look up token in `Sessions` → if missing → `unauthenticated`
2. Compare `expires_at` to now → if expired → delete row, return `unauthenticated`
3. Load the current user from `Users` by `user_id` → if `active = FALSE` → delete session, return `unauthenticated`
4. Load fresh permissions from `Permissions` for module admins (super admins skip)
5. Proceed with the action-specific permission check

This is 3-4 Sheet reads per action, cached in-memory for the duration of the request.

### Payload size limits

Apps Script has a 50MB request limit. In practice, the largest actions are `bulk_import_employees` and `bulk_import_equipment`. Cap at 5,000 rows per call — else `validation_failed` with `field_errors: {rows: "too_many"}`. Frontend chunks large imports.

### Unknown action

Any `action` string not in the catalog returns `validation_failed` with `field_errors: {action: "unknown"}`. This is a validation failure rather than 404 because the request itself is malformed.

---

# Section 4 — Session and Auth Model

The rules that govern how users log in, stay logged in, and get kicked out. All enforced server-side in the Apps Script; the frontend follows suit for UX.

## 4.1 The session lifecycle

A session is a row in the `Sessions` tab. It is created by `login`, destroyed by `logout` or by expiry cleanup, and validated at the top of every authenticated action.

```
[login]  →  Sessions row inserted, token returned to frontend
   ↓
[any action with valid token]  →  proceeds
   ↓
[login on another device]  →  ALL rows for this user_id deleted, new row inserted
   ↓
[next action from first device]  →  token no longer in Sessions → unauthenticated
   ↓
[frontend catches unauthenticated → forces logout + redirects to login]
```

The lifecycle is defined by three rules:

**Rule 4.1.a — Fixed 8-hour expiry.** A session is valid for exactly `Config.session_expiry_hours` (default 8) from the moment it was created. No sliding window, no activity-based extension. When the clock hits `expires_at`, the next action from that session returns `unauthenticated` and the row is deleted.

**Rule 4.1.b — Single active session per user.** When a user logs in, all prior `Sessions` rows for that `user_id` are deleted before the new one is inserted. If Khaled logs in on his laptop and then on his phone, the laptop's next call returns `unauthenticated`. This is enforced in the `login` handler, step 3.

**Rule 4.1.c — Force password change on first login.** New users are created with `force_password_change = TRUE`. On their first successful login, the response includes `must_change_password: true`. The frontend routes them straight to the change-password screen. Once they successfully change their password via `reset_user_password` (self), the flag is cleared to FALSE.

## 4.2 Password rules

**Storage.** Passwords are stored as SHA-256 hex strings in `Users.password_hash`. Plain-text passwords never leave the browser, never appear in Apps Script logs, never land in Sheets. The hashing happens in `js/utils/crypto.js` using the browser's built-in `SubtleCrypto.digest('SHA-256', ...)`.

**Minimum length.** 8 characters. Enforced client-side (form validation) and server-side (payload validation). This is a policy, not a security guarantee — SHA-256 without salt is not a strong password store. But since the entire system depends on the developer (Khaled) not sharing the Apps Script or Sheet URL, and there are ~15 users total, this level of hardening is proportionate.

**Reset flows.**
- **Self-reset** (any user): user provides current password + new password. Server verifies current, updates hash, clears `force_password_change`, deletes all their sessions except the current one.
- **Admin reset** (super admin only): super admin sets a new password for another user. Server updates hash, sets `force_password_change = TRUE`, deletes ALL their sessions. Next time they log in, they'll be forced to change it.

**No password recovery.** There is no "forgot password" email flow — the platform has no email integration. If a user forgets their password, the super admin resets it for them via the admin panel.

## 4.3 Login UX flow (frontend)

Full sequence from a fresh device to a working session:

1. User opens the platform URL
2. `js/main.js` boots, reads `localStorage.ohsp_script_url`
   - If missing → show the "First-time setup" screen: text input for the Apps Script URL. Save on submit, reload.
   - If present → proceed
3. Frontend calls `get_config` (no token) → gets app_name, primary_language, session_expiry_hours, max_stale_hours
4. Login screen renders with app_name in the header
5. User enters username + password, submits
6. `js/utils/crypto.js` hashes the password with SHA-256
7. Frontend calls `login` with `{username, password_hash, device_id}`
8. On success: token stored in memory (not localStorage), user info stored in memory, permissions stored in memory. Route to `#/dashboard` (admin) or `#/check/home` (officer).
9. On `must_change_password: true`: route to `#/change-password` instead. All navigation guards block other routes until password is changed.

**Token storage: memory only.** The session token lives in a JavaScript variable in `js/state.js`. It is never persisted to `localStorage`, `sessionStorage`, or IndexedDB. Refresh the page → token is gone → user logs in again. This is a deliberate tradeoff — inconvenient, but eliminates the risk of stolen tokens surviving a browser session and is consistent with the 8-hour fixed expiry rule.

## 4.4 Logout UX flow (frontend)

Two paths:

**Explicit logout (user clicks Sign out):**
1. Frontend calls `logout` with the current token
2. Clears in-memory session state
3. Routes to `#/login`

**Involuntary logout (any action returns `unauthenticated`):**
1. `js/api.js` catches the response, clears in-memory session state
2. Shows a toast: "Your session has ended. Please log in again."
3. Routes to `#/login`

The involuntary flow covers all three ejection causes: token expired, deactivated by super admin, or superseded by a login on another device. The frontend does not distinguish between them — all three surface as `unauthenticated`.

## 4.5 What happens on browser refresh

Refresh clears in-memory state. The user must log in again. This is by design and matches the "token in memory only" rule. The tradeoff:

- **Pro:** No stolen-token risk. No stale session state. Simple mental model.
- **Con:** Refresh mid-work means logging in again.

Given admin sessions are 8 hours and admin work happens in focused blocks, this is acceptable. If it becomes annoying in practice, we can revisit by moving the token to `sessionStorage` (survives refresh but not tab close) — but this is not v1.

## 4.6 What officers experience

Officers use the same login flow but land on the mobile shell (`#/check/home`) instead of the admin dashboard. Officer sessions follow the same 8-hour expiry — but with a critical difference: the officer app can display cached data even when the session has expired, as long as the cache itself is fresh (see Section 7). The verdict card works offline. Only the "Refresh" button and future writes require an active session.

If an officer's session expires while offline, the next time they get signal and tap Refresh, the request returns `unauthenticated` and they're routed to login. Their cached snapshot survives the login (it's in IndexedDB, separate from the session token). After re-login, cache continues to work as before.

## 4.7 Nightly session cleanup

A scheduled Apps Script trigger runs once per day, at 03:00 UTC. It deletes all rows in `Sessions` where `expires_at < now()`. This is housekeeping — expired sessions are already rejected on read, but the tab would grow unboundedly without cleanup.

---

# Section 5 — Module System

The module system is the seam that lets us add new safety domains (vehicles, ladders, whatever) without touching the shell, the router, or existing modules.

## 5.1 Anatomy of a module

Every module lives in one folder: `js/modules/<name>/`. Each folder contains everything that module needs and nothing another module needs.

```
js/modules/employees/
├── manifest.js          # Registers this module with the shell
├── pages/
│   ├── listPage.js       # Field/Safety list, RDT, renewals, resigned
│   ├── detailPage.js
│   ├── formPage.js
│   └── ...
├── dataActions.js        # Calls api.call() for this module's actions
├── verdict.js            # deriveSiteCheckVerdict() — shared with officer app
├── compliance.js         # deriveCertState(), deriveEmployeeCompliance()
├── constants.js          # CERT_KEYS, BLOCKER_CERTS, etc.
└── i18n.js               # Module-specific i18n keys, merged into global on boot
```

A module never imports from another module's folder. If two modules need the same helper (a date formatter, a verdict badge component), that helper lives in `js/utils/` or `js/components/` — shared ground.

## 5.2 The manifest

Every module has a `manifest.js` that exports a `manifest` object. This is how the shell discovers what the module contributes.

```js
// js/modules/employees/manifest.js
export const manifest = {
  name: 'employees',
  displayNameKey: 'module_employees',   // i18n key
  group: 'EMPLOYEES',                    // sidebar section header
  icon: 'people',                        // icon name from the shared icon set

  // Routes this module owns
  routes: [
    { path: 'field',              page: renderFieldListPage },
    { path: 'safety',             page: renderSafetyListPage },
    { path: 'renewals',           page: renderRenewalsPage },
    { path: 'rdt',                page: renderRdtPage },
    { path: 'resigned',           page: renderResignedPage },
    { path: 'employee/:id',       page: renderEmployeeDetailPage },
    { path: 'employee/:id/edit',  page: renderEmployeeFormPage },
    { path: 'employee/new/:team', page: renderEmployeeFormPage },
  ],

  // Sidebar entries (filtered by permissions at render time)
  sidebar: [
    { labelKey: 'nav_field_team',   route: 'field'    },
    { labelKey: 'nav_safety_team',  route: 'safety'   },
    { labelKey: 'nav_renewals',     route: 'renewals' },
    { labelKey: 'nav_rdt',          route: 'rdt'      },
    { labelKey: 'nav_resigned',     route: 'resigned' },
  ],

  // Dashboard contributions
  dashboard: {
    kpis: renderEmployeeKpis,             // returns HTML for KPI row
    charts: renderEmployeeCharts,         // returns HTML for chart row
  },

  // Officer app contributions
  officer: {
    searchEntities: (query, snapshot) => [...matching entities...],
    renderVerdictCard: (entityId, snapshot) => htmlString,
    entityKind: 'employee',                // used in officer routes: #/check/employee/:id
  },
};
```

## 5.3 Registration and boot

At boot, `js/main.js` imports every module's manifest and registers them with the shell:

```js
import { manifest as employeesManifest } from './modules/employees/manifest.js';
import { manifest as equipmentManifest } from './modules/equipment/manifest.js';

const modules = [employeesManifest, equipmentManifest];
// registerModules(modules)  builds the sidebar tree, router table, dashboard composition, officer search
```

**To add a new module** (e.g. vehicles), the developer creates `js/modules/vehicles/` with its manifest, adds one line to `main.js` to import it, and the entire shell adapts: sidebar shows the new group, router handles new routes, dashboard shows new KPIs (if the user has view permission), officer app searches new entities. Nothing else changes.

## 5.4 The sidebar and permission filtering

The sidebar is built from module manifests. At render time, each item is filtered against the current user's permissions:

- Super admin sees all groups, all items
- Module admin with `view` on `employees` sees the EMPLOYEES group with all its items; other groups are hidden
- Module admin with `view` on `equipment` but not `employees` sees only EQUIPMENT
- A group with zero visible items is hidden entirely (no empty section headers)

The Dashboard and Settings entries are not part of any module's sidebar — they're rendered by the shell itself, always visible to any authenticated admin. Settings has its own internal permission checks (Users tab super-admin only, etc.).

## 5.5 The dashboard and permission filtering

The Dashboard aggregates contributions from every module. Each module's `dashboard.kpis` and `dashboard.charts` render only if the current user has `view` permission for that module.

Super admin sees the full stack: employee KPIs + employee charts, then equipment KPIs + equipment charts, then any future module. Module admins see only the sections for modules they can view.

**Employee dashboard composition:**
- **KPIs** (row of 4 cards): Total Active (split field/safety), Certs Expired, Expiring in ≤30 days, Compliant. Note: these mix units on purpose — "Certs Expired" counts *certificates*, the others count *employees*. They don't sum to headcount and aren't meant to.
- **Charts** (row of 3):
  - *Expiries in Next 30 Days by Certificate* — horizontal bar chart. The window is 30 days (`urgent_days`), matching the KPI directly above it, not 90.
  - *Headcount by Subcontractor* — horizontal bars.
  - *RDT Coverage* card — big headline coverage % (unique eligible employees with a `completed` RdtLog row this fiscal year ÷ eligible pool) with a target-progress bar toward the yearly 120% goal. Shows an "RDT tracking is off" state when `rdt_enabled` is not set. Replaces the older "Compliance State" donut, which was removed.
- **Recently Updated** — small list of the 6 most recently modified employees.

**Equipment dashboard composition:**
- **KPIs** (row of 4): Total Active Equipment, Inspections Expired, Expiring in ≤30 days, Rejected This Month.
- **Charts** (row of 2): Inspections Expiring in Next 30 Days by Item Type, Equipment Compliance donut.

## 5.6 The officer app and modules

Officers see a single unified interface. When they search, every module's `officer.searchEntities` is called with the query, and the results are merged, sorted, and shown as a single list. Tapping a result routes to `#/check/{entityKind}/{entityId}`, which invokes that module's `officer.renderVerdictCard`.

This means adding vehicles to the officer app is one line in the vehicles manifest — the shell handles everything else.

## 5.7 Module isolation rules

These are non-negotiable to keep modules composable:

1. **A module never imports from another module's folder.** If module A needs something from module B, that something moves to `js/utils/` or `js/components/`.
2. **A module's `dataActions.js` calls `api.call()` — nothing else.** No direct fetches. No shared data state across modules.
3. **A module's verdict logic is local to that module.** Employees have `js/modules/employees/verdict.js`. Equipment has `js/modules/equipment/verdict.js`. They share no code.
4. **A module can add i18n keys** but must not overwrite existing keys. Key collision at boot is a hard error.
5. **Modules cannot add new tabs to the Sheet.** Schema changes go through the developer (Khaled). If a module needs a new tab, Section 2 gets updated first.

---

# Section 6 — Compliance and Verdict Logic

The rules that turn dates and flags into badges and colors. Every rule here is enforced server-side in Apps Script and returned pre-derived to the frontend (see Section 3.5, the `derived` block). The frontend never re-derives — it just displays.

## 6.1 Certificate compliance states

Every certificate is classified into one of seven states based on today's date, two thresholds from `Config`, two admin flag columns on the row, and one cross-cert rule:

| State | Condition | Color |
|---|---|---|
| `na` | `cert_<key>_na` is TRUE | Slate |
| `suspended` | `cert_<key>_suspended` is TRUE, **or** the certificate is a WAH cert (`wah_practical` / `wah_theoretical`) and the employee's `mcu` is `expired`. Applied regardless of the cert's own expiry date. | Yellow |
| `missing` | expiry_date is empty | Gray |
| `expired` | expiry_date < today | Red |
| `urgent` | expiry_date within `urgent_days` (default 30) | Orange |
| `soon` | expiry_date within `soon_days` (default 60) | Amber |
| `valid` | expiry_date beyond `soon_days` | Green |

**State ranking (worst wins):** `suspended > expired > urgent > soon > missing > valid`. `na` is outside the ladder entirely — it is skipped by the worst-state roll-up and by `expired_count` / `expiring_soon_count`, so it can never be the worst thing about an employee and never appears as a `worst_state` filter value.

**Flag precedence.** The two flags outrank the date, and `na` outranks `suspended`. A certificate that is not required cannot be suspended, so a row with both flags ticked derives to `na`. The form disables the suspended box while N/A is ticked, but the decision is made server-side — the client is never the gate (rule 5).

**The `na` rule.** N/A means the admin has decided this certificate does not apply to this employee. It is recorded in `per_cert` so the UI can show the badge, and it takes part in nothing else: no aggregate, no blocker, no warning. This is what distinguishes it from `missing`, which means "should be recorded, isn't". Both read as "N/A" in the officer app (Section 7.5) because from the field the distinction has no consequence; both keep their own colour on admin screens because to the admin it is the whole difference.

**The manual `suspended` flag.** A cert the admin has suspended is void the same way an expired one is, and it carries the *tier of its certificate*, not of the state: on a blocker cert it blocks, on a warning cert it warns. Its reason is `reason_cert_suspended`, distinct from the MCU cascade's `reason_wah_suspended` — both produce the same state and the same badge, but they tell the team leader to do different things.

**Two-tier notification ladder.** There is no 90-day tier. Anything more than `soon_days` (60) out is `valid` and shows green. This is a deliberate simplification: the earlier OHS-DB "plan" tier at 90 days added noise without action value.

**The MCU cascade.** The medical checkup (MCU) is a prerequisite for working at heights. When MCU is expired, both WAH certs are considered void until MCU is renewed — even if the WAH cert's own date is still in the future. The `suspended` state expresses this. It is a per-cert state (not just an aggregate flag) so it shows up correctly in the cert list wherever WAH is rendered.

The cascade triggers on `mcu === expired` and nothing else. An MCU flagged `na` or manually suspended does not cascade — a suspended MCU is already a blocker in its own right, and whether it should also void WAH is a policy question for Khaled, not a mechanical consequence. A WAH cert that is `missing` or `na` is never suspended by the cascade; there is nothing to suspend. A WAH cert the admin suspended manually keeps its own reason when the cascade also applies.

This scheme is derived once per read in Apps Script and returned inside `derived.per_cert` and `derived.worst_state`.

## 6.2 Employee verdict — same rules as OHS-DB

The employee site-check verdict returns one of three verdicts: `cleared`, `warning`, or `blocked`. Rules:

### Blockers (any one present → `blocked`)

- `employment_status !== 'Active'` (Suspended, Terminated, Resigned)
- `archived === true`
- `legal_permission !== 'Approved'`
- `cert_wah_practical` state is `expired` OR `suspended`
- `cert_wah_theoretical` state is `expired` OR `suspended`
- `cert_mcu` state is `expired`

Note: because expired MCU triggers the `suspended` state on both WAH certs (Section 6.1), an expired MCU cascades into three blockers — the MCU itself, and both WAH certs as suspended. This is intentional: the officer's reasons list explicitly names each affected cert so the admin knows what needs renewing (usually just the MCU, which unblocks the WAH pair).

### Warnings (present if no blockers → `warning`; ignored if already blocked)

- Any blocker certificate (`wah_practical`, `wah_theoretical`, `mcu`) is `urgent` (within 30 days)
- `cert_fa`, `cert_ff`, `cert_ra`, or `cert_ec` is `expired`, `urgent`, or `suspended`

### Otherwise → `cleared`

`missing` (no expiry date) is never a blocker or a warning — it's just missing data. The admin sees "Missing" in the cert list; the officer sees "N/A" (Section 7.5). Neither produces a reasons-list entry.

`na` is never a blocker or a warning either, and for a stronger reason: it is a decision, not an absence. It takes no part in the verdict at all. There is no explicit skip in the code for this — a cert flagged N/A derives to state `na`, which matches none of the tests above, and that is the whole of the rule.

The list of blocker certs and warning certs lives in `ModuleSettings` (rows `employees.blocker_certs` and `employees.warning_certs`), so it can be adjusted later without a code change. Default values match the behavior above.

The WAH-suspended-when-MCU-expired rule is hardcoded in `Compliance.gs` — it's not a configurable list. The relationship between medical prerequisite and WAH qualification is a domain rule, not a tunable threshold.

## 6.3 Equipment verdict

Equipment verdict follows the same three-value structure (`cleared` / `warning` / `blocked`) with different rules.

### Blockers (any one present → `blocked`)

- `rejected === true`
- `third_party_inspection_end_date` is set AND < today (expired)
- The most recent completed wave has `result === 'fail'`. "Most recent completed wave" = the wave with the latest non-empty `wave_N_date` where `wave_N_result` is set.

### Warnings (present if no blockers → `warning`)

- `third_party_inspection_end_date` is empty (no proof of inspection yet) — treated as warning, not blocker. This is Khaled's Q5 decision: missing data is not the same as failed, but it isn't safe to fully clear either.
- `third_party_inspection_end_date` is within 30 days of today (`urgent_days` threshold)
- `team_leader_id` references an employee who is archived — non-blocking "owner archived, needs reassignment" warning

### Otherwise → `cleared`

Note: **overdue internal waves are not a warning trigger** (Q6 answer). The 30-day third-party threshold is the only expiry warning for equipment. If the operations team later wants "wave 2 overdue" warnings, we add it via `ModuleSettings` without breaking the verdict shape.

## 6.4 The `derived` block

For both employees and equipment, every `list_*` and `get_*` action returns a `derived` block alongside the raw row. Its shape:

**Employee `derived`:**
```json
{
  "worst_state": "suspended",         // one of: suspended, expired, urgent, soon, missing, valid — never `na`
  "expired_count": 1,                 // count of certs in 'expired' state
  "expiring_soon_count": 0,           // count in urgent + soon
  "per_cert": {
    "wah_practical": "suspended",     // both WAH certs go suspended when mcu is expired
    "wah_theoretical": "suspended",
    "mcu": "expired",
    ...
  },
  "verdict": "blocked",               // cleared | warning | blocked
  "blockers": [
    { "type": "cert_expired", "text_key": "reason_expired", "text_params": { "cert": "mcu", "days": 5 } },
    { "type": "wah_suspended", "text_key": "reason_wah_suspended", "text_params": { "cert": "wah_practical" } },
    { "type": "wah_suspended", "text_key": "reason_wah_suspended", "text_params": { "cert": "wah_theoretical" } }
  ],
  "warnings": []
}
```

**Equipment `derived`:**
```json
{
  "third_party_state": "urgent",
  "verdict": "warning",
  "blockers": [],
  "warnings": [
    { "type": "third_party_expiring", "text_key": "reason_third_party_expiring", "text_params": { "days": 15 } }
  ]
}
```

`text_key` + `text_params` is the shape the frontend uses to render human-readable reasons — it passes them straight to `t(text_key, text_params)`. This keeps all translations in the frontend i18n files.

## 6.5 Server-side derivation module

The Apps Script has a single `Compliance.gs` file that exposes:

- `deriveCertState(dateStr, today, thresholds)` → one of `missing` / `expired` / `urgent` / `soon` / `valid`. Date only — it knows nothing about the flag columns, which is what lets equipment reuse it for `third_party_inspection_end_date`. `na` and `suspended` are applied on top by `deriveEmployeeDerived`.
- `deriveEmployeeDerived(employeeRow, today, thresholds, moduleSettings)` → the employee derived block
- `deriveEquipmentDerived(equipmentRow, today, thresholds, moduleSettings, employeesById)` → the equipment derived block

Every `list_*` and `get_*` action calls the relevant function once per row before returning. Thresholds and moduleSettings are loaded once per request and reused. This is O(rows) but each derivation is a handful of comparisons — fine for lists up to a few thousand employees.

## 6.6 Why derive server-side

OHS-DB derives client-side because there is no server. OHS Platform has a server, and it's the natural place to derive because:

1. **Single source of truth.** Admin dashboard, admin lists, officer app, exports — all consume the same derived block. No risk of drift between "what the admin saw" and "what the officer saw".
2. **Cleaner frontend.** Modules don't need to import compliance code into every view.
3. **Cheaper repeat views.** Once derived, the block is reused across the response cycle.
4. **Simpler officer app.** The mobile app receives verdicts pre-computed. Nothing to derive on a phone at a tower site.

The tradeoff is that a change to threshold values (via `update_config`) doesn't take effect on existing lists until the frontend re-fetches. This is acceptable because thresholds change rarely (once a policy update), and the frontend re-fetches on every navigation.

---

# Section 7 — Officer App

The mobile PWA the field officers use at tower sites. Same URL as the admin app, different shell rendered based on role.

## 7.1 High-level behavior

- Same GitHub Pages URL as the admin app. Officer sees a mobile shell; admin sees a desktop shell. The role determines the shell, not the URL.
- Read-only in v1. No writes to Sheets from an officer session under any circumstance.
- Cache-first for verdict lookups (Q7 answer). The officer taps an entity, sees the cached verdict instantly, no network call. A manual "Refresh" button on the verdict page fetches fresh from server.
- Fail-closed lockout when cache is stale beyond `max_stale_hours` (default 72). No override, no supervisor bypass (Q8 answer).
- Officers never see users, passwords, comments, renewal history, inspection history, or file links. All stripped server-side.

## 7.2 Session model

Officers log in the same way admins do (`login` action). Their session obeys the same 8-hour expiry and single-session rules. Key differences from admin sessions:

- **Cached data survives session expiry.** The IndexedDB snapshot (`ohsp-officer` DB, `snapshot` key) is independent of the session token. If the session expires while the officer is offline, the verdict card still works from cache. Only the Refresh button requires an active session.
- **Session token persists across app open/close** as long as it's not expired — stored in `sessionStorage` for officer apps only. Officers keep their phone in their pocket between lookups and shouldn't have to log in constantly. On explicit sign-out, `sessionStorage` is cleared.

(This is a deliberate exception to the "token in memory only" rule from Section 4.5. Justified by the mobile-worker use case and mitigated by the read-only nature of officer sessions — a stolen phone with a valid token can only read data, never modify it.)

## 7.3 Cache model

Two things live in IndexedDB (database `ohsp-officer`, store `kv`):

| Key | Value |
|---|---|
| `snapshot` | The full stripped snapshot from `officer_sync` |
| `synced_at` | ISO timestamp of the last successful sync |

The Apps Script URL lives in `localStorage` as `ohsp_script_url` (same as admin) — it's a device-level config, not a per-user piece of data.

## 7.4 Cache freshness and lockout

On every page render, `js/modules/officer/staleCheck.js` compares `synced_at` against `max_stale_hours` (from the last snapshot's meta). Three states:

| Cache age | Behavior |
|---|---|
| ≤ `max_stale_hours` | Normal. Verdict lookups work from cache. |
| Beyond `max_stale_hours` | Locked. All routes except `#/check/sync` redirect to a lockout screen. |
| No cache at all | Login required, then immediate sync required. |

The lockout screen tells the officer they need to sync. It has one action: "Sync now". Tapping it triggers `officer_sync`. If it fails (no signal, expired session, server error), the officer stays locked. There is no bypass.

**Field procedure:** Officers must ensure they've synced before going to a remote site. The 72-hour default gives 3 days of buffer for weekend work + one day of travel. If they hit a lockout in the field, the answer is to leave the site or call a colleague — never override.

## 7.5 The verdict flow (the entire product for officers)

The officer's workflow is: log in → search → tap → read the verdict → done.

**Home screen (`#/check/home`):**
- Header: officer's display name, sign-out icon
- Sync strip: "Data as of X · Nd" + Sync button
- Search input, single field
- Below: "Recent" section listing the last 5 entities the officer looked up in this session (memory only, cleared on sign-out)
- As the officer types, live filter across all modules' entities (employees + equipment + future) using each module's `officer.searchEntities`

**Verdict page (`#/check/{entityKind}/{id}`):**
- Route based on entity kind. `#/check/employee/LM-EMP-0001` → employee verdict card. `#/check/equipment/LM-EQP-0001` → equipment verdict card.
- Uses the module's `officer.renderVerdictCard`.
- Layout: color-coded hero (green/amber/red) with big verdict icon and label, then entity identity block (name, ID, team, title, etc.), then "Issues found" section (blockers red-bordered, warnings amber-bordered), then "All certificates" list with per-cert state badges.
- Back button top-inline-start (returns to search).
- **Refresh button** top-inline-end. Tapping it calls `officer_get_employee` (or `officer_get_equipment`) live from server. If successful, updates the display and updates the cache entry for this specific entity. If it fails, shows a toast ("Couldn't refresh — showing cached data") and stays on the cached view.

**Officer cert display rule — `missing` and `na` both shown as N/A.** In the officer's "All certificates" list, a per-cert state of `missing` is displayed with an "N/A" badge and a "—" date line, instead of "Missing". This is a display-only mapping in the officer verdict card renderer — the underlying derived state stays `missing`, only the label changes. A cert flagged `na` collapses into the same line, keeping its own badge colour. All other states (`suspended`, `expired`, `urgent`, `soon`, `valid`) are displayed the same way for officer and admin. Rationale: from the field, "no date recorded" and "not applicable" are the same "no valid record" outcome; the distinction only matters to the admin who maintains the data.

A `suspended` cert always shows its own badge and date line even with no expiry on file — the reasons list above it already names it as an issue, and an "N/A" line under a blocked verdict reads as a contradiction.

**Sync page (`#/check/sync`):**
- Reachable from the sync strip and from the lockout screen.
- Shows "Last synced X" and a big Sync button.
- Tapping Sync calls `officer_sync`, replaces the cached snapshot, updates `synced_at`, shows a success toast, routes back to home.

## 7.6 What's stripped from the officer snapshot

The Apps Script `officer_sync` handler strips these before returning:

- **All password_hash values** (also not returned by any action anyway)
- **The entire `users` list** — officers don't need to know who else has an account
- **All `_link` fields on certificates and equipment** — file URLs are irrelevant at a tower site
- **`comments` field on equipment** — admin notes not intended for officers
- **All history tabs** — RenewalHistory, InspectionHistory, RdtLog not returned. Officers never see any RDT data at all: not the log, not the settings, not a "last tested" date. RDT is HR compliance paperwork, and it has no bearing on whether someone may work today.
- **`created_by`, `updated_by`, `archived_by`, `rejected_by`** — audit trail hidden from officers
- **All ModuleSettings that aren't display-relevant** — verdict is pre-derived, so officers don't need to see the rules

What officers DO see:
- All non-archived employees with their identity fields, cert dates (no links), qualification flags, drug test dates, and the `derived` block
- All non-rejected equipment with identity fields, serial numbers, inspection dates (no links, no comments), waves, and the `derived` block
- Field options for displaying dropdowns
- Thresholds (so date states are internally consistent if a rare re-render happens)

## 7.7 Sign out

Explicit sign-out clears:
- `sessionStorage` (the session token)
- IndexedDB `ohsp-officer` (snapshot + synced_at)
- In-memory Recent list

The officer must fully re-authenticate and re-sync to use the app again. This mirrors how a shared work phone would be handed over — sign out fully wipes the last officer's presence.

Involuntary sign-out (session expired, or `unauthenticated` from any action) does NOT clear the cache. The verdict card continues to work from cache until stale. Only sign-out and manual "Clear data" (future feature, not v1) wipe the cache.

---

# Section 8 — i18n, RTL, and Design System

Ported almost verbatim from OHS-DB, with the changes noted below. The visual identity of OHS Platform is deliberately identical to OHS-DB — same navy sidebar, same four accent colors, same badges, same typography. Officers who used OHS-DB will feel at home.

## 8.1 i18n rules

- Two languages: English (`en`, LTR) and Arabic (`ar`, RTL).
- All UI text passes through `t('key', params)` in `js/i18n/i18n.js`. Never hardcode a string in a JS template literal.
- Every key in `js/i18n/en.js` must exist in `js/i18n/ar.js`. Missing key at boot is a warning (in dev tools), fallback is the key itself.
- Module-specific keys live in `js/modules/<name>/i18n.js` and are merged into the global i18n object at boot. Key collision between global and module i18n is a boot-time hard error.
- Default language on a fresh device: `en` (Q10 answer). Configurable via `Config.primary_language`.
- Language preference is per-device, stored in `localStorage.ohsp_lang`.
- Date format: `DD MMM YYYY` in both languages, Gregorian, via `Intl.DateTimeFormat`.

**Parameterized strings** use `{name}` placeholders. Example: `reason_expiring = "{cert} expires in {days} days"`. Passed as `t('reason_expiring', {cert: 'MCU', days: 12})`.

## 8.2 RTL rules

When language switches to Arabic:
- `document.documentElement.dir = 'rtl'`
- `document.documentElement.lang = 'ar'`
- Layout auto-flips because ALL CSS uses logical properties (`margin-inline-start`, `padding-inline-end`, `border-inline-start`, `inset-inline-start`, `text-align: start`). Never `margin-left`, `padding-right`, etc.
- Flex containers use `flex-direction: row` — never `row-reverse`. The browser handles the visual flip via `dir="rtl"`.

## 8.3 Design tokens

Same as OHS-DB. Full `:root` block below. `css/tokens.css` is the single source of truth for colors, spacing, radii, shadows.

```css
:root {
  --bg: #f5f6fa;
  --card: #ffffff;
  --border: #e2e4ed;
  --text: #1a1d2e;
  --text2: #4a4f6a;
  --muted: #9095b0;
  --primary: #3d5af1;
  --primary-dark: #2d47d4;
  --primary-soft: #3d5af11f;
  --success: #16a34a;
  --warning: #d97706;
  --danger: #e05252;
  --purple: #7c3aed;
  --teal: #0d9488;

  --cleared:      #16a34a;  --cleared-bg:   #dcfce7;  --cleared-dark: #15803d;
  --warn:         #d97706;  --warn-bg:      #fef3c7;  --warn-dark:    #b45309;
  --blocked:      #dc2626;  --blocked-bg:   #fee2e2;  --blocked-dark: #991b1b;
  --urgent-bg:    #ffe4e6;  --urgent-tx:    #9f1239;
  --missing-bg:   #f3f4f6;  --missing-tx:   #6b7280;
  --suspended-bg: #fef08a;  --suspended-tx: #713f12;
  /* --plan-bg / --plan-tx kept available for non-compliance uses (e.g. RDT phase badges).
     No cert state currently maps to them. */
  --plan-bg:      #fef9c3;  --plan-tx:      #854d0e;

  --radius-card: 14px;
  --radius-control: 8px;
  --radius-mobile: 10px;
  --shadow-sm: 0 1px 2px rgba(16, 24, 64, 0.05);
  --shadow-md: 0 4px 14px rgba(16, 24, 64, 0.08);
  --font-base: 'Segoe UI', system-ui, -apple-system, sans-serif;

  --navy: #0f1942;
  --navy-soft: #16215a;
  --navy-border: #232c63;
  --navy-text: #aab2d8;
  --navy-text-strong: #ffffff;
  --navy-muted: #6b74a8;

  --theme-color-blue: #3d5af1;
  --theme-color-teal: #0d9488;
  --theme-color-purple: #7c3aed;
  --theme-color-crimson: #be123c;
}

[data-theme="blue"]    { --primary: #3d5af1; --primary-dark: #2d47d4; --primary-soft: #3d5af11f; }
[data-theme="teal"]    { --primary: #0d9488; --primary-dark: #0b7a70; --primary-soft: #0d94881f; }
[data-theme="purple"]  { --primary: #7c3aed; --primary-dark: #6425c9; --primary-soft: #7c3aed1f; }
[data-theme="crimson"] { --primary: #be123c; --primary-dark: #9f0f32; --primary-soft: #be123c1f; }
```

Four accent themes: blue (default), teal, purple, crimson. The navy sidebar/header never changes color — only buttons, active nav borders, badges, and chart accents follow the selected theme.

## 8.4 Component reference (identical to OHS-DB)

Same button variants (`.btn-primary`, `.btn-ghost`, `.btn-danger`, `.btn-lg`), same card styling, same badge shapes, same modal/toast patterns, same verdict hero card, same employee overlap card, same sync strip. If a component exists in OHS-DB, port it as-is.

## 8.5 Sidebar structure

```
Dashboard  (ungrouped)

EMPLOYEES
  Field Team
  Safety Team
  Renewals
  RDT              → #/rdt, with the full log at #/rdt/history
  Resigned & Terminated

EQUIPMENT
  Active Equipment
  Rejected Equipment

SYSTEM
  Export
  Settings
```

- Always-visible uppercase group headers, no collapse behavior
- Sidebar filters items by user's view permissions; entire groups hidden when the user has no view access to any item in them
- Future modules (cars-tracking, ladders, etc.) insert as their own groups between EQUIPMENT and SYSTEM

## 8.6 Officer shell

Same as OHS-DB's officer mobile shell. Navy header, sync strip, phone-frame body. No sidebar, no admin actions. Verdict card design ported directly.

---

# Section 9 — File Map, Naming Conventions, What NOT to Do

## 9.1 File map

Entire project as loaded directly by the browser. No `node_modules`, no `package.json`, no bundler config.

```
ohs-platform/
├── CLAUDE.md                        ← you are here
├── BUILD.md                         ← step-by-step build guide
├── design/
│   ├── admin_prototype.html         # Approved desktop admin visual reference
│   └── officer_prototype.html       # Approved mobile officer visual reference
├── apps-script/
│   ├── Main.gs                      # doPost dispatcher
│   ├── Auth.gs                      # login, logout, session validation
│   ├── Users.gs                     # user + permission actions
│   ├── Employees.gs                 # employee actions
│   ├── Rdt.gs                       # RDT selection algorithm + the six RDT actions
│   ├── Equipment.gs                 # equipment actions
│   ├── FieldOptions.gs              # field options + module settings actions
│   ├── Officer.gs                   # officer sync + entity fetches
│   ├── Compliance.gs                # deriveCertState, deriveEmployeeDerived, deriveEquipmentDerived
│   ├── Config.gs                    # get_config, update_config, list_config
│   ├── Sheets.gs                    # low-level sheet read/write helpers
│   ├── Utils.gs                     # ID generation, validation helpers, timestamping
│   └── Trigger.gs                   # nightly session cleanup trigger
│
├── index.html                       # Single HTML entry point
│                                    # Loads css/*.css, then js/main.js as module,
│                                    # plus CDN scripts for SheetJS + jsPDF
│
├── css/
│   ├── tokens.css                   # CSS custom properties (see Section 8.3)
│   ├── base.css                     # Resets, typography, RTL base rules
│   ├── layout.css                   # Sidebar, topbar, content, phone shell
│   ├── components.css               # Buttons, inputs, cards, badges, modal, toast
│   └── pages.css                    # Page-specific layout
│
├── js/
│   ├── main.js                      # Boot: import manifests, register modules, initRouter, render
│   ├── state.js                     # In-memory session token, current user, permissions, UI state
│   ├── router.js                    # go(route, param), initRouter, route table built from manifests
│   ├── render.js                    # Top-level render: shell (admin vs officer) + current page
│   ├── api.js                       # api.call(action, payload) — the ONLY caller of Apps Script
│   │
│   ├── i18n/
│   │   ├── en.js                    # Global English keys
│   │   ├── ar.js                    # Global Arabic keys
│   │   └── i18n.js                  # t(key, params), setLanguage(lang), getLanguage()
│   │
│   ├── modules/
│   │   ├── employees/               # Employee module (see Section 5.1)
│   │   ├── equipment/               # Equipment module
│   │   └── officer/                 # Officer app module (search router, sync page, staleness check)
│   │
│   ├── shell/
│   │   ├── sidebar.js               # Renders sidebar from registered manifests + permissions
│   │   ├── topbar.js                # Renders topbar (admin shell only)
│   │   ├── loginPage.js             # Login + change-password screens
│   │   ├── dashboardPage.js         # Aggregates module dashboard contributions
│   │   ├── settingsPage.js          # Users tab, Lists tab, Thresholds tab, Data tab
│   │   ├── exportPage.js            # Multi-module export UI
│   │   └── officerShell.js          # Phone frame, header, sync strip
│   │
│   ├── components/
│   │   ├── badge.js                 # State + verdict + status badges
│   │   ├── modal.js                 # Modal helpers
│   │   ├── toast.js                 # Toast notifications
│   │   └── themeSwatches.js         # Four-swatch theme picker
│   │
│   ├── utils/
│   │   ├── crypto.js                # SHA-256 password hashing
│   │   ├── format.js                # fmtDate, escapeHtml, daysUntil, todayISO
│   │   ├── theme.js                 # THEMES, getTheme, setTheme
│   │   ├── permissions.js           # canView(module), canEdit(module), canAccessRoute(route)
│   │   ├── excelImport.js           # Shared Excel parsing helpers
│   │   ├── exportHelpers.js         # Shared Excel/PDF export helpers
│   │   └── pwa.js                   # registerServiceWorker() — called once from main.js
│   │
│   └── constants/
│       └── globals.js               # ROLES, ERROR_CODES, MODULE_NAMES — cross-module enums
│
├── manifest.webmanifest             # PWA manifest
├── service-worker.js                # Cache shell assets for officer PWA offline shell
├── icons/                           # Generated from `OHS icon.png` — see PWA assets below
│   ├── icon-192.png                 # purpose "any", transparent
│   ├── icon-512.png                 # purpose "any", transparent
│   ├── icon-maskable-192.png        # purpose "maskable", navy plate, artwork at 60%
│   ├── icon-maskable-512.png        # purpose "maskable", navy plate, artwork at 60%
│   ├── apple-touch-icon.png         # 180px, navy plate — iOS ignores alpha and the manifest
│   └── favicon-16/32/48.png         # PNG favicons, also the payloads inside favicon.ico
├── favicon.ico
├── OHS icon.png                     # Icon source of truth, 512px with alpha
├── tools/
│   └── make-icons.ps1               # Regenerates icons/ + favicon.ico. Manual, never at deploy
└── background.png                   # Optional background art (same as OHS-DB)
```

## 9.4 PWA assets

The platform installs to a home screen on both shells — an officer adds it from
Safari or Chrome and gets a standalone app; an admin can install it on the
desktop from the browser's address bar. Both use the same manifest.

**Regenerating the icons.** Every file in `icons/` and `favicon.ico` derives
from `OHS icon.png` at the repo root. Replace that file and re-run
`tools/make-icons.ps1` to reproduce the whole set — never hand-edit a generated
icon, because the next regeneration silently discards the edit.

That script is not a build step and does not violate the no-build-tools rule.
Nothing runs it at deploy time; GitHub Pages still serves the repo exactly as
committed, generated PNGs included. It is a manual one-off, run by the
developer on the rare occasion the logo changes, and it uses only
`System.Drawing` from the Windows runtime — no npm, no toolchain to install.

**The two icon purposes are not interchangeable.** A `maskable` icon is cropped
by the platform to whatever shape it likes (circle, squircle, rounded square),
and only the centre 80%-diameter circle is guaranteed to survive. That is why
the maskable variants carry a navy plate with the artwork at 60% — a
transparent icon declared maskable gets a black plate on Android, and one drawn
edge to edge loses its corners. The `any` variants stay transparent and
full-bleed. Both must be present; neither substitutes for the other.

**Every path is relative.** GitHub Pages serves this repo from `/OHS-Platform/`,
not from a domain root, so `start_url`, `scope`, and every icon `src` in the
manifest are relative, as are the `<link>` tags in `index.html` and the worker
URL in `pwa.js`. A leading slash resolves one directory too high and breaks
installation with no visible error.

**`theme_color` is duplicated in `index.html`.** The `<meta name="theme-color">`
tag colours the browser chrome before the manifest is parsed. It must stay in
step with `theme_color` in the manifest — both are `--navy` (`#0f1942`).

### What the service worker may cache

The worker caches shell assets only: HTML, CSS, JS, icons, background art. It
never caches platform data, and the fetch handler is written so that API calls
never enter its control flow at all — it calls `respondWith()` only for
same-origin GETs and the three pinned CDN libraries, and every Apps Script
action is a cross-origin POST.

This is rule 18, not a performance preference. The officer's data cache is the
IndexedDB snapshot governed by `staleCheck.js`. A second, ungoverned copy of an
API response in the HTTP cache would let an officer past `max_stale_hours` read
a verdict the fail-closed lockout never inspects — exactly the outcome the rule
exists to prevent.

Add to this list of prohibitions rather than reasoning case by case:

- **Never cache a response from the Apps Script Web App**, under any strategy.
- **Never cache a response to a non-GET request.**
- **Never precache an exhaustive list of the JS modules.** `main.js` statically
  imports the whole tree, so one online visit populates the runtime cache on
  its own. A hand-maintained list is a second source of truth, and a forgotten
  entry is a blank screen offline.
- **Bump `CACHE_VERSION` when a file is renamed or removed**, or when a cached
  asset is known to be bad. Routine deploys do not need it — the
  stale-while-revalidate strategy picks changes up on the following load.

## 9.2 Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Render functions | camelCase + `render` prefix | `renderEmployeeFormPage`, `renderTopbar` |
| Event-binding functions | camelCase + `bind` prefix | `bindEmployeeFormEvents` |
| Utility functions | camelCase | `deriveCertState`, `daysUntil` |
| Sheet column keys | snake_case | `employee_id`, `cert_wah_practical_expiry` |
| Apps Script action names | snake_case | `list_employees`, `officer_sync` |
| Error codes | snake_case | `unauthenticated`, `validation_failed` |
| i18n keys | snake_case | `field_name`, `verdict_cleared` |
| CSS classes | plain kebab-case | `.btn-primary`, `.cert-row` |
| Files | camelCase, matches main exported function | `employeeFormPage.js` exports `renderEmployeeFormPage` |
| Module folders | lowercase plural | `js/modules/employees/`, `js/modules/equipment/` |

## 9.3 What NOT to Do

- Never add `package.json`, `node_modules`, or any npm dependency.
- Never introduce a bundler, transpiler, or build step of any kind.
- Never use React, Vue, or any UI framework — plain JS template-literal rendering only.
- Never call Sheets directly from the frontend. Every read and write goes through `js/api.js` → Apps Script.
- Never hardcode the Apps Script URL in code. It lives in `localStorage.ohsp_script_url` on each device.
- Never put the Sheet ID anywhere outside the Apps Script itself.
- Never send a plain-text password over the network. Always hash with SHA-256 in the browser first.
- Never store the session token in `localStorage`. Admin: memory only. Officer: `sessionStorage` (mobile exception).
- Never store cached snapshot in `localStorage`. Officer snapshots live in IndexedDB (`ohsp-officer`).
- Never hard-delete a row from any tab. Employees archive, equipment gets rejected, users deactivate.
- Never bypass the server-side permission check. Frontend permission gates are for UX; the server is the security gate.
- Never trust `updated_at`, `updated_by`, or any audit field from the client payload. Always set from the session server-side. The one documented exception is `archived` on a `bulk_import_employees` **create** (Section 3.5) — and even there, `archived_at` and `archived_by` still come from the clock and the session.
- Never let two modules share files inside `js/modules/`. Shared code lives in `js/utils/` or `js/components/`.
- Never derive compliance state client-side. The server derives; the frontend displays.
- Never hardcode a hex color outside `css/tokens.css`.
- Never use `margin-left`, `padding-right`, or any physical CSS property. Always logical.
- Never hardcode a visible string in JS. Always `t('key')`.
- Never show a verdict from a stale officer cache (>72h). Fail-closed lockout, no override.
- Never let an officer session write to Sheets in v1. Read-only, period.
- Never sort the RDT eligible pool by anything but a random shuffle before slicing to the monthly quota. No "least recently tested first", no alphabetical, no seeding the RNG — the randomness is the point of the programme.
- Never freeze the RDT eligible pool at the start of the fiscal year. Recompute it at every selection.
- Never select an employee with an expired or missing MCU for RDT, including as a swap replacement.
- Never let Feb/Mar draw an employee who has no `completed` entry this fiscal year — that would book a repeat test for someone who never had a first one.
- Never let RDT status affect a site-check verdict or a dashboard compliance KPI. An employee overdue for RDT is still `cleared` if their certificates are in order. RDT is HR paperwork, not a safety blocker.
- Never expose RdtLog or any RDT setting to an officer session.
- Never re-introduce flat RDT date columns on Employees. RdtLog is the sole source of truth.
- Never let a module admin call user-management actions. Super admin only, enforced server-side.
- Never allow demoting or deactivating the last super admin. Server-side check on every user mutation.
- Never render an unpaginated list. All list_* actions have server-side paging; frontend respects `page_size`.
- Never rebuild the DOM via `innerHTML` on every keystroke of a search input without restoring focus and caret position on the freshly-rendered input. This is how OHS-DB lost focus on every keystroke. In any page where a text input drives a live filter (search boxes, live-filter dropdowns), the `bind*Events` function must remember which input was focused and restore focus + selection range after the re-render, OR the input must be event-listener-updated in place without a full page re-render.
- Never add a feature not in this file without confirming with Khaled.
