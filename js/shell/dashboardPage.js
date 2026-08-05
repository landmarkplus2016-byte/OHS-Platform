/* ==========================================================================
   dashboardPage.js — the admin landing page, composed from module manifests
   (Section 5.5).

   This file knows nothing about employees or equipment. It walks the registered
   manifests, keeps the ones the user may view, and asks each for its KPI row
   and its chart row. Adding vehicles later changes nothing here: the module
   ships a `dashboard` block in its manifest and its section appears.

   ORDER
   -----
   Vertical, module by module, in manifest order — employee KPIs, employee
   charts, then equipment KPIs, equipment charts. Sections are not interleaved:
   a KPI row and the charts under it answer the same question, and splitting
   them across modules would put "Certificates expired" next to a chart about
   inspection dates.

   PERMISSIONS
   -----------
   canView() gates each section. UX only — the Apps Script re-checks
   list_employee_stats and list_equipment_stats on its own (rule 5). A module
   admin with one grant sees one section; a user with none sees the empty state
   rather than a bare page.
   ========================================================================== */

import { CURRENT_USER } from '../state.js';
import { getModules } from '../router.js';
import { canView } from '../utils/permissions.js';
import { t } from '../i18n/i18n.js';
import { escapeHtml } from '../utils/format.js';

/**
 * The manifests contributing a dashboard section to the current user, in the
 * order main.js registered them.
 *
 * A manifest qualifies when it declares a `dashboard` block AND names a
 * permission module the user can view. The officer manifest fails the second
 * test — it has no permission module — which is correct: officers never reach
 * this page (router guard 4), and no admin wants the officer app's search on
 * their dashboard.
 *
 * @returns {Array<Object>} manifests
 */
function visibleSections() {
  return getModules().filter((manifest) => {
    if (!manifest || !manifest.dashboard) return false;
    return !!manifest.name && canView(manifest.name);
  });
}

/**
 * One module's block: its KPI row, then its charts. Either slot may be absent —
 * a module with KPIs and no charts is a legitimate manifest.
 *
 * @param {Object} manifest
 * @returns {string} HTML
 */
function renderSection(manifest) {
  const dashboard = manifest.dashboard;

  const kpis = typeof dashboard.kpis === 'function' ? dashboard.kpis() : '';
  const charts = typeof dashboard.charts === 'function' ? dashboard.charts() : '';
  if (!kpis && !charts) return '';

  return `
    <section class="dash-section" data-dash-module="${escapeHtml(manifest.name)}">
      <div class="section-head">${escapeHtml(t(manifest.displayNameKey || manifest.name))}</div>
      ${kpis}
      ${charts}
    </section>`;
}

/**
 * The dashboard body.
 *
 * Synchronous, like every other page function — the data each section needs is
 * fetched by that module's own bind (see bindDashboardPageEvents), and the
 * section renders its loading state until it arrives.
 *
 * @returns {string} HTML
 */
export function renderDashboardPage() {
  const sections = visibleSections();

  const body = sections.length
    ? sections.map(renderSection).join('')
    : `<div class="page-placeholder">${escapeHtml(t('dash_no_modules'))}</div>`;

  return `
    <div class="dashboard">
      <div class="page-head">
        <div>
          <div class="page-head-title">${escapeHtml(t('nav_dashboard'))}</div>
          <div class="page-head-sub">${escapeHtml(t('dash_greeting', {
            name: (CURRENT_USER && CURRENT_USER.display_name) || '',
          }))}</div>
        </div>
      </div>

      ${body}
    </div>`;
}

/**
 * Hand each visible section its own container to bind against.
 *
 * A module's bind is where it starts the fetch its render functions display, so
 * this runs on every draw — the module's own load guard makes the repeat calls
 * free once the data is in.
 *
 * A section that throws is logged and skipped rather than taking the other
 * sections down with it: one module's broken dashboard should not blank the
 * dashboards of the modules beside it.
 */
export function bindDashboardPageEvents() {
  const root = document.querySelector('.dashboard');
  if (!root) return;

  visibleSections().forEach((manifest) => {
    if (typeof manifest.dashboard.bind !== 'function') return;

    const section = root.querySelector(`[data-dash-module="${manifest.name}"]`);
    if (!section) return;

    try {
      manifest.dashboard.bind(section);
    } catch (err) {
      console.error('[dashboard] bind failed for module "' + manifest.name + '":', err);
    }
  });
}
