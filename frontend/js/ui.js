/* ==========================================================================
   UI HELPERS — escaping, toast, bottom sheet, small shared components.
   All text from the API is passed through esc() before it goes into HTML.
   ========================================================================== */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

let toastTimer;
export function toast(message, kind = 'ok') {
  const el = document.getElementById('bmToast');
  if (!el) return;
  el.querySelector('.toast-msg').textContent = message;
  el.classList.toggle('error', kind === 'error');
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 3600 : 2400);
}

export function openSheet(title, bodyHtml) {
  document.getElementById('sheetTitle').textContent = title;
  document.getElementById('sheetBodyContent').innerHTML = bodyHtml;
  document.getElementById('sheetBackdrop').classList.add('active');
  document.getElementById('mainBottomSheet').classList.add('active');
}

export function closeSheet() {
  document.getElementById('sheetBackdrop')?.classList.remove('active');
  document.getElementById('mainBottomSheet')?.classList.remove('active');
}

export const sheetOpen = () => document.getElementById('mainBottomSheet')?.classList.contains('active');

/** Disables a button and shows a spinner while `fn` runs. */
export async function busy(button, fn) {
  if (!button || button.disabled) return;
  const html = button.innerHTML;
  button.disabled = true;
  button.classList.add('is-busy');
  button.innerHTML = `<span class="bm-spinner"></span>`;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
    button.innerHTML = html;
  }
}

/** Form values as an object (trimmed strings). */
export function formData(form) {
  return Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
}

export function showFieldError(form, message) {
  let el = form.querySelector('.form-error');
  if (!el) {
    el = document.createElement('p');
    el.className = 'form-error';
    form.querySelector('button[type="submit"]')?.before(el);
  }
  el.textContent = message;
  el.hidden = !message;
}

export const back = () => `
  <button class="back-btn-circle" aria-label="Back">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m15 18-6-6 6-6"/></svg>
  </button>`;

/** Standard light header used by every secondary screen. */
export function header(title, { backBtn = true, right = '' } = {}) {
  return `
    <div class="screen-header">
      <div class="screen-header-left">${backBtn ? back() : ''}<h2 class="screen-title">${esc(title)}</h2></div>
      ${right ? `<div class="screen-header-right">${right}</div>` : ''}
    </div>`;
}

export const chevron = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>`;

export function listItem({ icon, title, right = '', attrs = '', danger = false }) {
  return `
    <div class="grouped-list-item" ${attrs}>
      <div class="grouped-item-left">
        <div class="grouped-item-icon" ${danger ? 'style="background: var(--color-danger-bg); color: var(--color-danger);"' : ''}>${icon}</div>
        <span class="grouped-item-title" ${danger ? 'style="color: var(--color-danger); font-weight: 600;"' : ''}>${esc(title)}</span>
      </div>
      <div class="grouped-item-right">${right}${danger ? '' : chevron}</div>
    </div>`;
}

export function emptyState(title, text, action = '') {
  return `
    <div class="bm-empty">
      <div class="bm-empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>
      </div>
      <h4>${esc(title)}</h4>
      <p>${esc(text)}</p>
      ${action}
    </div>`;
}

export const skeleton = (lines = 3) =>
  `<div class="bm-card bm-skeleton-card">${Array.from({ length: lines }, (_, i) => `<div class="bm-skeleton" style="width: ${90 - i * 18}%"></div>`).join('')}</div>`;

export function errorCard(message, retryAction) {
  return `
    <div class="bm-card bm-error-card">
      <p>${esc(message)}</p>
      ${retryAction ? `<button class="btn-soft" data-act="${retryAction}">Try again</button>` : ''}
    </div>`;
}

/** Six single-digit boxes that behave as one code field (paste, backspace, auto-advance). */
export function otpInput(name = 'code') {
  return `
    <div class="otp-row" data-otp="${name}">
      ${Array.from({ length: 6 }, (_, i) => `<input class="otp-box" inputmode="numeric" autocomplete="${i === 0 ? 'one-time-code' : 'off'}" ${i === 0 ? 'maxlength="6"' : 'maxlength="1"'} aria-label="Digit ${i + 1}">`).join('')}
      <input type="hidden" name="${name}">
    </div>`;
}

export function bindOtp(root) {
  root.querySelectorAll('[data-otp]').forEach((row) => {
    const boxes = [...row.querySelectorAll('.otp-box')];
    const hidden = row.querySelector('input[type="hidden"]');
    const sync = () => {
      hidden.value = boxes.map((b) => b.value).join('');
    };
    const fill = (from, digits) => {
      digits.split('').forEach((d, j) => {
        if (boxes[from + j]) boxes[from + j].value = d;
      });
      sync();
      boxes[Math.min(from + digits.length, 5)].focus();
      if (hidden.value.length === 6) row.closest('form')?.requestSubmit();
    };
    boxes.forEach((box, i) => {
      box.addEventListener('input', () => {
        const digits = box.value.replace(/\D/g, '');
        // Several digits at once = the phone auto-filled the emailed code (or fast typing).
        if (digits.length > 1) return fill(i, digits.slice(0, 6 - i));
        box.value = digits;
        if (box.value && i < 5) boxes[i + 1].focus();
        sync();
        if (hidden.value.length === 6) row.closest('form')?.requestSubmit();
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && i > 0) boxes[i - 1].focus();
      });
      box.addEventListener('paste', (e) => {
        const digits = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        if (!digits) return;
        e.preventDefault();
        fill(0, digits);
      });
    });
    setTimeout(() => boxes[0]?.focus({ preventScroll: true }), 400);
  });
}
