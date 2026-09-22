/**
 * Tiny HTML templating for the admin panel. Every interpolated value is
 * escaped unless it's already Html (built with `html` or `raw`), so user
 * content (names, support messages) can't inject markup.
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

export const sats = (msatOrSats: number, isMsat = true) =>
  `${Math.floor(isMsat ? msatOrSats / 1000 : msatOrSats).toLocaleString("en-US")} sats`;
export const dt = (d?: Date | string | number | null) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "–");
export const usd = (n?: number | null) => (n == null ? "–" : `$${n.toFixed(2)}`);

const NAV: [string, string][] = [
  ["/admin", "Dashboard"],
  ["/admin/withdrawals", "Withdrawals"],
  ["/admin/users", "Users"],
  ["/admin/support", "Support"],
  ["/admin/settings", "Economics"],
  ["/admin/products", "Products"],
  ["/admin/content", "FAQs & app"],
  ["/admin/announce", "Announce"],
  ["/admin/audit", "Audit log"],
];

const CSS = `
:root{--bg:#f4f5f7;--card:#fff;--ink:#16181d;--muted:#667085;--line:#e3e6eb;--accent:#c7770a;--good:#157f4f;--bad:#b42318;--warn:#a45b00}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
header{background:#111318;color:#fff;padding:0 20px;display:flex;align-items:center;gap:22px;flex-wrap:wrap}
header b{font-size:15px;letter-spacing:.02em;padding:14px 0;color:#f5a524}
header nav{display:flex;gap:2px;flex-wrap:wrap}header nav a{color:#c9ced6;text-decoration:none;padding:14px 10px;font-size:13px}
header nav a.on,header nav a:hover{color:#fff;box-shadow:inset 0 -2px #f5a524}
header form{margin-left:auto}header button{background:none;border:1px solid #444;color:#ddd;padding:5px 10px;border-radius:6px;cursor:pointer}
main{max-width:1200px;margin:0 auto;padding:22px 16px 60px;display:grid;gap:18px}
h1{font-size:20px;margin:0}h2{font-size:15px;margin:0 0 10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;overflow-x:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
.kpi small{color:var(--muted);display:block;font-size:12px}.kpi strong{font-size:20px;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;color:var(--muted);font-weight:600;font-size:12px;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tr:last-child td{border-bottom:0}a{color:#1d5fd1}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;font-weight:600;background:#eef0f3;color:#344054}
.pill.good{background:#dcf5e7;color:var(--good)}.pill.bad{background:#fde4e1;color:var(--bad)}.pill.warn{background:#fdf0d8;color:var(--warn)}
form.inline{display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap;margin:0}
input,select,textarea{font:inherit;padding:6px 8px;border:1px solid #cfd4dc;border-radius:6px;background:#fff}
textarea{width:100%;min-height:90px}label{display:grid;gap:4px;font-size:12px;color:var(--muted)}
.form{display:grid;gap:10px;max-width:640px}.row{display:flex;gap:10px;flex-wrap:wrap}.row>label{flex:1;min-width:140px}
button.btn{background:var(--ink);color:#fff;border:0;padding:7px 12px;border-radius:6px;cursor:pointer;font-weight:600}
button.btn.good{background:var(--good)}button.btn.bad{background:var(--bad)}button.btn.ghost{background:#eef0f3;color:var(--ink)}
.flash{padding:10px 14px;border-radius:8px;background:#e7f1ff;border:1px solid #bcd4fb}.flash.err{background:#fde4e1;border-color:#f5b5ad}
.muted{color:var(--muted)}.mono{font-family:ui-monospace,Consolas,monospace;font-size:12px;word-break:break-all}
.msg{border-left:3px solid var(--line);padding:6px 10px;margin:8px 0;white-space:pre-wrap}.msg.admin{border-color:var(--accent);background:#fffaf0}
.tabs{display:flex;gap:6px;flex-wrap:wrap}.tabs a{padding:5px 10px;border-radius:99px;background:#eef0f3;text-decoration:none;color:var(--ink);font-size:13px}.tabs a.on{background:var(--ink);color:#fff}
`;

export function layout(opts: { title: string; path: string; csrf?: string; flash?: { kind: "ok" | "err"; text: string } | null; body: Html }) {
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title} · BitMine Admin</title><meta name="robots" content="noindex"><style>${raw(CSS)}</style></head><body>
${opts.csrf
  ? html`<header><b>BitMine Admin</b><nav>${NAV.map(([href, label]) => html`<a href="${href}" class="${(href === "/admin" ? opts.path === "/admin" : opts.path.startsWith(href)) ? "on" : ""}">${label}</a>`)}</nav>
<form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="${opts.csrf}"><button>Sign out</button></form></header>`
  : ""}
<main>${opts.flash ? html`<div class="flash ${opts.flash.kind === "err" ? "err" : ""}">${opts.flash.text}</div>` : ""}${opts.body}</main></body></html>`.value;
}

export const csrfField = (token: string) => html`<input type="hidden" name="_csrf" value="${token}">`;

export function statusPill(status: string) {
  const good = ["paid", "active", "granted", "answered", "verified", "sent"];
  const bad = ["failed", "rejected", "suspended", "deleted", "refunded", "revoked", "needs_reconcile"];
  const warn = ["pending_review", "approved", "sending", "open", "pending"];
  const cls = good.includes(status) ? "good" : bad.includes(status) ? "bad" : warn.includes(status) ? "warn" : "";
  return html`<span class="pill ${cls}">${status.replace(/_/g, " ")}</span>`;
}
