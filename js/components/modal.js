/* ==========================================================================
   modal.js — confirmation dialogs.

   One export, `confirmDialog`, which resolves rather than calling back. That
   keeps the caller readable:

     const result = await confirmDialog({ ... });
     if (!result) return;            // cancelled
     await archiveEmployee(id, result.value);

   Like toasts, the dialog mounts on document.body rather than inside #app, so
   a redraw triggered while it is open cannot yank it out from under the user.
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
