/* ==========================================================================
   employees/pages/rdtPage.js — random drug testing.

   Two actions, one screen (Section 3.5):
     list_rdt_eligible  who may be tested — active, not archived, MCU not expired
     record_rdt_wave    stamp one wave date across everyone selected

   Eligibility is the server's answer, not a filter applied here. That matters:
   "MCU not expired" is a compliance judgement, and the same rule has to hold
   whether it is asked from this page, the dashboard, or a future export.

   Which waves exist depends on the team — field runs two, safety runs one — so
   the wave selector is rebuilt whenever the team filter changes.
   ========================================================================== */

import { UI } from '../../../state.js';
import { go } from '../../../router.js';
import { render } from '../../../render.js';
import { t } from '../../../i18n/i18n.js';
import { escapeHtml, fmtDate, todayISO } from '../../../utils/format.js';
import { canEdit } from '../../../utils/permissions.js';
import { MODULE_NAMES } from '../../../constants/globals.js';
import { teamBadge } from '../../../components/badge.js';
import { toast, toastSuccess, toastError } from '../../../components/toast.js';
import { confirmDialog } from '../../../components/modal.js';
import { listRdtEligible, recordRdtWave } from '../dataActions.js';
import { TEAMS } from '../constants.js';

/** Wave options per team, with the label shown in the selector. */
const WAVES_BY_TEAM = {
  [TEAMS.FIELD]: [
    { value: 'rdt_1', labelKey: 'emp_rdt_wave_1' },
    { value: 'rdt_2', labelKey: 'emp_rdt_wave_2' },
  ],
  [TEAMS.SAFETY]: [
    { value: 'rdt', labelKey: 'emp_rdt_wave_single' },
  ],
};

function pageState() {
  if (!UI.employeeRdt) {
    UI.employeeRdt = {
      team: TEAMS.FIELD,   // RDT is typically field-only (Section 3.5)
      wave: 'rdt_1',
      date: todayISO(),
      selected: new Set(),

      status: 'idle',
      queryKey: null,
      seq: 0,
      employees: [],
      error: null,
      busy: false,
    };
  }
  return UI.employeeRdt;
}

/** The waves the current team offers, and the one selected. */
function wavesFor(team) {
  return WAVES_BY_TEAM[team] || WAVES_BY_TEAM[TEAMS.FIELD];
}

/* ---------- Data ---------------------------------------------------------- */

async function ensureData() {
  const s = pageState();

  if (s.status === 'loading') return;
  if (s.status !== 'idle' && s.queryKey === s.team) return;

  const mySeq = ++s.seq;
  s.status = 'loading';
  s.queryKey = s.team;
  s.error = null;
  render();

  try {
    const data = await listRdtEligible(s.team);
    if (mySeq !== s.seq) return;

    s.employees = data.employees || [];
    s.status = 'ready';

    // Anyone who dropped out of eligibility is no longer selectable.
    const stillEligible = new Set(s.employees.map((e) => e.employee_id));
    s.selected = new Set([...s.selected].filter((id) => stillEligible.has(id)));
  } catch (err) {
    if (mySeq !== s.seq) return;

    s.status = 'error';
    s.error = err;
    console.error('[employees] rdt eligible load failed:', err);
    toastError(err);
  }

  render();
}

/* ---------- Rendering ----------------------------------------------------- */

function option(value, label, selected) {
  return `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function renderToolbar(s, editable) {
  return `
    <div class="filter-bar">
      <div class="field">
        <label for="rdt-team">${escapeHtml(t('emp_col_team'))}</label>
        <select id="rdt-team" data-filter="team">
          ${option(TEAMS.FIELD, t('team_field'), s.team)}
          ${option(TEAMS.SAFETY, t('team_safety'), s.team)}
        </select>
      </div>

      <div class="field">
        <label for="rdt-wave">${escapeHtml(t('emp_rdt_wave'))}</label>
        <select id="rdt-wave" data-filter="wave" ${editable ? '' : 'disabled'}>
          ${wavesFor(s.team).map((w) => option(w.value, t(w.labelKey), s.wave)).join('')}
        </select>
      </div>

      <div class="field">
        <label for="rdt-date">${escapeHtml(t('emp_rdt_date'))}</label>
        <input id="rdt-date" type="date" data-filter="date"
               value="${escapeHtml(s.date)}" ${editable ? '' : 'disabled'}>
      </div>

      <div class="count">${escapeHtml(t('emp_rdt_selected', { count: s.selected.size }))}</div>

      ${editable ? `
        <button type="button" class="btn btn-ghost btn-sm" data-action="clear"
                ${s.selected.size ? '' : 'disabled'}>${escapeHtml(t('clear_selection'))}</button>
        <button type="button" class="btn btn-primary btn-sm" data-action="record"
                ${s.busy || !s.selected.size ? 'disabled' : ''}>${escapeHtml(t('emp_rdt_record'))}</button>` : ''}
    </div>`;
}

function renderRow(employee, s, editable) {
  const checked = s.selected.has(employee.employee_id);

  return `
    <tr class="${checked ? 'row-selected' : ''}" data-employee-id="${escapeHtml(employee.employee_id)}">
      ${editable ? `
        <td class="cell-check">
          <input type="checkbox" data-select="${escapeHtml(employee.employee_id)}" ${checked ? 'checked' : ''}
                 aria-label="${escapeHtml(employee.name)}">
        </td>` : ''}
      <td>
        <b>${escapeHtml(employee.name)}</b>
        <div class="cell-sub">${escapeHtml(employee.employee_id)}</div>
      </td>
      <td class="cell-mono">${escapeHtml(employee.national_id)}</td>
      <td>${teamBadge(employee.team)}</td>
      <td>${escapeHtml(employee.subcontractor || '—')}</td>
      <td>${escapeHtml(employee.last_rdt_date ? fmtDate(employee.last_rdt_date) : '—')}</td>
      <td data-stop-row-click>
        <button type="button" class="btn btn-ghost btn-sm" data-action="view"
                data-employee-id="${escapeHtml(employee.employee_id)}">${escapeHtml(t('view'))}</button>
      </td>
    </tr>`;
}

export function renderRdtPage() {
  const s = pageState();
  const editable = canEdit(MODULE_NAMES.EMPLOYEES);
  const columnCount = editable ? 7 : 6;

  const head = `
    <div class="page-head">
      <div>
        <div class="page-head-title">${escapeHtml(t('nav_rdt'))}</div>
        <div class="page-head-sub">${escapeHtml(t('emp_rdt_intro'))}</div>
      </div>
    </div>`;

  if (s.status !== 'ready') {
    return `
      <div class="employee-rdt">
        ${head}
        <div class="cell-empty">${escapeHtml(t(s.status === 'error' ? 'err_server_error' : 'loading_data'))}</div>
      </div>`;
  }

  const allSelected = s.employees.length > 0 && s.selected.size === s.employees.length;

  return `
    <div class="employee-rdt">
      ${head}
      ${renderToolbar(s, editable)}

      <table class="tbl">
        <thead>
          <tr>
            ${editable ? `
              <th class="cell-check">
                <input type="checkbox" id="rdt-select-all" ${allSelected ? 'checked' : ''}
                       aria-label="${escapeHtml(t('select_all'))}">
              </th>` : ''}
            <th>${escapeHtml(t('emp_col_name'))}</th>
            <th>${escapeHtml(t('emp_col_national_id'))}</th>
            <th>${escapeHtml(t('emp_col_team'))}</th>
            <th>${escapeHtml(t('emp_col_subcontractor'))}</th>
            <th>${escapeHtml(t('emp_col_last_rdt'))}</th>
            <th>${escapeHtml(t('actions'))}</th>
          </tr>
        </thead>
        <tbody>
          ${s.employees.length
            ? s.employees.map((employee) => renderRow(employee, s, editable)).join('')
            : `<tr><td colspan="${columnCount}" class="cell-empty">${escapeHtml(t('emp_rdt_none_eligible'))}</td></tr>`}
        </tbody>
      </table>
    </div>`;
}

/* ---------- Recording ----------------------------------------------------- */

async function record() {
  const s = pageState();
  if (s.busy) return;

  if (s.selected.size === 0) {
    toast(t('emp_rdt_none_selected'), 'error');
    return;
  }
  if (!s.date) {
    toast(t('emp_rdt_date_required'), 'error');
    return;
  }

  const waveLabel = t((wavesFor(s.team).find((w) => w.value === s.wave) || {}).labelKey || 'emp_rdt_wave');

  // Existing dates for the wave are overwritten server-side, so say so before
  // doing it rather than after.
  const answer = await confirmDialog({
    title: t('emp_rdt_confirm_title'),
    message: t('emp_rdt_confirm_message', {
      count: s.selected.size,
      wave: waveLabel,
      date: fmtDate(s.date),
    }),
    confirmLabel: t('emp_rdt_record'),
  });
  if (!answer) return;

  s.busy = true;
  render();

  try {
    const data = await recordRdtWave([...s.selected], s.wave, s.date);
    toastSuccess(t('emp_rdt_recorded', { count: data.updated }));

    if (data.not_found && data.not_found.length) {
      console.warn('[employees] rdt wave: unknown employee ids', data.not_found);
    }

    s.selected = new Set();
    s.status = 'idle';       // the last-RDT column is stale now
    delete UI.employeeList;  // and so are the team lists' updated_at stamps
  } catch (err) {
    console.error('[employees] record_rdt_wave failed:', err);
    toastError(err);
  } finally {
    s.busy = false;
    render();
  }
}

/* ---------- Events -------------------------------------------------------- */

export function bindRdtPageEvents() {
  const root = document.querySelector('.employee-rdt');
  if (!root) return;

  const s = pageState();
  ensureData();

  root.querySelectorAll('[data-filter]').forEach((el) => {
    el.addEventListener('change', () => {
      const field = el.dataset.filter;
      s[field] = el.value;

      if (field === 'team') {
        // The safety team has no wave 2, and the field team has no bare `rdt`,
        // so a wave carried across teams would stamp the wrong column. Reset to
        // the new team's first wave.
        s.wave = wavesFor(s.team)[0].value;
        s.selected = new Set();
        s.status = 'idle';
      }
      render();
    });
  });

  root.querySelectorAll('[data-select]').forEach((box) => {
    box.addEventListener('change', () => {
      const id = box.dataset.select;
      if (box.checked) s.selected.add(id);
      else s.selected.delete(id);
      render();
    });
  });

  const selectAll = root.querySelector('#rdt-select-all');
  if (selectAll) {
    selectAll.addEventListener('change', () => {
      s.selected = selectAll.checked
        ? new Set(s.employees.map((e) => e.employee_id))
        : new Set();
      render();
    });
  }

  const clear = root.querySelector('[data-action="clear"]');
  if (clear) {
    clear.addEventListener('click', () => {
      s.selected = new Set();
      render();
    });
  }

  const recordBtn = root.querySelector('[data-action="record"]');
  if (recordBtn) recordBtn.addEventListener('click', record);

  root.querySelectorAll('[data-action="view"]').forEach((btn) => {
    btn.addEventListener('click', () => go('employee/:id', { id: btn.dataset.employeeId }));
  });
}
