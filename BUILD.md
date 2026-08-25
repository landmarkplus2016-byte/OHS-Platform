# BUILD.md — OHS Platform
> Your step-by-step manual for building the app from zero to live.
> Work through this top to bottom. Check off every item as you go.
> Never skip a test. Never move to the next step if a test fails.
> **No npm. No build step. Ever.** Every file is loaded directly by the browser.

---

## Before You Write a Single Line of Code

### One-time setup checklist
- [ ] Create a new GitHub repository — name it `ohs-platform` (private is fine, public is OK too)
- [ ] Enable GitHub Pages: Settings → Pages → Deploy from `main` branch, root folder
- [ ] Create a new Google Sheet — name it `OHS Platform DB` — save its URL for later
- [ ] Create a new Apps Script project attached to that Sheet (Extensions → Apps Script)
- [ ] Create your project folder locally: `ohs-platform`
- [ ] Drop `CLAUDE.md` and `BUILD.md` into the root of that folder
- [ ] Create a `design/` folder and drop `admin_prototype.html` + `officer_prototype.html` into it (copies of the OHS-DB prototypes)
- [ ] Create an `apps-script/` folder (empty for now — Stage 2 fills it)
- [ ] Open the folder in VS Code
- [ ] Connect your local folder to the GitHub repo
- [ ] **Do not run `npm init`, `npm install`, or any npm command at any point in this project**

### How to preview while building
No dev server needed for most work, but a static file server avoids browser quirks with ES modules:
- VS Code's **Live Server** extension (right-click `index.html` → "Open with Live Server")
- Or Python: `python -m http.server 8000` from the project root, open `http://localhost:8000`

### First message to Claude Code — copy and paste this exactly:
```
Read CLAUDE.md first and confirm you understand the project before writing any code.
Confirm you understand this is a plain HTML/CSS/JS project — no npm, no build tools,
no React, no Tailwind, ever. Confirm the backend is Google Sheets accessed only through
a single Apps Script Web App, and that js/api.js is the only frontend file that talks
to the backend.

Open both design prototypes in a browser:
  - design/admin_prototype.html
  - design/officer_prototype.html
These are the approved visual references. Confirm you understand they guide styling.

Describe in your own words:
  - what this app does
  - the difference between super admin, module admin, and officer
  - how sessions work (8-hour fixed expiry, single active session, force password change)
  - how modules plug into the shell via manifests
  - how the officer app fails closed on stale cache
  - why the frontend never derives compliance state

Then create the empty folder and file structure exactly as defined in Section 9.1 of
CLAUDE.md. Empty files only, no code yet.

Do not write any logic until I confirm the structure looks correct.
```

### After structure is created — verify:
- [ ] All folders exist: `css/`, `js/`, `js/i18n/`, `js/modules/employees/`, `js/modules/equipment/`, `js/modules/officer/`, `js/shell/`, `js/components/`, `js/utils/`, `js/constants/`, `design/`, `apps-script/`
- [ ] All files listed in Section 9.1 exist and are empty
- [ ] `CLAUDE.md` and `BUILD.md` are in the root
- [ ] No `package.json`, no `node_modules`, no bundler configs anywhere
- [ ] No code has been written yet

---

# Stage 1 — The Google Sheet

**Goal:** The Sheet has all 13 tabs with correct headers. Nothing else. This becomes the database.

**Prompt:**
```
Read CLAUDE.md Section 2. We are on Stage 1.

I've created a new Google Sheet named 'OHS Platform DB'. Give me:

1. A step-by-step guide (bullet list) to create the 13 tabs in the exact order:
   Config, Users, Sessions, Permissions, Employees, RenewalHistory, RdtLog,
   Equipment, InspectionHistory, FieldOptions, ModuleSettings,
   Vehicles, VehicleHistory.

2. For each tab, the exact column headers to paste into row 1, in the exact order
   they appear in CLAUDE.md Section 2.

3. For the Config tab, the exact key/value rows to paste in as the initial setup
   (from the "Required rows on setup" table in Section 2).

4. For the FieldOptions tab, initial rows for these lists (values from the OHS-DB
   defaults — check OHS-DB CLAUDE.md if uncertain):
   - field_titles
   - safety_titles
   - contractors
   - subcontractors
   - employment_status
   - legal_permission
   - equipment_items (start with a small placeholder list; can expand later)
   - equipment_brands (same)

5. For the ModuleSettings tab, the exact rows for:
   - (employees, blocker_certs, wah_practical,wah_theoretical,mcu)
   - (employees, warning_certs, fa,ff,ra,ec)
   - (equipment, urgent_days, 30)

   Plus the RDT block under the employees module (Section 2, "RDT
   configuration"). These can be left out — the RDT page seeds them itself when
   the super admin enables the feature — but adding them up front means the
   programme is ready to run on day one:
   - (employees, rdt_enabled, FALSE)
   - (employees, rdt_fiscal_year_start_month, 4)
   - (employees, rdt_monthly_target_pct, 10)
   - (employees, rdt_yearly_target_pct, 120)
   - (employees, rdt_hire_grace_months, 3)
   - (employees, rdt_repeat_months, 2,3)
   - (employees, rdt_safety_title, Safety Officer)

6. For the Users tab, ONE row: the bootstrap super admin, with:
   - user_id: USR001
   - username: khaled (or whatever I confirm)
   - password_hash: (leave this cell empty — I'll fill it in Stage 3 after we
     have the SHA-256 hasher working; for now the account cannot log in)
   - force_password_change: TRUE
   - display_name: Khaled
   - role: super_admin
   - is_super_admin: TRUE
   - active: TRUE
   - created_at: today's date in ISO format
   - created_by: system
   - updated_at: same
   - updated_by: system
   - last_login_at: (empty)

Do NOT write any Apps Script code yet. This stage is Sheet setup only.
```

**Tests for Stage 1:**
- [ ] All 13 tabs exist in the correct order
- [ ] Every tab's row 1 contains the exact column headers from CLAUDE.md Section 2
- [ ] Config tab has all 16 required rows with default values
- [ ] FieldOptions tab has rows for all 8 list_keys
- [ ] ModuleSettings tab has 3 rows, plus 7 more if the RDT block was seeded
- [ ] Employees tab has NO rdt_1 / rdt_2 / rdt columns — drug tests live on RdtLog
- [ ] Users tab has 1 row (bootstrap super admin, password_hash empty)
- [ ] All other tabs have only their header row

---

# Stage 2 — Apps Script Skeleton

**Goal:** Apps Script deployed, health check works. No auth yet, no actions yet — just the dispatcher and utilities.

## Step 2.1 — Utils, Sheets helper, dispatcher

**Prompt:**
```
Read CLAUDE.md Sections 2, 3, and 9.1 (Apps Script file map).

Build these three Apps Script files:

1. apps-script/Utils.gs
   Exports functions used everywhere else:
   - jsonResponse(obj) → wraps in ContentService.createTextOutput as JSON
   - okResponse(data) → jsonResponse({ok:true, data})
   - errResponse(code, message, fieldErrors) → jsonResponse({ok:false, error:code, message, field_errors:fieldErrors||null})
   - nowIso() → current ISO datetime string (UTC)
   - todayIso() → current ISO date string (YYYY-MM-DD)
   - generateUuid() → RFC4122 UUID
   - normalizeBoolean(value) → true only if value === true or 'TRUE'; else false
   - normalizeIsoDate(value) → 'YYYY-MM-DD' string or empty; handles Sheet date serials

2. apps-script/Sheets.gs
   Low-level helpers for reading/writing rows:
   - getSheet(name) → the Sheet by tab name; throws if missing
   - readAllRows(sheetName) → array of objects, keys from row 1 headers
   - readRowByKey(sheetName, keyColumn, keyValue) → single object or null
   - appendRow(sheetName, rowObject) → maps object to header order and appends
   - updateRowByKey(sheetName, keyColumn, keyValue, updatesObject) → merges into row
   - deleteRowByKey(sheetName, keyColumn, keyValue) → removes row
   All functions cache the header row of each sheet for the current request.

3. apps-script/Main.gs
   The dispatcher:
   - doGet(e) → returns okResponse({service:'OHS Platform API', version:'1.0'})
   - doPost(e) →
     * Wraps everything in try/catch. On any throw, log the error and return
       errResponse('server_error', String(err))
     * Parses e.postData.contents as JSON. On parse failure, errResponse('validation_failed', 'malformed_json')
     * Reads action, token, payload from the parsed body
     * If action is missing or not a string, errResponse('validation_failed', 'missing_action', {action:'required'})
     * Dispatches on action name using a switch statement. For Stage 2, the only
       action to handle is 'ping' which returns okResponse({pong:true, at:nowIso()}).
       Every other action returns errResponse('validation_failed', 'unknown_action', {action:'unknown'}).

Do NOT implement any of the real actions yet. Just the shell.
```

**Tests for Step 2.1:**
- [ ] Files created in the Apps Script project
- [ ] Deploy → New deployment → Web App, "Execute as: Me", "Anyone" access
- [ ] Copy the deployment URL
- [ ] Open the URL in a browser → returns `{"ok":true,"data":{"service":"OHS Platform API","version":"1.0"}}`
- [ ] POST to the URL with `curl` or Postman with body `{"action":"ping"}` → returns `{"ok":true,"data":{"pong":true,"at":"..."}}`
- [ ] POST with `{"action":"nonsense"}` → returns `{"ok":false,"error":"validation_failed","message":"unknown_action","field_errors":{"action":"unknown"}}`
- [ ] POST with body `not json` → returns `{"ok":false,"error":"validation_failed","message":"malformed_json"}`

## Step 2.2 — Config, Auth, Session validation

**Prompt:**
```
Read CLAUDE.md Sections 3.2, 3.3, 3.9, and 4.

Build these Apps Script files:

1. apps-script/Config.gs
   - getConfigMap() → returns all Config rows as a plain object keyed by 'key'
   - Action handler: handleGetConfig(payload) → returns okResponse with app_name,
     company_name, primary_language, session_expiry_hours, max_stale_hours only.
     No token required.
   - Action handler: handleUpdateConfig(session, payload) → super-admin only,
     updates whitelisted keys (implement a hardcoded ALLOWED_CONFIG_KEYS list).

2. apps-script/Auth.gs
   - validateSession(token) → returns { session, user, permissions } or throws
     an object {code:'unauthenticated', message:'...'} that the caller must catch
     and convert to errResponse.
     Steps: read Sessions by token; check expires_at; read Users by user_id;
     check active; read Permissions for user (unless super admin).
   - handleLogin(payload) → implements login per Section 3.2:
     * Validates username + password_hash present
     * Case-insensitive username match in Users
     * Deletes ALL existing Sessions rows for this user_id (single-session rule)
     * Generates UUID token, inserts row, updates last_login_at
     * Returns token + user info + permissions
     * If user has force_password_change=TRUE, response includes must_change_password:true
   - handleLogout(session) → deletes session row by token, returns okResponse({})

3. Update apps-script/Main.gs:
   - Wire the switch in doPost to dispatch these actions:
     'get_config' → handleGetConfig
     'login' → handleLogin
     'ping' (still works)
     For every other action requiring auth, call validateSession(token) first, catch
     any {code} error and return errResponse(err.code, err.message).
   - For now, wire 'logout' and 'update_config' too. They call validateSession,
     then their handlers with (session, payload).

For hashing: passwords hashed CLIENT-SIDE with SHA-256. Apps Script only compares
hashes as strings. Do not hash server-side.
```

**Tests for Step 2.2:**
- [ ] POST `{"action":"get_config"}` → returns config fields
- [ ] Manually populate the Users row's password_hash with a SHA-256 hex of "temppass123":
      Use https://emn178.github.io/online-tools/sha256.html — paste "temppass123", copy hex, paste into cell
- [ ] POST `{"action":"login","payload":{"username":"khaled","password_hash":"<that hex>","device_id":"test"}}` → returns a token
- [ ] POST the same again → returns a DIFFERENT token; the Sessions tab should now show only the new row (old was deleted)
- [ ] POST `{"action":"logout","token":"<the token>"}` → returns `{"ok":true,"data":{}}`
- [ ] Reuse that same token: `{"action":"get_config"}` still works (no token needed), but any authenticated action returns `unauthenticated`
- [ ] POST login with wrong password_hash → `{"ok":false,"error":"unauthenticated",...}`

## Step 2.3 — Compliance derivation

**Prompt:**
```
Read CLAUDE.md Section 6.

Build apps-script/Compliance.gs:

- deriveCertState(dateStr, today, thresholds) → one of the six states in Section 6.1
  (missing, expired, urgent, soon, valid — no `plan` tier)
- stateRank(state) → integer ranking per Section 6.1: suspended=6, expired=5, urgent=4,
  soon=3, missing=1, valid=0
- WAH_KEYS = ['wah_practical', 'wah_theoretical']
- APPLICABLE_CERTS_FIELD = ['wah_practical','wah_theoretical','ra','fa','ff','ec','mcu']
- APPLICABLE_CERTS_SAFETY = [...APPLICABLE_CERTS_FIELD, 'ppe','lifting','scaffolding']
- getBlockerCerts(moduleSettings) → parses ModuleSettings 'employees.blocker_certs'
- getWarningCerts(moduleSettings) → parses ModuleSettings 'employees.warning_certs'

- deriveEmployeeDerived(employeeRow, today, thresholds, moduleSettings) → returns the
  full derived block from Section 6.4 (per_cert, worst_state, expired_count,
  expiring_soon_count, verdict, blockers, warnings).
  Rules exactly as in Sections 6.1 and 6.2. Uses text_key + text_params shape.
  IMPORTANT: after computing per_cert for every cert, apply the WAH-suspended rule
  (Section 6.1): if per_cert.mcu === 'expired' AND per_cert.wah_practical !== 'missing',
  set per_cert.wah_practical = 'suspended'. Same for wah_theoretical. Do this BEFORE
  computing worst_state and blockers, so the suspended state cascades correctly.

- deriveEquipmentDerived(equipmentRow, today, thresholds, moduleSettings, employeesById)
  → returns the derived block from Section 6.4.
  Rules exactly as in Section 6.3:
   * Blocker: rejected OR third_party_expired OR latest completed wave failed
   * Warning: third_party missing OR third_party urgent OR team_leader_id points to archived employee
   * The "latest completed wave" is the wave with the highest N where wave_N_date and
     wave_N_result are both set. Its result being 'fail' is a blocker.
   * Empty third_party_inspection_end_date is a WARNING (not blocker, not cleared).

Do NOT wire this to any action yet. Stage 3 will use it.
```

**Tests for Step 2.3:**
- [ ] Add a test function in Compliance.gs: `testDerivation()` that constructs fake rows and logs derived output. Run it from the Apps Script editor.
- [ ] Employee with all valid certs, active, approved → verdict: cleared
- [ ] Employee with expired MCU (WAH dates in the future) → verdict: blocked. blockers contains 3 entries: MCU expired, WAH practical suspended, WAH theoretical suspended. per_cert.wah_practical === 'suspended', per_cert.wah_theoretical === 'suspended', per_cert.mcu === 'expired'.
- [ ] Employee with expired MCU AND missing WAH practical (no date) → WAH practical stays 'missing' (not suspended); WAH theoretical becomes suspended. Only 2 blockers on WAH side (MCU + WAH theoretical).
- [ ] Employee with WAH expiring in 20 days (MCU valid, all others valid) → verdict: warning
- [ ] Employee with a cert expiring in 75 days (no other issues) → that cert state is 'valid' (not 'plan' — the plan tier no longer exists). Verdict: cleared.
- [ ] Employee archived=TRUE → verdict: blocked regardless of certs
- [ ] Equipment with third_party expired → verdict: blocked
- [ ] Equipment with empty third_party date → verdict: warning
- [ ] Equipment with wave_2 result='fail' (latest) → verdict: blocked
- [ ] Equipment with wave_2 result='pass', third_party in 20 days → verdict: warning

---

# Stage 3 — Frontend Shell + Login

**Goal:** The browser can open the app, ask for the Apps Script URL, hit `get_config`, and show a working login screen that talks to Apps Script.

## Step 3.1 — index.html, tokens, base CSS, main.js

**Prompt:**
```
Read CLAUDE.md Sections 8, 9.1.

Build:

1. index.html
   - Standard HTML5, <html lang="en" dir="ltr" data-theme="blue">
   - <link> tags in order: css/tokens.css, css/base.css, css/layout.css,
     css/components.css, css/pages.css
   - CDN script tags for SheetJS (0.18.5), jsPDF (2.5.1), jsPDF-autotable (3.8.2)
     — same versions as OHS-DB
   - <script type="module" src="js/main.js"></script>
   - <div id="app"></div> mount point

2. css/tokens.css — exact :root block from CLAUDE.md Section 8.3, including the
   [data-theme=...] blocks.

3. css/base.css — box-sizing reset, body uses var(--font-base) and var(--bg),
   tap-highlight reset, [dir="rtl"] font-family, scrollbar styling.
   Copy from OHS-DB and adapt for the OHS Platform brand name.

4. css/layout.css, css/components.css, css/pages.css — empty with a comment saying
   which components they'll contain.

5. js/state.js — exports (as `let`):
   - SCRIPT_URL, TOKEN, CURRENT_USER, PERMISSIONS, ROUTE, ROUTE_PARAMS, UI
   - Setters for each: setScriptUrl, setToken, setCurrentUser, setPermissions, setRoute
   - clearSession() → clears TOKEN, CURRENT_USER, PERMISSIONS, UI (but not SCRIPT_URL)

6. js/main.js — minimal for now:
   - On DOMContentLoaded:
     * Read localStorage.ohsp_script_url into state
     * If missing → render a "First-time setup" screen with a text input for the URL,
       a Save button that stores to localStorage and reloads
     * If present → render "Loading..." for now (Step 3.2 will fill this in)
```

**Tests for Step 3.1:**
- [ ] Open index.html via Live Server on a fresh browser (no localStorage)
- [ ] First-time setup screen appears
- [ ] Paste the Apps Script Web App URL, click Save → page reloads, shows "Loading..."
- [ ] localStorage.ohsp_script_url is set
- [ ] DevTools :root computed styles show all tokens from Section 8.3
- [ ] Changing <html data-theme="teal"> in DevTools changes --primary color

## Step 3.2 — api.js, i18n, hashing, login page

**Prompt:**
```
Read CLAUDE.md Sections 3, 4, and 8.1.

Build:

1. js/api.js — the ONLY caller of Apps Script.
   Exports a single object: api
   api.call(action, payload) → Promise<data>
   Behavior per CLAUDE.md Section 3.1:
   - Reads SCRIPT_URL and TOKEN from state
   - POST with Content-Type text/plain;charset=utf-8
   - Body: JSON.stringify({action, token, payload})
   - Parses response as JSON
   - ok:true → resolve with data
   - ok:false with error:'unauthenticated' → clearSession(), redirect to #/login,
     reject with new ApiError('unauthenticated', message)
   - ok:false with any other error → reject with new ApiError(error, message, field_errors)
   - Network failure → reject with new ApiError('network_error', reason)
   Also export class ApiError(code, message, field_errors)

2. js/utils/crypto.js — exports sha256Hex(text)
   Uses window.crypto.subtle.digest('SHA-256', TextEncoder(text)), returns hex string.

3. js/i18n/en.js — start with these keys for the login flow (add more as you go):
   app_name, company_name, sign_in, username, password, invalid_credentials,
   session_expired, first_time_setup, script_url_prompt, save,
   change_password_title, current_password, new_password, confirm_new_password,
   password_too_short, passwords_dont_match, password_changed_ok

4. js/i18n/ar.js — same keys, Arabic translations (matching OHS-DB style)

5. js/i18n/i18n.js — t(key, params), setLanguage(lang), getLanguage()
   Per CLAUDE.md Section 8.1. Reads/writes localStorage.ohsp_lang.

6. js/shell/loginPage.js:
   - renderLoginPage() → HTML string for login card:
     * Centered card, app_name from a passed-in config
     * Language toggle (works without login)
     * Username input, password input, Sign In button
     * Inline error area
   - bindLoginPageEvents():
     * Language buttons → setLanguage
     * Sign In:
       - Read inputs, validate non-empty
       - const hash = await sha256Hex(password)
       - const data = await api.call('login', {username, password_hash: hash, device_id})
       - store TOKEN, CURRENT_USER, PERMISSIONS in state
       - if data.user.must_change_password → go to change-password
       - else → go to #/dashboard (admin) or #/check/home (officer)
     * Catch ApiError, show inline error

7. js/router.js — minimal:
   - go(route, params) → sets state, updates hash, calls render
   - initRouter() → parses initial hash, listens hashchange
   - Route table for Stage 3: 'login', 'change-password', 'dashboard' (placeholder),
     'check/home' (placeholder)

8. js/render.js — minimal:
   - render() → checks CURRENT_USER: null → renderLoginPage
     — for other routes, render a placeholder like "<div>Dashboard placeholder</div>"

9. Update js/main.js:
   - After reading SCRIPT_URL, call api.call('get_config').then(config => {
       set app_name and other display strings in state, initRouter(), render()
     })
   - Handle network errors on get_config gracefully (show a "Cannot reach server" screen
     with a Retry button and a "Change server URL" button that clears
     localStorage.ohsp_script_url).
```

**Tests for Step 3.2:**
- [ ] Fresh browser → first-time setup → paste URL → login page appears
- [ ] "OHS Platform" is the visible header
- [ ] Language toggle to Arabic → dir="rtl", text flips
- [ ] Enter khaled + temppass123 → login succeeds, "Dashboard placeholder" shows
- [ ] Refresh page → login required again (token was in memory only)
- [ ] Wrong password → "Invalid credentials" inline error
- [ ] Sessions tab in Google Sheet: only one row for USR001
- [ ] Log in on a second browser tab → the first tab's next action would return unauthenticated (verify by clicking around; you'll get bounced to login)

## Step 3.3 — Change-password screen

**Prompt:**
```
Read CLAUDE.md Section 4.2, 4.3.

Extend the Apps Script:

1. apps-script/Users.gs — add handleResetUserPassword(session, payload):
   * If session.user.is_super_admin AND payload.user_id !== session.user.user_id:
     — target user's password_hash updated, force_password_change=TRUE, all their
       sessions deleted
   * If self-reset (payload.user_id === session.user.user_id):
     — current_password_hash required; verify against Users row
     — update password_hash, clear force_password_change to FALSE
     — delete all Sessions for this user EXCEPT the current one (so they stay logged in)

2. Update Main.gs to dispatch 'reset_user_password'

Extend the frontend:

3. js/shell/changePasswordPage.js:
   - renderChangePasswordPage() → HTML with three inputs:
     current password, new password, confirm new password
   - bindChangePasswordEvents():
     * Validate non-empty, new >= 8 chars, matches confirm
     * Hash both current and new
     * api.call('reset_user_password', { user_id: CURRENT_USER.user_id,
       current_password_hash: hash1, new_password_hash: hash2 })
     * On success: update CURRENT_USER.must_change_password = false, go to #/dashboard
     * On error code='validation_failed' with field_errors.current_password_hash → show error

4. Router guard: if CURRENT_USER.must_change_password is true, ALL routes except
   'change-password' and 'logout' redirect to 'change-password'.
```

**Tests for Step 3.3:**
- [ ] After the bootstrap login (force_password_change=TRUE), the app immediately goes to change-password
- [ ] Try to navigate to #/dashboard → bounces back to change-password
- [ ] Enter current=temppass123, new=newpass123, confirm=newpass123 → success, routes to dashboard placeholder
- [ ] Users row in Sheet: password_hash changed, force_password_change=FALSE
- [ ] Sessions tab: the row still exists (self-reset kept it)
- [ ] Log out, log back in with newpass123 → works, no forced password change

---

# Stage 4 — Router, Shell, and Manifests

**Goal:** Modules can register themselves. Sidebar builds from registered manifests. Route table auto-populates.

## Step 4.1 — Manifest system + empty modules

**Prompt:**
```
Read CLAUDE.md Section 5.

Build:

1. js/modules/employees/manifest.js — for now, minimal:
   {
     name: 'employees',
     displayNameKey: 'module_employees',
     group: 'EMPLOYEES',
     routes: [
       { path: 'field', page: () => '<div>Field list placeholder</div>' },
       { path: 'safety', page: () => '<div>Safety list placeholder</div>' },
       { path: 'renewals', page: () => '<div>Renewals placeholder</div>' },
       { path: 'rdt', page: () => '<div>RDT placeholder</div>' },
       { path: 'resigned', page: () => '<div>Resigned placeholder</div>' },
     ],
     sidebar: [
       { labelKey: 'nav_field_team', route: 'field' },
       { labelKey: 'nav_safety_team', route: 'safety' },
       { labelKey: 'nav_renewals', route: 'renewals' },
       { labelKey: 'nav_rdt', route: 'rdt' },
       { labelKey: 'nav_resigned', route: 'resigned' },
     ],
   }

2. js/modules/equipment/manifest.js — same shape:
   group: 'EQUIPMENT'
   routes for 'equipment', 'equipment/rejected'
   sidebar for 'Active Equipment', 'Rejected Equipment'

3. js/modules/officer/manifest.js — officer app entries:
   routes for 'check/home', 'check/sync', 'check/employee/:id', 'check/equipment/:id',
   'check/locked'. All placeholders for now.

4. Update js/main.js:
   - import all three manifests
   - const MODULES = [employeesManifest, equipmentManifest, officerManifest]
   - registerModules(MODULES) — passes them to router.js

5. Update js/router.js:
   - registerModules(modules) → builds a flat route table:
     for each module, for each route entry, register with path prefix (e.g. 'field' —
     no prefix, so it works as #/field; but 'employee/:id' becomes a parameterized route)
   - Path matching: split on '/', match segments, extract :param values into ROUTE_PARAMS
   - Add shell routes: 'login', 'change-password', 'dashboard', 'settings', 'export'
   - Route guards:
     * null CURRENT_USER + not 'login' → redirect to 'login'
     * CURRENT_USER.must_change_password + not 'change-password' → redirect
     * officer role + not check/* → redirect to 'check/home'
     * admin role + check/* → redirect to 'dashboard'

6. js/utils/permissions.js:
   - canView(module) → super admin always true; else check PERMISSIONS array
   - canEdit(module) → same for edit
   - hasAnyViewPermission() → any module viewable? used to gate the sidebar

7. js/shell/sidebar.js:
   - renderSidebar(modules) → builds sidebar HTML from registered manifests:
     * Ungrouped: Dashboard link
     * For each unique 'group' in manifest order: uppercase header, then items where
       canView(module) is true. If no items visible, skip the whole group.
     * Always-visible SYSTEM group at bottom: Export, Settings (super admin only for Settings)
     * Bottom: theme swatches, language toggle, user chip, sign out
   - bindSidebarEvents()

8. js/shell/topbar.js:
   - renderTopbar(title, actionsHtml) → title left, actions right

9. js/render.js:
   - render() checks: officer role → officer shell (build in Stage 8), else admin shell:
     <div class="app">${renderSidebar(MODULES)}<div class="main">${renderTopbar(...)}<div class="content">${page(ROUTE_PARAMS)}</div></div></div>
   - Look up the current route's page function from the route table
```

**Tests for Step 4.1:**
- [ ] After login as super admin: sidebar shows Dashboard, EMPLOYEES group with 5 items, EQUIPMENT group with 2 items, SYSTEM group with Export + Settings
- [ ] Clicking any employee item → shows placeholder for that route
- [ ] Language toggle in Arabic → sidebar mirrored, labels translated (add missing keys if needed)
- [ ] Theme swatches change accent color across sidebar active items
- [ ] Signing out → returns to login

---

# Stage 5 — Employee Module

**Goal:** Full CRUD for employees through the Sheet backend. Field team list, safety team list, employee detail, add/edit forms, renewals page, RDT page, resigned page.

## Step 5.1 — Apps Script employee actions

**Prompt:**
```
Read CLAUDE.md Sections 3.5, 6.2, 6.4.

Build apps-script/Employees.gs. Implement every action in Section 3.5:

- handleListEmployees(session, payload)
- handleGetEmployee(session, payload)
- handleCreateEmployee(session, payload)
- handleUpdateEmployee(session, payload)
- handleArchiveEmployee(session, payload)
- handleUnarchiveEmployee(session, payload)
- handleListRenewalHistory(session, payload)
- handleBulkImportEmployees(session, payload)
- handleListRdtEligible(session, payload)
- handleRecordRdtWave(session, payload)

Every action must:
- Check canView('employees') or canEdit('employees') per Section 3.5
- Load Config, FieldOptions, ModuleSettings once per request (in-memory cache)
- Call deriveEmployeeDerived on every returned row
- Stamp created_at/created_by on inserts, updated_at/updated_by on all writes
- Validate against FieldOptions
- Generate employee_id from Config.next_employee_number using LockService

Update Main.gs dispatcher for all these actions.

Also add apps-script/FieldOptions.gs with:
- handleListFieldOptions(session, payload)
- handleUpdateFieldOptions(session, payload) [super admin only]
Wire into Main.gs.
```

**Tests for Step 5.1:**
- [ ] POST list_employees with valid token → returns `{employees:[], total_matching:0, page:1, page_size:50}` (empty database)
- [ ] POST create_employee with a full valid field-team employee → returns the created employee with employee_id LM-EMP-0001 and a derived block
- [ ] Sheet shows the new row
- [ ] POST list_employees again → returns the employee
- [ ] POST create_employee with duplicate national_id → returns validation_failed with field_errors.national_id='duplicate'
- [ ] POST update_employee changing cert_mcu_expiry → new RenewalHistory row appears
- [ ] POST archive_employee → row's archived=TRUE
- [ ] POST list_employees with include_archived:false (default) → archived employee is hidden

## Step 5.2 — Frontend employee module

**Prompt:**
```
Read CLAUDE.md Sections 3.5, 5.1, 6, and the design/admin_prototype.html.

Build the employee module frontend. Replace all placeholders in
js/modules/employees/manifest.js with real page functions.

1. js/modules/employees/dataActions.js:
   Wrappers around api.call for every employee action:
   - listEmployees(params), getEmployee(id), createEmployee(data),
     updateEmployee(id, updates), archiveEmployee(id, reason, employmentStatus),
     unarchiveEmployee(id), listRenewalHistory(params),
     bulkImportEmployees(rows, opts), listRdtEligible(team), recordRdtWave(ids, wave, date),
     listFieldOptions()

2. js/modules/employees/constants.js:
   CERT_KEYS_FIELD, CERT_KEYS_SAFETY, CERT_LABEL_KEYS, LIST_FIELD_KEYS for form dropdowns

3. js/modules/employees/i18n.js:
   Merges module-specific keys into global i18n at boot

4. js/modules/employees/pages/listPage.js:
   - renderFieldListPage() and renderSafetyListPage() — same underlying function,
     different team filter
   - Uses filtering, search, pagination server-side (calls listEmployees with params)
   - Table columns match OHS-DB
   - Row click → go to detail page
   - "+ Add employee" button → form new
   - IMPORTANT: the search input drives a live filter that triggers listEmployees +
     re-render. Every re-render rebuilds the DOM via innerHTML and destroys the focused
     <input>. bindEmployeeListPageEvents must, before each re-render, capture the
     document.activeElement id + selectionStart/selectionEnd, and after the re-render
     restore focus and caret position. Same treatment for any other page with a live-filter
     text input. See "What NOT to Do" in CLAUDE.md Section 9.3.

5. js/modules/employees/pages/detailPage.js:
   - Calls getEmployee(id) on load
   - Shows all sections per OHS-DB detail page
   - "View certificate" button appears when *_link is non-empty; opens window.open
   - Renewal history section
   - Assigned equipment section
   - Edit / Archive / Unarchive buttons; button visibility respects canEdit('employees')

6. js/modules/employees/pages/formPage.js:
   - Handles both new and edit routes
   - Team-conditional fields (safety shows PPE/Lifting/Scaffolding + qualifications)
   - No drug-test inputs: tests are RdtLog events, recorded from the RDT page
   - Validates client-side (name, national_id required, dropdowns from field options)
   - Save → calls createEmployee or updateEmployee → routes to detail
   - Cancel → routes back

7. js/modules/employees/pages/renewalsPage.js:
   - Server-side sorted list of all upcoming certificate renewals
   - Filters: days window, team, subcontractor, cert type
   - Row click → jump to employee detail

8. js/modules/employees/pages/rdtPage.js + rdtHistoryPage.js:
   - The random drug testing programme (CLAUDE.md Section 3.5, apps-script/Rdt.gs)
   - Onboarding card when rdt_enabled is not set; super admin only can enable
   - Yearly progress hero: completed / target, coverage %, pool size, phase
   - This month's card: quota line, Generate / Regenerate, and per-row
     Complete / Miss / Swap / Undo / Delete
   - Recent activity strip, linking to the full log at #/rdt/history
   - History page filters by month, team, status, result; pages server-side;
     exports the whole filtered set to Excel
   - Uses listRdtOverview, listRdtHistory, generateRdtSelection,
     updateRdtEntry, swapRdtSelection, deleteRdtEntry

9. js/modules/employees/pages/resignedPage.js:
   - Shows archived employees only
   - Read-only view + Unarchive button

10. Update manifest.js to wire the real page functions
```

**Tests for Step 5.2:**
- [ ] Log in as super admin
- [ ] Navigate to Field Team → shows employee list (empty at first)
- [ ] Click Add employee → form appears
- [ ] Fill in a field-team employee with all valid data → save → returns to detail page with new employee_id
- [ ] Refresh the browser (re-login required) → employee still there (persisted to Sheet)
- [ ] Edit MCU expiry → save → detail shows renewal history row
- [ ] Navigate to Safety Team → separate list
- [ ] Add a safety employee → form shows all 10 certs and the qualifications section
- [ ] Renewals page → sorted list of upcoming expirations
- [ ] RDT page as super admin, before enabling → onboarding card with an Enable button
- [ ] Enable → hero, quota line and an empty month card appear
- [ ] Generate → roughly 10% of the eligible pool is picked, at random
- [ ] Generate again in the same month → nothing new is drawn (nobody is left eligible this month)
- [ ] Regenerate → a different list; anything already completed or missed survives it
- [ ] Mark one completed with a pass → coverage % and the progress bar both move
- [ ] Mark one missed → it stops counting, and that person can be drawn again next month
- [ ] Swap one → the original disappears, a different name takes its place
- [ ] An employee with an expired MCU is never drawn, and the month card says how many were excluded
- [ ] An employee hired inside the grace window is never drawn
- [ ] A safety-team employee whose title is not "Safety Officer" is never drawn
- [ ] #/rdt/history → filters by month/team/status/result, pages, and the Excel export matches the filtered view
- [ ] Employee detail → RDT history section lists that person's entries, read-only
- [ ] Archive an employee → moves to Resigned list; unarchive from there → back to active
- [ ] Language toggle → all labels translated
- [ ] Type a full name into the search box in one continuous keystroke burst — cursor stays in the box the whole time; you never have to click back into it. Same for other filter dropdowns that trigger re-renders.

---

# Stage 6 — Equipment Module

**Goal:** Equipment CRUD end-to-end. Same shape as employees but with the equipment-specific verdict logic.

## Step 6.1 — Apps Script equipment actions

**Prompt:**
```
Read CLAUDE.md Sections 3.6, 6.3, 6.4.

Build apps-script/Equipment.gs. Implement every action in Section 3.6:

- handleListEquipment(session, payload)
- handleGetEquipment(session, payload)
- handleCreateEquipment(session, payload)
- handleUpdateEquipment(session, payload)
- handleRejectEquipment(session, payload)
- handleUnrejectEquipment(session, payload)
- handleListInspectionHistory(session, payload)
- handleBulkImportEquipment(session, payload)

Rules:
- Check canView('equipment') or canEdit('equipment')
- Load Employees once to build employeesById (for team_leader_name + team_leader_archived in list responses)
- Call deriveEquipmentDerived on every returned row
- Third-party inspection date change → append to InspectionHistory
- Generate equipment_id from Config.next_equipment_number using LockService

Update Main.gs dispatcher.
```

**Tests for Step 6.1:**
- [ ] POST create_equipment with team_leader_id pointing to an existing employee → returns equipment with derived, team_leader_name populated
- [ ] POST list_equipment → shows the new item
- [ ] POST update_equipment changing third_party_inspection_end_date → InspectionHistory row appears
- [ ] POST reject_equipment → row's rejected=TRUE
- [ ] POST list_equipment with include_rejected:false → rejected item hidden
- [ ] Create equipment with empty third_party_inspection_end_date → derived.verdict='warning', warnings has type='third_party_missing'
- [ ] Set wave_2_date + wave_2_result='fail' → derived.verdict='blocked'

## Step 6.2 — Frontend equipment module

**Prompt:**
```
Read CLAUDE.md Sections 3.6, 5.1, 6.3.

Build js/modules/equipment/ with same shape as employees:

1. dataActions.js — wrappers around all equipment api.call actions
2. constants.js — equipment-specific keys
3. i18n.js — equipment i18n keys (item, brand, serial_no, third_party_sn, etc.)
4. verdict.js — NOT NEEDED; verdict comes pre-derived from server. Skip.
5. pages/listPage.js — active equipment list with search on serial numbers + item name
6. pages/rejectedPage.js — rejected equipment list, unreject option
7. pages/detailPage.js — full equipment detail with team leader link, inspection history
8. pages/formPage.js — new + edit
9. pages/rejectFormPage.js — modal or inline for rejection reason
10. manifest.js — wire everything

Employee detail page (in employees module) needs to fetch and show
"Assigned equipment" section. Employee getEmployee response includes assigned_equipment
brief refs — render them as a small table with verdict badges. Click → jump to
equipment detail.

Since employee's detail page references equipment routes, and modules cannot import
from each other's folders, the LINKS in the assigned-equipment table just use
go('equipment/' + id) and the router handles it. No cross-module imports needed.
```

**Tests for Step 6.2:**
- [ ] Navigate to Active Equipment → shows list
- [ ] Add equipment linked to an employee → saves, appears in list with team leader name shown
- [ ] Open the linked employee's detail page → shows "Assigned equipment" section with a row for this equipment
- [ ] Click through to equipment from there → equipment detail loads
- [ ] Edit third-party inspection date → saves, InspectionHistory shows the change
- [ ] Reject equipment with reason → moves to Rejected list
- [ ] Unreject → back to Active list

---

# Stage 7 — Dashboard, Settings, Export

**Goal:** Cross-module aggregation views. Super admin can manage users, permissions, lists, thresholds. Export works.

## Step 7.1 — Dashboard

**Prompt:**
```
Read CLAUDE.md Section 5.5 and 8.4.

Build js/shell/dashboardPage.js:

- renderDashboardPage() checks each module's manifest.dashboard.kpis / .charts
  and calls them if canView(module) is true.
- Compose vertically: employee KPIs → employee charts → equipment KPIs → equipment charts

Each module implements its dashboard functions:

1. js/modules/employees/dashboard.js:
   - renderEmployeeKpis() → 4 KPI cards:
     Total Active (split field/safety), Certs Expired, Expiring ≤30 days, Compliant
     Data: calls listEmployees with page_size=1 for total_matching; then a stats action
     (add `list_employee_stats` to Apps Script — returns aggregate counts).
   - renderEmployeeCharts() → SVG charts for cert types + state donut + subcontractor
     Data: `list_employee_stats` returns everything needed

2. js/modules/equipment/dashboard.js:
   - renderEquipmentKpis() → 4 KPI cards:
     Total Active, Inspections Expired, Expiring ≤30 days, Rejected This Month
   - renderEquipmentCharts() → bars for item types + non-compliant by subcontractor
   - Backend: `list_equipment_stats`

Update manifest.js in each module to reference these dashboard functions.

Wire the new stats actions into Apps Script (Employees.gs / Equipment.gs).
```

**Tests for Step 7.1:**
- [ ] Dashboard shows employee KPIs on top
- [ ] Below: employee charts, then equipment KPIs, then equipment charts
- [ ] Numbers match actual data in the Sheet
- [ ] After adding an employee → dashboard updates on refresh
- [ ] Charts render correctly; donut proportions correct

## Step 7.2 — Settings

**Prompt:**
```
Read CLAUDE.md Sections 3.4, 3.7.

Build js/shell/settingsPage.js with 4 tabs:

1. Users tab (super admin only):
   - Table: Username, Display Name, Role, Active toggle, Actions (Edit / Reset password / Deactivate)
   - "+ Add user" opens modal with all fields including per-module permissions checkboxes
   - Edit user opens same modal pre-filled (password field blank = keep existing;
     password reset is a separate button because it uses a different action)
   - Delete = deactivate (no true delete)
   - Backend: list_users, create_user, update_user, reset_user_password, deactivate_user

2. Lists tab:
   - One panel per list_key in FieldOptions
   - Editable list of options with active toggle, sort order
   - Save → update_field_options (super admin only)

3. Thresholds tab:
   - Config sliders/inputs for urgent_days, soon_days, plan_days,
     session_expiry_hours, max_stale_hours
   - Save → update_config

4. Data tab:
   - Import Excel (per module — Employees and Equipment)
   - Configurable Drive folder URL (for future export flows)
   - Show current Sheet health (last sync times, counts)

Only super admins see Settings in the sidebar. Route guard also blocks non-super-admins.
```

**Tests for Step 7.2:**
- [ ] Settings visible only to super admin
- [ ] Users tab: add a module admin with can_view=true, can_edit=false on employees → they appear
- [ ] Sign in as that new user (after they change their initial password) → sidebar shows only EMPLOYEES group; no Equipment, no Settings; employee edit buttons hidden
- [ ] Try to POST create_employee as that user → forbidden
- [ ] Deactivate a user → they cannot log in
- [ ] Try to demote the last super admin → conflict error
- [ ] Lists tab: add a new subcontractor → appears in employee form dropdown next time
- [ ] Thresholds tab: change urgent_days to 45 → dashboard KPIs recalculate

## Step 7.3 — Export

**Prompt:**
```
Read CLAUDE.md Section 3.5, 3.6 (import), and how OHS-DB export works.

Build js/shell/exportPage.js:

- Module tab picker (Employees / Equipment)
- Filters (team, status, subcontractor, item, brand — depending on module)
- Match count preview
- Excel / CSV / PDF cards
- Same export caps as OHS-DB: PDF ≤100, Excel/CSV ≤5000
- Uses js/utils/exportHelpers.js (adapted from OHS-DB)

Excel Import for both modules:
- Settings → Data tab has "Import Employees Excel" and "Import Equipment Excel" cards
- File input → parse → preview modal with per-row action select (import / skip /
  overwrite / add-to-list)
- Confirm → bulk_import_employees or bulk_import_equipment
- Uses same fuzzy column-name matching pattern as OHS-DB
```

**Tests for Step 7.3:**
- [ ] Export employees filtered to Field Team → Excel downloads with correct columns and rows
- [ ] Export > 100 employees + PDF → PDF card disabled with warning
- [ ] Import an Excel file with 10 employees → preview shows 10 rows, all "new" → confirm → 10 employees created
- [ ] Import with a duplicate national_id → row flagged, action "Skip" default
- [ ] Import with unknown subcontractor + auto_add_unknown_options → list gets extended, employee saved

---

# Stage 8 — Officer App

**Goal:** Mobile PWA. Login, sync, search, verdict lookup, stale lockout.

## Step 8.1 — Apps Script officer actions

**Prompt:**
```
Read CLAUDE.md Sections 3.8 and 7.

Build apps-script/Officer.gs:

- handleOfficerSync(session, payload) → returns the full stripped snapshot per Section 7.6
- handleOfficerGetEmployee(session, payload) → single stripped employee, returns not_found if archived
- handleOfficerGetEquipment(session, payload) → same for equipment, not_found if rejected

Wire into Main.gs. All three require session.user.role === 'officer'; else forbidden.
```

**Tests for Step 8.1:**
- [ ] Create an officer user in Settings → Users
- [ ] After they change password: POST login → get officer token
- [ ] POST officer_sync with that token → returns full snapshot with:
      - No users array, no password_hashes anywhere
      - No _link fields on any employee cert
      - No comments on equipment
      - No history tabs
      - Only non-archived employees + non-rejected equipment
      - derived block present on every entity
- [ ] Try any admin action with officer token → forbidden

## Step 8.2 — Officer frontend

**Prompt:**
```
Read CLAUDE.md Section 7 and design/officer_prototype.html.

Build js/modules/officer/:

1. staleCheck.js — isCacheStale() reads synced_at from IndexedDB, compares to
   max_stale_hours from cached snapshot. Returns true if beyond threshold.

2. cache.js — IndexedDB helpers for 'ohsp-officer' DB, 'kv' store:
   - openDb(), cacheGet(key), cacheSet(key, value), cacheClear()
   - loadSnapshot() → returns snapshot from cache or null
   - saveSnapshot(snapshot) → stores + updates synced_at

3. dataActions.js:
   - officerLogin(username, password) → api.call('login', ...) [same as admin]
     but stores session token in sessionStorage (mobile exception, Section 7.2)
   - officerSync() → api.call('officer_sync'), saves to cache
   - officerGetEmployee(id) → live fetch; used by Refresh button
   - officerGetEquipment(id) → same
   - officerLogout() → clear sessionStorage, cacheClear(), go to login

4. pages:
   - officerLoginPage.js — mobile-styled login card
   - officerHomePage.js — search + Recent list + sync strip
   - officerVerdictEmployeePage.js — reads employee from cache by id, renders verdict card
     Refresh button top-right calls officerGetEmployee → updates cache + display
   - officerVerdictEquipmentPage.js — same for equipment
   - officerSyncPage.js — reachable from sync strip; big Sync button
   - officerLockedPage.js — stale lockout screen with sync button

5. officerShell.js:
   - renderOfficerShell(pageBody) — phone frame + navy header + sync strip
   - Sync strip skipped on login and lockout pages

6. Update render.js:
   - If CURRENT_USER.role === 'officer' → render officer shell

7. Update router.js:
   - Register officer routes from officer manifest
   - Every officer route except 'check' (login) and 'check/sync' checks isCacheStale()
     → if stale, redirect to 'check/locked'

8. Officer search:
   - Combines employee.searchEntities(query, snapshot) and equipment.searchEntities
   - Each module's manifest.officer.searchEntities returns array of
     { kind, id, primary_text, secondary_text, verdict }
   - Home page renders unified results list; tap → go to check/{kind}/{id}

Add manifest.officer to each module's manifest.js:
- searchEntities(query, snapshot) — case-insensitive substring match on name/national_id
  for employees, on serial_no/third_party_sn/item for equipment
- renderVerdictCard(entityId, snapshot) — the verdict page body
- entityKind: 'employee' | 'equipment'
```

**Tests for Step 8.2:**
- [ ] Log in as officer on a mobile browser (or narrow the browser window)
- [ ] Mobile shell renders, no sidebar
- [ ] Sync completes automatically after login
- [ ] Search for an employee name → results appear from cache
- [ ] Tap → verdict card renders instantly (cache-first)
- [ ] Refresh button → fetches fresh, updates display
- [ ] Search for equipment serial number → equipment results
- [ ] Tap equipment → verdict card
- [ ] Close browser, reopen the officer URL → still logged in (sessionStorage), still synced
- [ ] Sign out → cache cleared, back to login
- [ ] Manually delete synced_at from IndexedDB and set to 4 days ago (or lower max_stale_hours to 1 in Settings, then re-sync) → any navigation → lockout screen
- [ ] Sync from lockout → unlocked

---

# Stage 9 — Bilingual + RTL Audit + Deploy

## Step 9.1 — Audit

**Prompt:**
```
Read CLAUDE.md Section 8.

Audit every page in both admin and officer apps in both languages:
- Every string uses t('key')
- Every key exists in both en.js and ar.js
- RTL flips correctly: sidebar on the right, text right-aligned, active borders on
  the correct inline side
- All CSS uses logical properties (margin-inline-start, etc.); no margin-left etc.
- Verdict hero card in Arabic: back button on the correct side, layout correct
- Sync strip in Arabic: button on the correct side

Run: const missing = Object.keys(en).filter(k => !(k in ar)); console.log(missing)
Should return [].
Same the other way: keys in ar not in en.
```

**Tests for Step 9.1:**
- [ ] Every page — switch to Arabic — all text switches
- [ ] Switch back to English — all text switches back
- [ ] No hardcoded English or Arabic strings visible in either mode
- [ ] Language persists after refresh (localStorage.ohsp_lang)
- [ ] Officer app fully bilingual + RTL correct

## Step 9.2 — Deploy

**Prompt:**
```
Read CLAUDE.md deployment notes.

1. Commit and push everything to `main` in the ohs-platform GitHub repo
2. GitHub → Settings → Pages → Deploy from a branch → main, / (root)
3. Wait ~1 minute
4. Verify:
   - https://[username].github.io/ohs-platform/ loads
   - Fresh device: prompted for Apps Script URL, then login
   - Officers use the same URL — the app renders the mobile shell automatically

No build script, no gh-pages branch. Push and it deploys.
```

**Tests for Step 9.2:**
- [ ] Admin URL loads on the live GitHub Pages URL
- [ ] Officer login on a real phone browser: mobile shell renders
- [ ] CDN scripts load on the live URL (Network tab shows 200s)
- [ ] Apps Script URL entered once per device, then persists

---

# Stage 10 — Full QA Checklist

Complete every item before cutting over from OHS-DB. Do not skip.

## Auth and sessions
- [ ] Bootstrap login works, forced password change happens
- [ ] After password change: normal login flow works
- [ ] Wrong password → clear error
- [ ] Inactive user → clear error
- [ ] Officer trying admin routes → redirected to officer home
- [ ] Admin trying officer routes → redirected to dashboard
- [ ] 8-hour token expiry: manually set expires_at to yesterday in Sessions tab → next action returns unauthenticated
- [ ] Single active session: login on browser A, then login on browser B → browser A's next action = unauthenticated
- [ ] Reset user's own password: current password verified; sessions except current invalidated
- [ ] Reset another user's password (super admin): their sessions invalidated, force_password_change=TRUE

## Users and permissions
- [ ] Only super admin sees Settings → Users
- [ ] Only super admin can call user actions (module admin gets forbidden)
- [ ] Cannot delete/demote/deactivate the last super admin
- [ ] Module admin with can_view but not can_edit: sees data, all edit buttons hidden, direct API calls to edit actions return forbidden
- [ ] Module admin with permissions on only one module sees only that module's sidebar group

## Employees module
- [ ] Add, edit, archive, unarchive, delete flows work
- [ ] Cert expiry changes create RenewalHistory rows
- [ ] Duplicates on national_id blocked
- [ ] Excel import: preview shows correct counts, duplicates flagged, unknowns auto-add if enabled
- [ ] RDT page eligibility respects MCU expiry (only non-expired MCU are eligible)
- [ ] Renewals page sorted correctly

## Equipment module
- [ ] Add, edit, reject, unreject flows work
- [ ] Inspection date changes create InspectionHistory rows
- [ ] Duplicates on serial_no or third_party_sn blocked
- [ ] Team leader link: employee detail shows assigned equipment
- [ ] Archiving an employee: their equipment still visible, flagged "owner archived" warning

## Verdicts (server-derived)
- [ ] Employee with expired MCU → blocked
- [ ] Employee with WAH in 20 days → warning
- [ ] Employee with all valid + Active + Approved → cleared
- [ ] Equipment rejected → blocked
- [ ] Equipment third-party expired → blocked
- [ ] Equipment latest wave = fail → blocked
- [ ] Equipment empty third-party date → warning (not blocked)
- [ ] Equipment third-party in 20 days → warning

## Officer app
- [ ] Officer login + sync succeeds
- [ ] Search finds employees + equipment
- [ ] Verdict card matches admin verdict for the same entity
- [ ] Refresh button pulls fresh from server
- [ ] Cached view survives session expiry (with cache < max_stale_hours)
- [ ] Cache stale (>max_stale_hours) → lockout screen, cannot bypass
- [ ] Officers never see users, passwords, comments, history, file links
- [ ] Sign out clears cache

## Dashboard, Settings, Export
- [ ] Dashboard KPIs and charts match Sheet data
- [ ] Settings → Users management works end-to-end
- [ ] Settings → Lists: adding an option reflects in employee/equipment forms
- [ ] Settings → Thresholds: changing urgent_days recalculates dashboard
- [ ] Export Excel + CSV + PDF work with caps enforced

## Bilingual + RTL
- [ ] Every screen translates in both directions
- [ ] RTL layout correct everywhere
- [ ] Language persists after refresh

## Cross-cutting
- [ ] No hardcoded Apps Script URL in code
- [ ] No hardcoded Sheet ID anywhere except Apps Script
- [ ] No password ever appears in plain text (network, storage, Sheet)
- [ ] Session token never in localStorage on admin; only sessionStorage on officer
- [ ] Frontend permission checks are UX only — direct API calls with insufficient permissions always fail server-side

---

# Stage 11 — Cutover from OHS-DB

**Goal:** Migrate data from OHS-DB JSON to OHS Platform Sheet, deploy, retire OHS-DB.

## Step 11.1 — Data migration

**Prompt:**
```
Write a one-time Apps Script function migrateFromOhsDb(jsonString) that:

1. Parses the OHS-DB JSON file (from the last export)
2. For each user in the JSON:
   - If username matches an existing Users row, skip
   - Else insert into Users with new user_id, appropriate role, force_password_change=TRUE
3. For each employee:
   - Convert the nested certificates object to flat cert_*_expiry + cert_*_link columns
   - Insert into Employees with new employee_id (LM-EMP-####)
   - Convert renewal_history entries into RenewalHistory rows
4. For each list in meta.field_options:
   - Insert missing options into FieldOptions
5. Report counts at the end

Do NOT run this on the live Sheet blindly. Run in a test tab first, verify, then move
data over. Set Config.next_employee_number correctly after migration.

Equipment starts empty — Landmark doesn't have historical equipment data yet.
```

**Tests for Step 11.1:**
- [ ] Run migration on a test copy of the Sheet
- [ ] Count of imported employees matches OHS-DB export
- [ ] All renewal_history entries migrated
- [ ] Spot-check 3 random employees: all cert dates, links, personal info intact
- [ ] Log in with a migrated user (after admin reset for the initial password) → they can see their data

## Step 11.2 — Go live

- [ ] Announce cutover date to the team (1 week notice)
- [ ] Freeze OHS-DB edits 24h before cutover
- [ ] Export final OHS-DB JSON
- [ ] Run migration on real Sheet
- [ ] Reset all migrated user passwords → force change on first login
- [ ] Send the OHS Platform URL to the team (+ Apps Script URL for first-time setup on their devices)
- [ ] For officers: help each one enter the Apps Script URL and log in
- [ ] Mark the OHS-DB repo README as LEGACY
- [ ] Point OHS-DB's index to a redirect notice: "Moved to OHS Platform → [link]"

---

*Keep this file open while building. Check off every item as you go.*
*If a test fails, fix it before moving to the next step.*
*Never skip the Stage 10 QA checklist — it catches cross-feature issues.*
*If Claude Code goes off-plan, paste the relevant CLAUDE.md section and say: follow this exactly.*
*If Claude Code suggests installing an npm package, stop it and demand a CDN or plain-JS alternative.*
