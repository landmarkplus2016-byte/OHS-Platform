/* ==========================================================================
   employees/pages/rdtPage.js — the random drug testing programme.

   WHAT THIS SCREEN IS FOR
   -----------------------
   Landmark tests 120% of its eligible workforce per fiscal year: 10% a month
   from April to January covering everyone once, then 10% a month in February
   and March drawn from people already tested. This page runs that programme —
   it draws each month's list, and it records what happened to each pick.

   The admin does not choose who gets tested. That is the entire point: the
   selection is random, and a page that let someone hand-pick the list would
   quietly turn a testing programme into a targeting one. The only per-person
   control is Swap, which re-draws at random from the remaining pool.

   WHERE THE WORK HAPPENS
   ----------------------
   All of it is server-side. `list_rdt_overview` returns the pool, the quota,
   the phase, this month's picks, yearly progress and recent activity in one
   call; this file draws them. The eligibility rules and the shuffle live in
   Rdt.gs so the officer app, the dashboard card and this page can never
   disagree about who is in the pool.

   Three cards, top to bottom: yearly progress, this month's selection, recent
   activity. The full log lives at #/rdt/history.
   ========================================================================== */

import { UI } from '../../../state.js';
import { go } from '../../../router.js';
import { render } from '../../../render.js';
import { t, getLanguage } from '../../../i18n/i18n.js';
import { escapeHtml, fmtDate, todayISO } from '../../../utils/format.js';
import { canEdit, isSuperAdmin } from '../../../utils/permissions.js';
import { MODULE_NAMES } from '../../../constants/globals.js';
import { teamBadge, rdtStatusBadge, rdtResultBadge } from '../../../components/badge.js';
import { toast, toastSuccess, toastError } from '../../../components/toast.js';
import { confirmDialog, formDialog } from '../../../components/modal.js';
import {
  listRdtOverview, generateRdtSelection, updateRdtEntry,
  swapRdtSelection, deleteRdtEntry, updateModuleSettings,
} from '../dataActions.js';
import { RDT_RESULTS } from '../constants.js';
import { openRdtRecordDialog } from '../rdtRecordDialog.js';
import { openRdtImportDialog } from '../rdtImportDialog.js';
import { invalidateRdtHistory } from './rdtHistoryPage.js';

/**
 * Where the 100% mark sits on a bar scaled to the 120% target. The end of the
 * first round is the milestone that matters operationally — everything past it
 * is the repeat phase — so the bar marks it rather than leaving the admin to
 * work out what five sixths of the way along means.
 */
const FIRST_ROUND_MARKER_PCT = (100 / 120) * 100;

/** What the onboarding button seeds. Mirrors RDT_DEFAULTS in Rdt.gs. */
const RDT_SEED_SETTINGS = {
  rdt_enabled: 'TRUE',
  rdt_fiscal_year_start_month: '4',
  rdt_monthly_target_pct: '10',
  rdt_yearly_target_pct: '120',
  rdt_hire_grace_months: '3',
  rdt_repeat_months: '2,3',
};

function pageState() {
  if (!UI.employeeRdt) {
    UI.employeeRdt = {
      status: 'idle',
      seq: 0,
      data: null,
      error: null,
      busy: false,
    };
  }
  return UI.employeeRdt;
}

/** Drop the cached overview so the next render refetches. */
export function invalidateRdt() {
  const s = pageState();
  s.status = 'idle';
  s.data = null;
}

/* ---------- Data ---------------------------------------------------------- */

async function ensureData() {
  const s = pageState();

  if (s.status === 'loading' || s.status === 'ready') return;

  const mySeq = ++s.seq;
  s.status = 'loading';
  s.error = null;
  render();

  try {
    const data = await listRdtOverview();
    if (mySeq !== s.seq) return;

    s.data = data;
    s.status = 'ready';
  } catch (err) {
    if (mySeq !== s.seq) return;

    s.status = 'error';
    s.error = err;
    console.error('[employees] rdt overview load failed:', err);
    toastError(err);
  }

  render();
}

/* ---------- Rendering ----------------------------------------------------- */

/** "August 2026" in the active language. */
function monthLabel(monthIso) {
  const [year, month] = monthIso.split('-').map(Number);
  const locale = getLanguage() === 'ar' ? 'ar-EG' : 'en-GB';

  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, 1));
}

function renderHero(data) {
  const p = data.progress;
  const phaseKey = data.month.is_repeat_phase
    ? 'emp_rdt_phase_repeat'
    : 'emp_rdt_phase_first';

  // The fill is capped at the track while the number beside it keeps the true
  // figure — overshooting the target should read as "done", not as a bar
  // running off the card.
  const barWidth = Math.min(100, p.target_pct);

  return `
    <div class="card rdt-hero">
      <div class="rdt-hero-cols">
        <div>
          <div class="rdt-big">${escapeHtml(String(p.completed_count))}<span> / ${
            escapeHtml(String(p.yearly_target))
          }</span></div>
          <div class="rdt-sub">${escapeHtml(t('emp_rdt_target_progress', { pct: p.target_pct }))}</div>
          <div class="rdt-phase">
            <span class="badge badge-rdt-selected">${escapeHtml(t(phaseKey))}</span>
          </div>
        </div>

        <div class="rdt-facts">
          <div class="rdt-facts-title">${
            escapeHtml(t('emp_rdt_fiscal_year', { label: data.fiscal_year.label }))
          }</div>
          <div class="rdt-fact"><span>${escapeHtml(t('emp_rdt_pool_size'))}</span><b>${
            escapeHtml(String(p.pool_size))
          }</b></div>
          <div class="rdt-fact"><span>${escapeHtml(t('emp_rdt_unique_tested'))}</span><b>${
            escapeHtml(String(p.unique_tested_count))
          }</b></div>
          <div class="rdt-fact"><span>${escapeHtml(t('emp_rdt_coverage'))}</span><b>${
            escapeHtml(t('emp_rdt_pct', { pct: p.coverage_pct }))
          }</b></div>
        </div>
      </div>

      <div class="rdt-progress">
        <div class="rdt-bar-track">
          <div class="rdt-bar-fill" style="inline-size:${barWidth}%"></div>
          <div class="rdt-bar-marker" style="inset-inline-start:${FIRST_ROUND_MARKER_PCT}%"
               title="${escapeHtml(t('emp_rdt_first_round_marker'))}"></div>
        </div>
        <div class="rdt-bar-legend">
          <span>0%</span>
          <span>${escapeHtml(t('emp_rdt_first_round_marker'))} · 100%</span>
          <span>${escapeHtml(t('emp_rdt_pct', { pct: data.settings.yearly_target_pct }))}</span>
        </div>
      </div>
    </div>`;
}

/** Row actions depend on where the entry is in its life. */
function rowActions(entry) {
  const btn = (action, labelKey, cls) => `
    <button type="button" class="btn ${cls || 'btn-ghost'} btn-sm"
            data-rdt-action="${action}" data-log-id="${escapeHtml(entry.log_id)}">${
      escapeHtml(t(labelKey))
    }</button>`;

  if (entry.status === 'selected') {
    return btn('complete', 'emp_rdt_mark_completed', 'btn-primary')
      + btn('miss', 'emp_rdt_mark_missed')
      + btn('swap', 'emp_rdt_swap');
  }
  if (entry.status === 'completed') {
    return btn('edit', 'emp_rdt_edit')
      + btn('revert', 'emp_rdt_revert')
      + btn('delete', 'emp_rdt_delete', 'btn-danger');
  }
  // missed — nothing to correct, only to undo or discard.
  return btn('revert', 'emp_rdt_revert') + btn('delete', 'emp_rdt_delete', 'btn-danger');
}

function renderMonthRow(entry, editable) {
  return `
    <tr>
      <td>
        <b><a class="link-plain" data-employee-id="${escapeHtml(entry.employee_id)}">${
          escapeHtml(entry.name || entry.employee_id)
        }</a></b>
        <div class="cell-sub">${escapeHtml(entry.employee_id)}</div>
      </td>
      <td>${teamBadge(entry.team)}</td>
      <td>${escapeHtml(entry.title || '—')}</td>
      <td>${escapeHtml(entry.test_date ? fmtDate(entry.test_date) : '—')}</td>
      <td>${rdtStatusBadge(entry.status)} ${rdtResultBadge(entry.result)}</td>
      ${editable ? `<td class="rdt-actions">${rowActions(entry)}</td>` : ''}
    </tr>`;
}

function renderMonthCard(data, editable) {
  const s = pageState();
  const quotaLine = t('emp_rdt_quota_line', {
    quota: data.month.quota,
    pool: data.pool.size,
    pct: data.settings.monthly_target_pct,
  });

  // Only worth saying when it actually happened — a zero here is noise.
  const mcuNote = data.pool.mcu_excluded > 0
    ? `<div class="rdt-note">${
        escapeHtml(t('emp_rdt_mcu_excluded', { count: data.pool.mcu_excluded }))
      }</div>`
    : '';

  const head = `
    <div class="rdt-card-head">
      <div>
        <h3>${escapeHtml(t('emp_rdt_this_month'))} · ${escapeHtml(monthLabel(data.month.iso))}</h3>
        <div class="rdt-card-sub">${
          escapeHtml(t(data.month.is_repeat_phase ? 'emp_rdt_phase_repeat' : 'emp_rdt_phase_first'))
        } — ${escapeHtml(quotaLine)}</div>
        ${mcuNote}
      </div>
    </div>`;

  if (!data.this_month.length) {
    return `
      <div class="card rdt-month">
        ${head}
        <div class="rdt-empty">
          <p>${escapeHtml(t('emp_rdt_no_selection'))}</p>
          ${editable ? `
            <button type="button" class="btn btn-primary" data-rdt-action="generate"
                    ${s.busy ? 'disabled' : ''}>${escapeHtml(t('emp_rdt_generate'))}</button>` : ''}
        </div>
      </div>`;
  }

  return `
    <div class="card rdt-month">
      ${head}

      <table class="tbl">
        <thead>
          <tr>
            <th>${escapeHtml(t('emp_col_name'))}</th>
            <th>${escapeHtml(t('emp_col_team'))}</th>
            <th>${escapeHtml(t('emp_col_title'))}</th>
            <th>${escapeHtml(t('emp_rdt_test_date'))}</th>
            <th>${escapeHtml(t('emp_rdt_col_status'))}</th>
            ${editable ? `<th>${escapeHtml(t('actions'))}</th>` : ''}
          </tr>
        </thead>
        <tbody>${data.this_month.map((e) => renderMonthRow(e, editable)).join('')}</tbody>
      </table>

      ${editable ? `
        <div class="rdt-card-foot">
          <button type="button" class="btn btn-ghost btn-sm" data-rdt-action="regenerate"
                  ${s.busy ? 'disabled' : ''}>${escapeHtml(t('emp_rdt_regenerate'))}</button>
        </div>` : ''}
    </div>`;
}

function renderRecentCard(data) {
  const rows = data.recent.length
    ? data.recent.map((entry) => `
        <div class="rdt-recent-row">
          <span class="rdt-recent-when">${escapeHtml(fmtDate(entry.selected_at))}</span>
          <span class="rdt-recent-who">
            <a class="link-plain" data-employee-id="${escapeHtml(entry.employee_id)}">${
              escapeHtml(entry.name || entry.employee_id)
            }</a>
          </span>
          ${rdtStatusBadge(entry.status)}
          ${rdtResultBadge(entry.result)}
        </div>`).join('')
    : `<div class="cell-empty">${escapeHtml(t('emp_rdt_history_empty'))}</div>`;

  return `
    <div class="card">
      <div class="rdt-card-head"><h3>${escapeHtml(t('emp_rdt_recent'))}</h3></div>
      ${rows}
      <div class="rdt-card-foot">
        <button type="button" class="btn btn-ghost btn-sm" data-rdt-action="history">${
          escapeHtml(t('emp_rdt_view_history'))
        }</button>
      </div>
    </div>`;
}

/**
 * Shown when RDT has never been switched on for this dataset.
 *
 * Only a super admin can enable it, because the switch is a ModuleSettings
 * write and Section 3.7 puts those behind super admin — a module admin gets the
 * explanation and who to ask, rather than a button that would fail.
 */
function renderOnboarding() {
  const canEnable = isSuperAdmin();

  return `
    <div class="card rdt-onboard">
      <div class="rdt-onboard-icon" aria-hidden="true">⚗</div>
      <h3>${escapeHtml(t('emp_rdt_enable_title'))}</h3>
      <p>${escapeHtml(t('emp_rdt_enable_body'))}</p>
      ${canEnable
        ? `<button type="button" class="btn btn-primary" data-rdt-action="enable"
                   ${pageState().busy ? 'disabled' : ''}>${escapeHtml(t('emp_rdt_enable_button'))}</button>`
        : `<div class="rdt-note">${escapeHtml(t('emp_rdt_enable_super_admin_only'))}</div>`}
    </div>`;
}

/**
 * The page header, with an optional actions slot.
 *
 * "Record a test" is a page action rather than a month-card one on purpose: the
 * test it records carries its own date and may belong to any month, so hanging
 * it off the card headed "August 2026" would say something untrue about it.
 */
function renderHead(actionsHtml) {
  return `
    <div class="page-head">
      <div>
        <div class="page-head-sub">${escapeHtml(t('emp_rdt_intro'))}</div>
      </div>
      ${actionsHtml ? `<div class="page-head-actions">${actionsHtml}</div>` : ''}
    </div>`;
}

export function renderRdtPage() {
  const s = pageState();

  const head = renderHead('');

  if (s.status !== 'ready') {
    return `
      <div class="employee-rdt">
        ${head}
        <div class="cell-empty">${
          escapeHtml(t(s.status === 'error' ? 'err_server_error' : 'loading_data'))
        }</div>
      </div>`;
  }

  if (!s.data.enabled) {
    return `<div class="employee-rdt">${head}${renderOnboarding()}</div>`;
  }

  const editable = canEdit(MODULE_NAMES.EMPLOYEES);

  return `
    <div class="employee-rdt">
      ${renderHead(editable ? `
        <button type="button" class="btn btn-ghost" data-rdt-action="import"
                ${s.busy ? 'disabled' : ''}>${escapeHtml(t('emp_rdt_import'))}</button>
        <button type="button" class="btn btn-ghost" data-rdt-action="record"
                ${s.busy ? 'disabled' : ''}>${escapeHtml(t('emp_rdt_record'))}</button>` : '')}
      ${renderHero(s.data)}
      ${renderMonthCard(s.data, editable)}
      ${renderRecentCard(s.data)}
    </div>`;
}

/* ---------- Mutations ----------------------------------------------------- */

/**
 * Run a write, then refetch. Every action on this page changes what the numbers
 * above it say, so none of them try to patch the cached overview by hand —
 * there is no version of that which stays right.
 *
 * @param {function(): Promise<*>} work
 * @param {function(*): (string|null)} onSuccess receives the response; return a
 *        message to toast, or null when the caller has already said its piece
 */
async function runAction(work, onSuccess) {
  const s = pageState();
  if (s.busy) return;

  s.busy = true;
  render();

  try {
    const data = await work();
    invalidateRdt();

    // The history page and the dashboard's coverage card read the same log.
    invalidateRdtHistory();
    delete UI.employeeDashboard;

    const message = onSuccess(data);
    if (message) toastSuccess(message);
  } catch (err) {
    console.error('[employees] rdt action failed:', err);

    // The one failure with a real explanation behind it: the pool ran dry, so
    // there is nobody left to swap in. A generic error would leave the admin
    // clicking Swap again.
    if (err && err.code === 'conflict' && err.message === 'no_replacement_available') {
      toast(t('emp_rdt_swap_no_replacement'), 'error');
    } else {
      toastError(err);
    }
  } finally {
    s.busy = false;
    render();
  }
}

/** The one entry the current data holds under this log_id. */
function findEntry(logId) {
  const data = pageState().data;
  if (!data || !data.this_month) return null;
  return data.this_month.find((e) => e.log_id === logId) || null;
}

/**
 * Complete and Edit are one dialog: both capture a date, an outcome and a note.
 * Editing pre-fills from the entry; completing starts at today and `pass`.
 */
async function openCompleteDialog(logId, existing) {
  const isEdit = !!existing;
  const testDate = (existing && existing.test_date) || todayISO();
  const result = (existing && existing.result) || 'pass';
  const notes = (existing && existing.notes) || '';

  const saved = await formDialog({
    title: t(isEdit ? 'emp_rdt_edit_title' : 'emp_rdt_complete_title'),
    bodyHtml: `
      <div class="field">
        <label for="rdt-test-date">${escapeHtml(t('emp_rdt_test_date'))}</label>
        <input id="rdt-test-date" type="date" value="${escapeHtml(testDate)}">
      </div>
      <div class="field">
        <label for="rdt-result">${escapeHtml(t('emp_rdt_result'))}</label>
        <select id="rdt-result">
          ${RDT_RESULTS.map((value) => `
            <option value="${value}"${value === result ? ' selected' : ''}>${
              escapeHtml(t('emp_rdt_result_' + value))
            }</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="rdt-notes">${escapeHtml(t('emp_rdt_notes'))}</label>
        <textarea id="rdt-notes" rows="3" maxlength="500">${escapeHtml(notes)}</textarea>
      </div>`,

    submit: async (root, setError) => {
      const date = root.querySelector('#rdt-test-date').value;
      if (!date) {
        setError(t('emp_rdt_date_required'));
        return false;
      }

      try {
        await updateRdtEntry(logId, {
          status: 'completed',
          test_date: date,
          result: root.querySelector('#rdt-result').value,
          notes: root.querySelector('#rdt-notes').value,
        });
        return true;
      } catch (err) {
        console.error('[employees] update_rdt_entry failed:', err);
        setError(t('err_server_error'));
        return false;
      }
    },
  });

  if (!saved) return;

  invalidateRdt();
  invalidateRdtHistory();
  delete UI.employeeDashboard;
  toastSuccess(t(isEdit ? 'emp_rdt_edited' : 'emp_rdt_completed'));
  render();
}

/** Missed asks only for a reason — there is no date and no result to record. */
async function openMissDialog(logId) {
  const answer = await confirmDialog({
    title: t('emp_rdt_miss_title'),
    message: t('emp_rdt_miss_body'),
    confirmLabel: t('emp_rdt_mark_missed'),
    input: { label: t('emp_rdt_miss_reason'), placeholder: t('emp_rdt_miss_placeholder') },
  });
  if (!answer) return;

  await runAction(
    () => updateRdtEntry(logId, { status: 'missed', notes: answer.value }),
    () => t('emp_rdt_missed')
  );
}

async function confirmAndSwap(logId) {
  const entry = findEntry(logId);

  const answer = await confirmDialog({
    title: t('emp_rdt_swap'),
    message: t('emp_rdt_swap_confirm', { name: (entry && entry.name) || '' }),
    confirmLabel: t('emp_rdt_swap'),
  });
  if (!answer) return;

  await runAction(
    () => swapRdtSelection(logId),
    (data) => t('emp_rdt_swapped', {
      oldName: data.removed_employee_name || '',
      newName: (data.entry && data.entry.name) || '',
    })
  );
}

async function confirmAndRevert(logId) {
  const answer = await confirmDialog({
    title: t('emp_rdt_revert'),
    message: t('emp_rdt_revert_confirm'),
    confirmLabel: t('emp_rdt_revert'),
  });
  if (!answer) return;

  await runAction(
    () => updateRdtEntry(logId, { status: 'selected' }),
    () => t('emp_rdt_reverted')
  );
}

async function confirmAndDelete(logId) {
  const answer = await confirmDialog({
    title: t('emp_rdt_delete'),
    message: t('emp_rdt_delete_confirm'),
    confirmLabel: t('emp_rdt_delete'),
    danger: true,
  });
  if (!answer) return;

  await runAction(() => deleteRdtEntry(logId), () => t('emp_rdt_deleted'));
}

/**
 * Regenerating throws away this month's outstanding picks and draws again.
 * Completed and missed entries survive it — the server refuses to touch them —
 * but the admin is told what is about to go before it goes.
 */
async function confirmAndRegenerate() {
  const answer = await confirmDialog({
    title: t('emp_rdt_regenerate'),
    message: t('emp_rdt_regenerate_confirm'),
    confirmLabel: t('emp_rdt_regenerate'),
  });
  if (!answer) return;

  await generate(true);
}

async function generate(regenerate) {
  await runAction(
    () => generateRdtSelection(regenerate),
    (data) => {
      if (data.created.length) return t('emp_rdt_generated', { count: data.created.length });

      // A draw that picked nobody is not a failure — it usually means everyone
      // eligible has already been tested in this phase — but it has to be said
      // out loud, or the button looks broken.
      toast(t('emp_rdt_no_candidates'), 'error');
      return null;
    }
  );
}

/**
 * Record a test that happened outside the draw.
 *
 * Not routed through runAction: the dialog owns its own submit and error line —
 * a duplicate-date rejection has to land next to the date field, which it cannot
 * do from a toast after the form has closed. All this does is refresh what the
 * write invalidated.
 */
async function recordTest() {
  const saved = await openRdtRecordDialog();
  if (!saved) return;

  invalidateRdt();
  invalidateRdtHistory();
  delete UI.employeeDashboard;
  toastSuccess(t('emp_rdt_completed'));
  render();
}

/**
 * Backfill past tests from a file.
 *
 * The fiscal-year breakdown is toasted rather than buried in the console
 * because it is the one number that says the import landed where it was meant
 * to: a file of two years' history reporting every test under the current year
 * has had its dates misread, and that is worth noticing immediately.
 */
async function importPastTests() {
  const outcome = await openRdtImportDialog();
  if (!outcome) return;

  invalidateRdt();
  invalidateRdtHistory();
  delete UI.employeeDashboard;

  toastSuccess(t('emp_rdt_import_done', {
    added: outcome.added,
    skipped: outcome.skipped,
  }));

  const years = Object.keys(outcome.by_fiscal_year || {}).sort();
  if (years.length) {
    toast(t('emp_rdt_import_years', {
      breakdown: years.map((y) => `${y}: ${outcome.by_fiscal_year[y]}`).join(' · '),
    }), 'info');
  }

  render();
}

async function enableRdt() {
  await runAction(
    () => updateModuleSettings(MODULE_NAMES.EMPLOYEES, RDT_SEED_SETTINGS),
    () => t('emp_rdt_enabled')
  );
}

/* ---------- Events -------------------------------------------------------- */

export function bindRdtPageEvents() {
  const root = document.querySelector('.employee-rdt');
  if (!root) return;

  ensureData();

  const handlers = {
    enable: enableRdt,
    record: recordTest,
    import: importPastTests,
    generate: () => generate(false),
    regenerate: confirmAndRegenerate,
    complete: (logId) => openCompleteDialog(logId, null),
    edit: (logId) => openCompleteDialog(logId, findEntry(logId)),
    miss: openMissDialog,
    swap: confirmAndSwap,
    revert: confirmAndRevert,
    delete: confirmAndDelete,
    history: () => go('rdt/history'),
  };

  root.querySelectorAll('[data-rdt-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const handler = handlers[btn.dataset.rdtAction];
      if (handler) handler(btn.dataset.logId);
    });
  });

  root.querySelectorAll('[data-employee-id]').forEach((link) => {
    link.addEventListener('click', () => go('employee/:id', { id: link.dataset.employeeId }));
  });
}
