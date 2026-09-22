/* ==========================================================================
   FORMATTING — every number the app shows goes through here.
   Balances arrive from the API in millisatoshis (msat).
   ========================================================================== */

const MSAT_PER_BTC = 1e11;

export const sats = (msat) => Math.floor((msat || 0) / 1000);

export function fmtSats(msat, { unit = true } = {}) {
  const s = sats(msat).toLocaleString('en-US');
  return unit ? `${s} sats` : s;
}

/** Sats with 3 decimals, for tiny amounts that change every second. */
export function fmtSatsPrecise(msat) {
  return `${((msat || 0) / 1000).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} sats`;
}

export function fmtBtc(msat, digits = 8) {
  return `${((msat || 0) / MSAT_PER_BTC).toFixed(digits)} BTC`;
}

export function fmtUsd(msat, btcUsd) {
  if (!btcUsd) return '–';
  const v = ((msat || 0) / MSAT_PER_BTC) * btcUsd;
  if (v > 0 && v < 0.01) return '<$0.01';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtPrice(usd) {
  if (usd == null) return '–';
  if (usd >= 1000) return `$${usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (usd >= 1) return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${usd.toLocaleString('en-US', { maximumSignificantDigits: 3 })}`;
}

export function fmtPct(p) {
  if (p == null || Number.isNaN(p)) return '–';
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
}

export function fmtHash(gh) {
  const v = gh || 0;
  if (v >= 1000) return `${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} TH/s`;
  return `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })} GH/s`;
}

export function fmtCountdown(ms) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${min}m`;
  return `${min}m`;
}

export function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}

export function fmtDay(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (ymd === today) return 'Today';
  if (ymd === yesterday) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return fmtDate(iso);
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || 'B';
}
