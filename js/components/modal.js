/* ==========================================================================
   modal.js — dialogs.

   Two exports, both of which resolve rather than calling back. That keeps the
   caller readable:

     const result = await confirmDialog({ ... });
     if (!result) return;            // cancelled
     await archiveEmployee(id, result.value);

   `confirmDialog` asks a yes/no question with at most one text field.
   `formDialog` hosts a form the caller supplies and runs the caller's submit
   against it — used by the settings page's user editor, where the fields are
   too specific to belong in a generic component but the shell around them
   (backdrop, Escape, focus return, busy state) is not.

   Like toasts, both mount on document.body rather than inside #app, so a redraw
   triggered while one is open cannot yank it out from under the user.
   ========================================================================== */

import { t } from '../i18n/i18n.js';
import { escapeHtml } from '../utils/format.js';

/**
 * Open a modal and wait for the user to answer it.
 *
 * @param {Object} options
 * @param {string} options.title        already translated
 * @param {string} [options.message]    already translated
 * @param {string} [options.confirmLabel]
 * @param {string} [options.cancelLabel]
 * @param {boolean} [options.danger]    styles the confirm button as destructive
 * @param {{label: string, placeholder?: string, required?: boolean}} [options.input]
 *        renders one optional text field; its value comes back on confirm
 * @returns {Promise<{value: string}|null>} null when cancelled or dismissed
 */
export function confirmDialog(options) {
  const opts = options || {};

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h3 id="modal-title">${escapeHtml(opts.title || '')}</h3>
        ${opts.message ? `<p class="modal-body">${escapeHtml(opts.message)}</p>` : ''}
        ${opts.input ? `
          <div class="field">
            <label for="modal-input">${escapeHtml(opts.input.label)}</label>
            <input id="modal-input" type="text"
                   placeholder="${escapeHtml(opts.input.placeholder || '')}">
          </div>
          <div class="err" id="modal-err"></div>` : ''}
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-modal="cancel">
            ${escapeHtml(opts.cancelLabel || t('cancel'))}
          </button>
          <button type="button" class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" data-modal="confirm">
            ${escapeHtml(opts.confirmLabel || t('confirm'))}
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const input = overlay.querySelector('#modal-input');
    const errEl = overlay.querySelector('#modal-err');

    // Whoever had focus before the dialog opened gets it back on close, so
    // dismissing with Escape returns the user exactly where they were.
    const previouslyFocused = document.activeElement;

    function close(result) {
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();

      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
      resolve(result);
    }

    function confirm() {
      const value = input ? input.value.trim() : '';

      if (opts.input && opts.input.required && !value) {
        errEl.textContent = t('field_required');
        input.focus();
        return;
      }
      close({ value });
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      } else if (e.key === 'Enter' && document.activeElement === input) {
        e.preventDefault();
        confirm();
      }
    }

    overlay.querySelector('[data-modal="cancel"]').addEventListener('click', () => close(null));
    overlay.querySelector('[data-modal="confirm"]').addEventListener('click', confirm);

    // Click the backdrop, not the card, to dismiss.
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) close(null);
    });

    document.addEventListener('keydown', onKeyDown, true);

    if (input) input.focus();
    else overlay.querySelector('[data-modal="confirm"]').focus();
  });
}

/**
 * Open a form the caller built, and run the caller's submit when it is
 * confirmed.
 *
 * The submit runs *inside* the dialog rather than after it closes, which is the
 * whole point: a server rejecting a duplicate username has to put that message
 * next to the username field, and it cannot do that if the form is already
 * gone. While submit is in flight both buttons are disabled, so a slow Apps
 * Script call cannot be double-submitted.
 *
 *   const saved = await formDialog({
 *     title: t('users_add'),
 *     bodyHtml: userFormHtml(null),
 *     submit: async (root, setError) => {
 *       try { await api.call('create_user', readUserForm(root)); return true; }
 *       catch (err) { setError(err); return false; }
 *     },
 *   });
 *
 * @param {Object} options
 * @param {string} options.title            already translated
 * @param {string} options.bodyHtml         the form's markup; the caller escapes it
 * @param {string} [options.confirmLabel]
 * @param {string} [options.cancelLabel]
 * @param {boolean} [options.wide]          for forms a 460px card cannot hold
 * @param {boolean} [options.danger]        styles the confirm button as destructive
 * @param {function(Element): void} [options.bind]
 *        runs once the form is in the DOM — wire dependent fields here
 * @param {function(Element, function(string): void): Promise<boolean>} options.submit
 *        return true to close, false to stay open; the second argument writes
 *        a message into the dialog's error line
 * @returns {Promise<boolean>} true when submit succeeded, false when dismissed
 */
export function formDialog(options) {
  const opts = options || {};

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    overlay.innerHTML = `
      <div class="modal${opts.wide ? ' modal-wide' : ''}" role="dialog" aria-modal="true"
           aria-labelledby="form-modal-title">
        <h3 id="form-modal-title">${escapeHtml(opts.title || '')}</h3>
        <div class="modal-form">${opts.bodyHtml || ''}</div>
        <div class="err" id="form-modal-err"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-modal="cancel">
            ${escapeHtml(opts.cancelLabel || t('cancel'))}
          </button>
          <button type="button" class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" data-modal="confirm">
            ${escapeHtml(opts.confirmLabel || t('save'))}
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const form = overlay.querySelector('.modal-form');
    const errEl = overlay.querySelector('#form-modal-err');
    const cancelBtn = overlay.querySelector('[data-modal="cancel"]');
    const confirmBtn = overlay.querySelector('[data-modal="confirm"]');
    const confirmLabel = confirmBtn.textContent;

    const previouslyFocused = document.activeElement;
    let busy = false;

    function close(result) {
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();

      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
      resolve(result);
    }

    /** Handed to submit so it can surface a message without closing. */
    function setError(message) {
      errEl.textContent = message || '';
    }

    function setBusy(next) {
      busy = next;
      cancelBtn.disabled = next;
      confirmBtn.disabled = next;
      confirmBtn.textContent = next ? t('saving') : confirmLabel;
    }

    async function submit() {
      if (busy || typeof opts.submit !== 'function') return;

      setError('');
      setBusy(true);

      let ok = false;
      try {
        ok = await opts.submit(form, setError);
      } catch (err) {
        // submit is supposed to handle its own failures; anything escaping it
        // is a bug, and swallowing it would leave the dialog looking hung.
        console.error('[modal] formDialog submit threw:', err);
        setError(t('err_server_error'));
      } finally {
        setBusy(false);
      }

      if (ok) close(true);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        close(false);
      }
    }

    cancelBtn.addEventListener('click', () => {
      if (!busy) close(false);
    });
    confirmBtn.addEventListener('click', submit);

    // Enter submits from any single-line field, but not from a textarea, where
    // it means a new line.
    form.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.target.tagName === 'TEXTAREA') return;

      e.preventDefault();
      submit();
    });

    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay && !busy) close(false);
    });

    document.addEventListener('keydown', onKeyDown, true);

    if (typeof opts.bind === 'function') opts.bind(form);

    const firstField = form.querySelector('input, select, textarea');
    if (firstField) firstField.focus();
    else confirmBtn.focus();
  });
}
