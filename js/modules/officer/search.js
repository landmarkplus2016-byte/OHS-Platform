/* ==========================================================================
   officer/search.js — one search box across every module (Section 5.6).

   The officer types once and sees employees and equipment in a single list. The
   officer app does not know what an employee is, or what a serial number is: it
   asks every registered manifest for matches through the `officer` block and
   merges what comes back.

   The contract a module implements (Section 5.2, `manifest.officer`):

     entityKind        'employee' | 'equipment' — the middle segment of the
                       route '#/check/{kind}/{id}'
     searchEntities    (query, snapshot) → [{kind, id, primary_text,
                       secondary_text, verdict, avatar?}]
     findEntity        (id, snapshot) → one result object, or null
     renderVerdictCard (entityId, snapshot) → HTML for the verdict page body

   `findEntity` is what the Recent list resolves through. It stores {kind, id}
   only, so a record whose verdict changed since it was last opened shows the
   new one rather than a remembered dot. `avatar` is optional — see the officer
   home page for what it is for.

   Adding vehicles to the officer app is that block in the vehicles manifest and
   nothing else — no change here, no change to the home page, no change to the
   router.
   ========================================================================== */

import { getModules } from '../../router.js';
import { getPendingWaves } from './outbox.js';

/**
 * How many results the home page will show. A field officer searching a name
 * wants the three people it could be, not two hundred rows to scroll; anything
 * past this many means the query is too short to be useful yet.
 */
export const MAX_RESULTS = 20;

/**
 * Every manifest that contributes to the officer app, in registration order.
 *
 * @returns {Array<Object>} the `officer` blocks, each with its module name
 */
export function officerContributors() {
  return getModules()
    .filter((manifest) => manifest && manifest.officer && manifest.officer.entityKind)
    .map((manifest) => ({ moduleName: manifest.name, ...manifest.officer }));
}

/**
 * The contributor that owns an entity kind, or null.
 *
 * @param {string} kind 'employee' | 'equipment'
 * @returns {Object|null}
 */
export function contributorFor(kind) {
  return officerContributors().find((entry) => entry.entityKind === kind) || null;
}

/**
 * Search every module and merge the results (Section 5.6).
 *
 * Ordering is by module registration order, then by whatever order each module
 * returned — employees before equipment, because an officer at a gate is
 * checking a person far more often than a harness, and the person should not be
 * below the fold.
 *
 * A module that throws is skipped with a console error rather than taking the
 * search down: one broken contributor must not blank the whole result list.
 *
 * @param {string} query raw text from the search box
 * @param {Object|null} snapshot the cached snapshot
 * @returns {Array<{kind, id, primary_text, secondary_text, verdict}>}
 */
export function searchAllEntities(query, snapshot) {
  const trimmed = String(query || '').trim();
  if (!trimmed || !snapshot) return [];

  const results = [];

  for (const contributor of officerContributors()) {
    if (typeof contributor.searchEntities !== 'function') continue;

    try {
      const matches = contributor.searchEntities(trimmed, snapshot) || [];
      results.push(...matches);
    } catch (err) {
      console.error('[officer] search failed in module "' + contributor.moduleName + '":', err);
    }

    if (results.length >= MAX_RESULTS) break;
  }

  return results.slice(0, MAX_RESULTS);
}

/**
 * Resolve one entity to the same result shape the search returns, for the
 * Recent list — which stores {kind, id} only and re-reads the rest from the
 * snapshot, so a record that changed since it was last viewed shows its current
 * verdict rather than a remembered one.
 *
 * @param {{kind: string, id: string}} ref
 * @param {Object|null} snapshot
 * @returns {Object|null} null when the entity is no longer in the snapshot
 */
export function resolveEntity(ref, snapshot) {
  if (!ref || !snapshot) return null;

  const contributor = contributorFor(ref.kind);
  if (!contributor || typeof contributor.findEntity !== 'function') return null;

  try {
    return contributor.findEntity(ref.id, snapshot);
  } catch (err) {
    console.error('[officer] findEntity failed for ' + ref.kind + ' ' + ref.id + ':', err);
    return null;
  }
}

/**
 * The verdict page body for an entity, drawn by the module that owns it.
 *
 * The snapshot handed to the card carries `pending_waves` — whatever this phone
 * has queued and not yet sent (outbox.js). It is injected here rather than
 * imported by the card, because rule 12 keeps a domain module out of the officer
 * module's folder: the officer app owns the queue, and a module's card only
 * draws what it is given.
 *
 * A module with nothing queued sees an empty array, which is what every module
 * except equipment will always see for now.
 *
 * @param {string} kind
 * @param {string} entityId
 * @param {Object|null} snapshot
 * @returns {string|null} HTML, or null when no module owns this kind
 */
export function renderVerdictCardFor(kind, entityId, snapshot) {
  const contributor = contributorFor(kind);
  if (!contributor || typeof contributor.renderVerdictCard !== 'function') return null;

  // A shallow copy, so the pending list never gets written into the cached
  // snapshot and persisted to IndexedDB alongside the server's data.
  const withPending = { ...(snapshot || {}), pending_waves: getPendingWaves() };

  return contributor.renderVerdictCard(entityId, withPending);
}
