/**
 * HTML templating and layout for the admin panel. Every interpolated value is
 * escaped unless it's already Html (built with `html` or `raw`), so user
 * content (names, support messages) can't inject markup.
 *
 * The look follows the app's design tokens (frontend/css/tokens.css): deep
 * navy / purple surfaces, Plus Jakarta Sans, soft white cards. Charts are
 * server-rendered SVG because the panel's Content-Security-Policy allows no
 * inline scripts.
 */

export class Html {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);

function render(v: unknown): string {
  if (v === null || v === undefined || v === false) return "";
  if (v instanceof Html) return v.value;
  if (Array.isArray(v)) return v.map(render).join("");
  return escape(String(v));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0]!;
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1]!;
  });
  return new Html(out);
}

/** Trusted markup only. */
export const raw = (s: string) => new Html(s);

// ── formatting ───────────────────────────────────────────────────────────
export const sats = (msatOrSats: number, isMsat = true) =>
  `${Math.floor(isMsat ? msatOrSats / 1000 : msatOrSats).toLocaleString("en-US")} sats`;
export const dt = (d?: Date | string | number | null) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "–");
export const day = (d?: Date | string | number | null) => (d ? new Date(d).toISOString().slice(0, 10) : "–");
/** "10-02 07:56" for tight table columns (UTC). */
export const dtShort = (d?: Date | string | number | null) => (d ? new Date(d).toISOString().slice(5, 16).replace("T", " ") : "–");
/** Deleted accounts keep a placeholder email (users/profile.ts); show something readable instead. */
export const userLabel = (email?: string | null, name?: string | null) =>
  !email ? "(unknown)" : email.endsWith("@deleted.bitmine.invalid") ? `Deleted account${name ? ` (${name})` : ""}` : email;
export const usd = (n?: number | null, digits = 2) =>
  n == null || Number.isNaN(n) ? "–" : `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
/** Sats as dollars at the given BTC price (null when the price is unknown). */
export const satsUsd = (s: number, btcUsd: number | null) => (btcUsd ? (s / 1e8) * btcUsd : null);
export const num = (n: number) => n.toLocaleString("en-US");
export const short = (s: string, n = 14) => (s.length > n ? `${s.slice(0, n)}…` : s);

// ── navigation ───────────────────────────────────────────────────────────
const NAV: [string, string, string][] = [
  ["/admin", "Dashboard", "M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z"],
  ["/admin/withdrawals", "Withdrawals", "M12 19V5m0 0-6 6m6-6 6 6"],
  ["/admin/purchases", "Purchases", "M6 6h15l-1.5 9h-12zM6 6 5 3H2m7 18a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"],
  ["/admin/users", "Users", "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m14-10a4 4 0 1 0-8 0 4 4 0 0 0 8 0zm6 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"],
  ["/admin/support", "Support", "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  ["/admin/settings", "Economics", "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"],
  ["/admin/products", "Products", "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"],
  ["/admin/content", "FAQs & app", "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5z"],
  ["/admin/announce", "Announce", "M3 11l18-5v12L3 14v-3zm0 0v3a3 3 0 0 0 3 3h1"],
  ["/admin/audit", "Audit log", "M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"],
];

const icon = (d: string) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`);

const CSS = `
:root{--navy:#0B0A18;--purple:#6D35F5;--violet:#8B4DFF;--lav:#F0EAFE;--lav-b:#E4D8FD;--page:#F7F7FA;--card:#fff;--ink:#171622;--muted:#858394;--faint:#A3A1B2;--line:#EAEAEF;--good:#12B76A;--good-bg:#E8F8F0;--bad:#F04438;--bad-bg:#FEE4E2;--warn:#F79009;--warn-bg:#FEF0C7;--hero:linear-gradient(155deg,#0B0A18 0%,#160B30 45%,#25105C 100%);--grad:linear-gradient(135deg,#5B2BE8 0%,#8B4DFF 100%);--r:18px;--shadow:0 4px 18px -2px rgba(23,22,34,.05),0 2px 6px -1px rgba(23,22,34,.02)}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--page);color:var(--ink);font:14px/1.45 'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;min-height:100vh}
a{color:var(--purple);text-decoration:none}a:hover{text-decoration:underline}
h1{font-size:22px;font-weight:800;letter-spacing:-.3px;margin:0}h2{font-size:15px;font-weight:800;margin:0 0 12px}
.side{width:232px;flex-shrink:0;background:var(--hero);color:#fff;padding:22px 14px;position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:18px}
.brand{display:flex;align-items:center;gap:10px;padding:0 8px;font-weight:800;font-size:17px}.brand b{width:34px;height:34px;border-radius:11px;background:var(--grad);display:grid;place-items:center;font-size:17px;box-shadow:0 0 18px rgba(139,77,255,.45)}
.brand small{display:block;font-size:11px;font-weight:600;color:rgba(255,255,255,.55);letter-spacing:.3px}
.nav{display:flex;flex-direction:column;gap:3px}.nav a{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:12px;color:rgba(255,255,255,.72);font-weight:600;font-size:13.5px}.nav a svg{width:17px;height:17px;flex-shrink:0}
.nav a:hover{background:rgba(255,255,255,.07);color:#fff;text-decoration:none}.nav a.on{background:rgba(255,255,255,.12);color:#fff;box-shadow:inset 0 1px 1px rgba(255,255,255,.18)}
.side form{margin-top:auto}.side button{width:100%;background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.14);padding:9px;border-radius:12px;font:inherit;font-weight:700;cursor:pointer}
.main{flex:1;min-width:0;display:flex;flex-direction:column}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 28px 0}.top .sub{color:var(--muted);font-size:12.5px;font-weight:600}
main{padding:18px 28px 60px;display:grid;gap:16px;max-width:1280px;width:100%}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:18px;box-shadow:var(--shadow);overflow-x:auto}
.hero{background:var(--hero);color:#fff;border-radius:24px;padding:22px;position:relative;overflow:hidden}
.hero:before{content:"";position:absolute;width:320px;height:320px;border-radius:50%;background:radial-gradient(circle,rgba(139,77,255,.45),transparent 65%);top:-140px;right:-60px;pointer-events:none}
.hero .grid{position:relative}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px;box-shadow:var(--shadow)}
.kpi small{display:block;color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}.kpi strong{display:block;font-size:22px;font-weight:800;letter-spacing:-.4px;margin-top:4px;font-variant-numeric:tabular-nums}.kpi .note{font-size:12px;color:var(--muted);margin-top:2px;text-transform:none;letter-spacing:0;font-weight:600}
.kpi.glass{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.14);color:#fff;box-shadow:inset 0 1px 1px rgba(255,255,255,.14)}.kpi.glass small,.kpi.glass .note{color:rgba(255,255,255,.65)}
.kpi.good strong{color:var(--good)}.kpi.bad strong{color:var(--bad)}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;color:var(--muted);font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.4px;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:10px;border-bottom:1px solid var(--line);vertical-align:top}td.nowrap,th.nowrap{white-space:nowrap}tr:last-child td{border-bottom:0}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}tr.total td{font-weight:800;background:var(--page)}
.pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11.5px;font-weight:700;background:var(--lav);color:var(--purple);white-space:nowrap}
.pill.good{background:var(--good-bg);color:var(--good)}.pill.bad{background:var(--bad-bg);color:var(--bad)}.pill.warn{background:var(--warn-bg);color:#b45309}.pill.grey{background:#EEF0F3;color:#475467}
form.inline{display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0}
input,select,textarea{font:inherit;padding:8px 11px;border:1px solid #DCD9E8;border-radius:11px;background:#F3F3F8;color:var(--ink)}input:focus,select:focus,textarea:focus{outline:2px solid var(--purple);outline-offset:-1px;background:#fff}
textarea{width:100%;min-height:90px}label{display:grid;gap:5px;font-size:12px;color:var(--muted);font-weight:600}
.form{display:grid;gap:12px;max-width:680px}.row{display:flex;gap:10px;flex-wrap:wrap}.row>label{flex:1;min-width:150px}
button.btn{background:var(--grad);color:#fff;border:0;padding:8px 14px;border-radius:11px;cursor:pointer;font:inherit;font-weight:700;box-shadow:0 6px 16px -4px rgba(109,53,245,.45)}
button.btn.good{background:var(--good);box-shadow:none}button.btn.bad{background:var(--bad);box-shadow:none}button.btn.ghost{background:var(--lav);color:var(--purple);box-shadow:none}
.flash{padding:11px 14px;border-radius:14px;background:var(--lav);border:1px solid var(--lav-b);color:#3b1aa6;font-weight:600}.flash.err{background:var(--bad-bg);border-color:#f5b5ad;color:#912018}
.muted{color:var(--muted)}.mono{font-family:ui-monospace,Consolas,monospace;font-size:12px;word-break:break-all}
.msg{border-left:3px solid var(--line);padding:8px 12px;margin:8px 0;white-space:pre-wrap;border-radius:0 10px 10px 0}.msg.admin{border-color:var(--purple);background:var(--lav)}
.tabs{display:flex;gap:6px;flex-wrap:wrap}.tabs a{padding:6px 12px;border-radius:99px;background:#fff;border:1px solid var(--line);color:var(--ink);font-size:12.5px;font-weight:700}.tabs a.on{background:var(--ink);color:#fff;border-color:var(--ink)}.tabs a:hover{text-decoration:none;border-color:var(--purple)}
.split{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.chart{width:100%;height:auto;display:block}.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted);font-weight:600;margin-top:8px}.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.cardhead{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:12px}.cardhead h2{margin:0}.cardhead a{font-size:12.5px;font-weight:700}
.pager{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
.avatar{width:30px;height:30px;border-radius:10px;background:var(--grad);color:#fff;display:inline-grid;place-items:center;font-weight:800;font-size:12px;margin-right:8px;vertical-align:middle}
@media(max-width:900px){body{flex-direction:column}.side{width:auto;height:auto;position:static;padding:14px;gap:12px}.nav{flex-direction:row;overflow-x:auto;padding-bottom:4px}.nav a{white-space:nowrap;padding:7px 10px}.nav a svg{display:none}.side form{display:none}.top,main{padding-left:16px;padding-right:16px}.split{grid-template-columns:1fr}.hero{border-radius:18px;padding:16px}}
`;

export function layout(opts: { title: string; path: string; csrf?: string; flash?: { kind: "ok" | "err"; text: string } | null; body: Html; subtitle?: string }) {
  const onPath = (href: string) => (href === "/admin" ? opts.path === "/admin" : opts.path.startsWith(href));
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title} · BitMine Admin</title><meta name="robots" content="noindex"><meta name="theme-color" content="#0B0A18">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap">
<style>${raw(CSS)}</style></head><body>
${opts.csrf
  ? html`<aside class="side"><div class="brand"><b>₿</b><div>BitMine<small>ADMIN</small></div></div>
<nav class="nav">${NAV.map(([href, label, d]) => html`<a href="${href}" class="${onPath(href) ? "on" : ""}">${icon(d)}${label}</a>`)}</nav>
<form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="${opts.csrf}"><button>Sign out</button></form></aside>`
  : ""}
<div class="main">${opts.csrf ? html`<div class="top"><div><h1>${opts.title}</h1>${opts.subtitle ? html`<div class="sub">${opts.subtitle}</div>` : ""}</div><div class="sub">${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</div></div>` : ""}
<main>${opts.flash ? html`<div class="flash ${opts.flash.kind === "err" ? "err" : ""}">${opts.flash.text}</div>` : ""}${opts.body}</main></div></body></html>`.value;
}

export const csrfField = (token: string) => html`<input type="hidden" name="_csrf" value="${token}">`;

export function statusPill(status: string) {
  const good = ["paid", "active", "granted", "answered", "verified", "sent"];
  const bad = ["failed", "rejected", "suspended", "deleted", "refunded", "revoked", "needs_reconcile"];
  const warn = ["pending_review", "approved", "sending", "open", "pending"];
  const cls = good.includes(status) ? "good" : bad.includes(status) ? "bad" : warn.includes(status) ? "warn" : "grey";
  return html`<span class="pill ${cls}">${status.replace(/_/g, " ")}</span>`;
}

export const kpi = (label: string, value: string, note?: string, cls = "") =>
  html`<div class="kpi ${cls}"><small>${label}</small><strong>${value}</strong>${note ? html`<small class="note">${note}</small>` : ""}</div>`;

export const initials = (name: string) =>
  name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

// ── charts (SVG, no scripts) ─────────────────────────────────────────────
export interface DayBar {
  label: string;
  /** Stacked upward values (income). */
  up: { value: number; color: string; name: string }[];
  /** Stacked downward values (payouts). */
  down: { value: number; color: string; name: string }[];
}

/** Grouped daily bars: income above the axis, payouts below, with a hover title per segment. */
export function dayChart(days: DayBar[], fmt: (n: number) => string, height = 220): Html {
  const W = 960;
  const padL = 46;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const upMax = Math.max(1e-9, ...days.map((d) => d.up.reduce((s, x) => s + x.value, 0)));
  const downMax = Math.max(0, ...days.map((d) => d.down.reduce((s, x) => s + x.value, 0)));
  const total = upMax + downMax;
  const plotH = height - padT - padB;
  const scale = plotH / (total || 1);
  const zeroY = padT + upMax * scale;
  const n = Math.max(days.length, 1);
  const slot = (W - padL - padR) / n;
  const bw = Math.max(3, Math.min(26, slot * 0.62));
  const parts: string[] = [];
  // grid + axis labels
  for (const frac of [0, 0.5, 1]) {
    const y = padT + (1 - frac) * upMax * scale;
    parts.push(`<line x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#EAEAEF"/>`);
    parts.push(`<text x="${padL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#A3A1B2">${escape(fmt(upMax * frac))}</text>`);
  }
  if (downMax > 0) {
    const y = zeroY + downMax * scale;
    parts.push(`<text x="${padL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#A3A1B2">−${escape(fmt(downMax))}</text>`);
  }
  days.forEach((d, i) => {
    const x = padL + i * slot + (slot - bw) / 2;
    let y = zeroY;
    for (const s of d.up) {
      const h = s.value * scale;
      if (h > 0) parts.push(`<rect x="${x.toFixed(1)}" y="${(y - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${s.color}"><title>${escape(d.label)} · ${escape(s.name)}: ${escape(fmt(s.value))}</title></rect>`);
      y -= h;
    }
    y = zeroY;
    for (const s of d.down) {
      const h = s.value * scale;
      if (h > 0) parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${s.color}"><title>${escape(d.label)} · ${escape(s.name)}: ${escape(fmt(s.value))}</title></rect>`);
      y += h;
    }
    const every = n > 20 ? 5 : n > 10 ? 2 : 1;
    if (i % every === 0 || i === n - 1) {
      parts.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle" font-size="10" fill="#A3A1B2">${escape(d.label.slice(5))}</text>`);
    }
  });
  parts.push(`<line x1="${padL}" x2="${W - padR}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="#171622" stroke-opacity=".35"/>`);
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="Daily chart">${parts.join("")}</svg>`);
}

export const legend = (items: { color: string; name: string }[]) =>
  html`<div class="legend">${items.map((i) => html`<span><i style="background:${i.color}"></i>${i.name}</span>`)}</div>`;
