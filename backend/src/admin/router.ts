import express, { Router, type Request, type Response } from "express";
import { AppError } from "../lib/errors.js";
import { SupportTicket, User } from "../models/index.js";
import type { SpeedClient } from "../wallet/speed.js";
import { approveWithdrawal, getWithdrawalForAdmin, rejectWithdrawal, resolveReconcile } from "../wallet/withdrawals.js";
import { adminReply, closeTicket } from "../support/service.js";
import { audit, passwordStep, requireAdmin, signOut, totpStep } from "./auth.js";
import { csrfField, dt, html, layout, sats, statusPill, usd, type Html } from "./html.js";
import {
  WITHDRAWAL_STATUSES,
  adjustBalance,
  clearReviewFlags,
  dashboardStats,
  searchUsers,
  setUserStatus,
  userDetail,
  withdrawalQueue,
  type WithdrawalStatus,
} from "./service.js";
import { configPages } from "./configPages.js";

export interface AdminOptions {
  speed?: SpeedClient;
  secureCookies: boolean;
}

/** Renders a signed-in page, with a one-line message from ?ok= / ?err=. */
export function page(req: Request, res: Response, title: string, body: Html) {
  const ok = typeof req.query.ok === "string" ? req.query.ok : null;
  const err = typeof req.query.err === "string" ? req.query.err : null;
  res.type("html").send(
    layout({ title, path: req.baseUrl + req.path, csrf: req.admin!.csrf, flash: err ? { kind: "err", text: err } : ok ? { kind: "ok", text: ok } : null, body }),
  );
}

/** Post/redirect/get with a message. */
export function back(res: Response, path: string, msg: { ok?: string; err?: string }) {
  const q = msg.err ? `err=${encodeURIComponent(msg.err)}` : `ok=${encodeURIComponent(msg.ok ?? "Done.")}`;
  res.redirect(303, `${path}${path.includes("?") ? "&" : "?"}${q}`);
}

/** Runs an admin action; expected errors become a message on the page instead of a 500. */
export function action(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      const msg = err instanceof AppError ? err.message : "Something went wrong. Check the server logs.";
      if (!(err instanceof AppError)) req.log.error({ err }, "admin action failed");
      back(res, (req.get("referer") ?? "/admin").replace(/[?&](ok|err)=[^&]*/g, ""), { err: msg });
    }
  };
}

const f = (req: Request, name: string) => String((req.body as Record<string, unknown>)[name] ?? "").trim();
/** Route parameter as a string. */
export const param = (req: Request, name: string) => String(req.params[name] ?? "");

function loginPage(res: Response, step: "password" | "totp", error?: string) {
  const body =
    step === "password"
      ? html`<div class="card" style="max-width:380px;margin:60px auto"><h1>BitMine Admin</h1><p class="muted">Sign in</p>
         <form method="post" action="/admin/login" class="form">
           <label>Email<input name="email" type="email" autocomplete="username" required></label>
           <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
           <button class="btn">Continue</button></form></div>`
      : html`<div class="card" style="max-width:380px;margin:60px auto"><h1>Authenticator code</h1><p class="muted">Enter the 6-digit code from your authenticator app.</p>
         <form method="post" action="/admin/login/totp" class="form">
           <label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6}" maxlength="6" required autofocus></label>
           <button class="btn">Sign in</button></form></div>`;
  res.type("html").send(layout({ title: "Sign in", path: "/admin/login", flash: error ? { kind: "err", text: error } : null, body }));
}

export function adminRouter(opts: AdminOptions) {
  const r = Router();
  r.use(express.urlencoded({ extended: false, limit: "50kb" }));
  r.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");
    next();
  });

  // ── sign-in ──
  r.get("/login", (_req, res) => loginPage(res, "password"));
  r.post("/login", async (req, res) => {
    const err = await passwordStep(req, res, f(req, "email"), String((req.body as Record<string, string>).password ?? ""), opts.secureCookies);
    if (err) return loginPage(res.status(401), "password", err);
    loginPage(res, "totp");
  });
  r.post("/login/totp", async (req, res) => {
    const err = await totpStep(req, res, f(req, "code"), opts.secureCookies);
    if (err) return loginPage(res.status(401), err.includes("timed out") ? "password" : "totp", err);
    res.redirect(303, "/admin");
  });

  // Everything below needs a full session.
  r.use(requireAdmin);

  r.post("/logout", async (req, res) => {
    await signOut(req, res);
    res.redirect(303, "/admin/login");
  });

  // ── dashboard ──
  r.get("/", async (req, res) => {
    const s = await dashboardStats();
    let speed: Html = html`<p class="muted">Speed isn't configured (SPEED_API_KEY). Payouts are paused.</p>`;
    if (opts.speed?.balances) {
      try {
        speed = html`<pre class="mono">${JSON.stringify(await opts.speed.balances(), null, 2)}</pre>`;
      } catch (err) {
        speed = html`<p class="pill bad">Couldn't reach Speed: ${(err as Error).message}</p>`;
      }
    }
    const kpi = (label: string, value: string, note?: string) => html`<div class="card kpi"><small>${label}</small><strong>${value}</strong>${note ? html`<small>${note}</small>` : ""}</div>`;
    page(req, res, "Dashboard", html`
      <h1>Dashboard</h1>
      ${s.reconcile ? html`<div class="flash err">${s.reconcile} withdrawal(s) need reconciliation. <a href="/admin/withdrawals?status=needs_reconcile">Review now</a></div>` : ""}
      <div class="grid">
        ${kpi("Waiting for review", String(s.pendingReview), "withdrawals")}
        ${kpi("Owed in open withdrawals", sats(s.pendingSats, false))}
        ${kpi("Paid out (24 h / 30 d)", sats(s.paid24h, false), sats(s.paid30d, false) + " in 30 days")}
        ${kpi("Owed to all users", sats(s.liabilitiesMsat), "available + locked balances")}
        ${kpi("Mined (24 h)", sats(s.mined24hMsat))}
        ${kpi("Revenue (24 h)", usd(s.revenue24h), `${s.purchases24h} purchases`)}
        ${kpi("Revenue (30 d)", usd(s.revenue30d), `${s.purchases30d} purchases`)}
        ${kpi("Active users", s.users.toLocaleString("en-US"), `${s.newUsers} new today`)}
        ${kpi("Started mining (24 h)", s.activeToday.toLocaleString("en-US"))}
        ${kpi("Ad claims (24 h)", s.claims24h.toLocaleString("en-US"))}
        ${kpi("Open support requests", String(s.openTickets))}
        ${kpi("Flagged accounts", String(s.flagged), "e.g. refunded purchases")}
      </div>
      <div class="card"><h2>Speed balance</h2><p class="muted">Payouts come from here. Keep it above what's owed in open withdrawals.</p>${speed}</div>`);
  });

  // ── withdrawals ──
  r.get("/withdrawals", async (req, res) => {
    const status = (WITHDRAWAL_STATUSES as readonly string[]).includes(String(req.query.status)) ? (req.query.status as WithdrawalStatus) : "pending_review";
    const rows = await withdrawalQueue(status);
    const tabs = html`<div class="tabs">${WITHDRAWAL_STATUSES.map((st) => html`<a href="?status=${st}" class="${st === status ? "on" : ""}">${st.replace(/_/g, " ")}</a>`)}</div>`;
    const csrf = csrfField(req.admin!.csrf);
    page(req, res, "Withdrawals", html`
      <h1>Withdrawals</h1>${tabs}
      <div class="card"><table><tr><th>Requested</th><th>User</th><th class="num">Amount</th><th>To</th><th>Checks</th><th>Status</th><th>Action</th></tr>
      ${rows.length === 0 ? html`<tr><td colspan="7" class="muted">Nothing here.</td></tr>` : ""}
      ${rows.map(({ w, user, paidCount }) => {
        const ageDays = user?.createdAt ? Math.floor((Date.now() - user.createdAt.getTime()) / 86_400_000) : 0;
        const flags = user?.reviewFlags?.length ?? 0;
        return html`<tr>
          <td>${dt(w.createdAt)}</td>
          <td><a href="/admin/users/${String(w.userId)}">${user?.email ?? String(w.userId)}</a></td>
          <td class="num">${sats(w.amountSats, false)}</td>
          <td class="mono">${w.destinationType === "bolt11" ? w.destination.slice(0, 24) + "…" : w.destination}</td>
          <td>${flags ? html`<span class="pill bad">${flags} flag(s)</span> ` : ""}<span class="pill">${ageDays} d old</span> <span class="pill">${paidCount} paid before</span>
              ${w.lastError ? html`<div class="muted">${w.lastError}</div>` : ""}</td>
          <td>${statusPill(w.status)}</td>
          <td>${w.status === "pending_review" ? html`
              <form class="inline" method="post" action="/admin/withdrawals/${String(w._id)}/approve">${csrf}<button class="btn good">Approve</button></form>
              <form class="inline" method="post" action="/admin/withdrawals/${String(w._id)}/reject">${csrf}<input name="reason" placeholder="Reason shown to user" required minlength="3"><button class="btn bad">Reject</button></form>`
            : w.status === "approved" ? html`<form class="inline" method="post" action="/admin/withdrawals/${String(w._id)}/reject">${csrf}<input name="reason" placeholder="Reason" required minlength="3"><button class="btn bad">Reject</button></form>`
            : w.status === "needs_reconcile" ? html`<form class="inline" method="post" action="/admin/withdrawals/${String(w._id)}/reconcile">${csrf}
                <select name="outcome"><option value="">Checked Speed dashboard…</option><option value="paid">It was paid</option><option value="failed">It wasn't sent (return sats)</option></select>
                <input name="note" placeholder="Note" required minlength="3"><button class="btn">Resolve</button></form>`
            : ""}</td></tr>`;
      })}</table></div>
      ${status === "needs_reconcile" ? html`<div class="card muted">Each of these was sent to Speed but the result is unknown. Search the Speed dashboard for the note <span class="mono">bitmine:&lt;withdrawal id&gt;</span>, then mark it paid or not sent. Sats stay locked until you do.</div>` : ""}`);
  });

  r.post("/withdrawals/:id/approve", action(async (req, res) => {
    const w = await approveWithdrawal(param(req, "id"), req.admin!.id);
    await audit(req.admin!.id, "withdrawal.approve", { type: "withdrawal", id: param(req, "id"), details: { amountSats: w.amountSats } }, req.ip);
    back(res, "/admin/withdrawals", { ok: `Approved ${sats(w.amountSats, false)}. It will be sent within a minute.` });
  }));
  r.post("/withdrawals/:id/reject", action(async (req, res) => {
    const reason = f(req, "reason");
    if (reason.length < 3) throw new AppError(400, "reason_required", "Give the user a reason.");
    await rejectWithdrawal(param(req, "id"), req.admin!.id, reason);
    await audit(req.admin!.id, "withdrawal.reject", { type: "withdrawal", id: param(req, "id"), details: { reason } }, req.ip);
    back(res, "/admin/withdrawals", { ok: "Rejected. The sats are back in the user's balance." });
  }));
  r.post("/withdrawals/:id/reconcile", action(async (req, res) => {
    const outcome = f(req, "outcome");
    if (outcome !== "paid" && outcome !== "failed") throw new AppError(400, "outcome_required", "Choose whether it was paid.");
    await getWithdrawalForAdmin(param(req, "id"));
    await resolveReconcile(param(req, "id"), req.admin!.id, outcome, f(req, "note"));
    await audit(req.admin!.id, "withdrawal.reconcile", { type: "withdrawal", id: param(req, "id"), details: { outcome, note: f(req, "note") } }, req.ip);
    back(res, "/admin/withdrawals?status=needs_reconcile", { ok: outcome === "paid" ? "Marked paid." : "Marked not sent; sats returned." });
  }));

  // ── users ──
  r.get("/users", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const users = await searchUsers(q);
    page(req, res, "Users", html`
      <h1>Users</h1>
      <form method="get" class="inline"><input name="q" value="${q}" placeholder="Email, user id or referral code" size="40"><button class="btn">Search</button></form>
      <div class="card"><table><tr><th>Email</th><th>Name</th><th>Joined</th><th>Status</th><th>Flags</th><th>2FA</th></tr>
      ${users.map((u) => html`<tr><td><a href="/admin/users/${String(u._id)}">${u.email}</a></td><td>${u.name}</td><td>${dt(u.createdAt)}</td>
        <td>${statusPill(u.status ?? "active")}</td><td>${u.reviewFlags?.length ? html`<span class="pill bad">${u.reviewFlags.length}</span>` : ""}</td><td>${u.twoFactor?.enabled ? "on" : ""}</td></tr>`)}
      </table></div>`);
  });

  r.get("/users/:id", action(async (req, res) => {
    const d = await userDetail(param(req, "id"));
    const u = d.user;
    const csrf = csrfField(req.admin!.csrf);
    const id = String(u._id);
    page(req, res, u.email, html`
      <h1>${u.email}</h1>
      <div class="grid">
        <div class="card kpi"><small>Available</small><strong>${sats(d.balance?.availableMsat ?? 0)}</strong></div>
        <div class="card kpi"><small>Locked (withdrawing)</small><strong>${sats(d.balance?.lockedMsat ?? 0)}</strong></div>
        <div class="card kpi"><small>Lifetime mined</small><strong>${sats(d.balance?.lifetimeMinedMsat ?? 0)}</strong></div>
        <div class="card kpi"><small>Referred</small><strong>${d.referred}</strong><small>${d.referrer ? `by ${d.referrer.email}` : ""}</small></div>
      </div>
      <div class="card"><h2>Account</h2>
        <p>${statusPill(u.status ?? "active")} · ${u.name} · joined ${dt(u.createdAt)} · timezone ${u.timezone} · 2FA ${u.twoFactor?.enabled ? "on" : "off"} · referral code <span class="mono">${u.referralCode}</span> · id <span class="mono">${id}</span></p>
        ${u.reviewFlags?.length ? html`<p><span class="pill bad">Review flags</span> ${u.reviewFlags.map((fl) => html`<span class="pill">${fl.reason} ${dt(fl.createdAt)}</span> `)}
          <form class="inline" method="post" action="/admin/users/${id}/clear-flags">${csrf}<button class="btn ghost">Clear flags</button></form></p>` : ""}
        <div class="row">
          ${u.status === "active"
            ? html`<form class="inline" method="post" action="/admin/users/${id}/status">${csrf}<input type="hidden" name="status" value="suspended"><button class="btn bad">Suspend (signs out)</button></form>`
            : u.status === "suspended" ? html`<form class="inline" method="post" action="/admin/users/${id}/status">${csrf}<input type="hidden" name="status" value="active"><button class="btn good">Reactivate</button></form>` : ""}
        </div></div>
      <div class="card"><h2>Adjust balance</h2>
        <form class="inline" method="post" action="/admin/users/${id}/adjust">${csrf}
          <input name="sats" type="number" step="1" placeholder="+/- sats" required><input name="reason" placeholder="Reason (kept in the ledger)" required minlength="5" size="40">
          <button class="btn">Apply</button></form></div>
      <div class="card"><h2>Paid miners</h2><table><tr><th>Started</th><th>Ends</th><th class="num">GH/s</th><th>Source</th><th>Status</th></tr>
        ${d.miners.map((m) => html`<tr><td>${dt(m.startAt)}</td><td>${dt(m.endAt)}</td><td class="num">${m.gh.toLocaleString("en-US")}</td><td>${m.source}</td><td>${statusPill(m.revokedAt ? "revoked" : m.endAt.getTime() > Date.now() ? "active" : "expired")}</td></tr>`)}</table></div>
      <div class="card"><h2>Purchases</h2><table><tr><th>When</th><th>Product</th><th>Store</th><th class="num">Price</th><th>Status</th></tr>
        ${d.purchases.map((p) => html`<tr><td>${dt(p.purchasedAt)}</td><td>${p.productId?.name ?? "?"}</td><td>${p.store}</td><td class="num">${usd(p.priceUsd)}</td><td>${statusPill(p.status ?? "granted")}</td></tr>`)}</table></div>
      <div class="card"><h2>Withdrawals</h2><table><tr><th>When</th><th class="num">Amount</th><th>To</th><th>Status</th></tr>
        ${d.withdrawals.map((w) => html`<tr><td>${dt(w.createdAt)}</td><td class="num">${sats(w.amountSats, false)}</td><td class="mono">${w.destination.slice(0, 30)}</td><td>${statusPill(w.status)}</td></tr>`)}</table></div>
      <div class="card"><h2>Recent ledger</h2><table><tr><th>When</th><th>Type</th><th>Bucket</th><th class="num">Amount</th><th>Note</th></tr>
        ${d.ledger.map((l) => html`<tr><td>${dt(l.createdAt)}</td><td>${l.type}</td><td>${l.bucket}</td><td class="num">${(l.amountMsat / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })} sats</td><td class="muted">${(l.meta as { reason?: string } | undefined)?.reason ?? ""}</td></tr>`)}</table></div>`);
  }));

  r.post("/users/:id/status", action(async (req, res) => {
    const status = f(req, "status") === "suspended" ? "suspended" : "active";
    await setUserStatus(param(req, "id"), status);
    await audit(req.admin!.id, `user.${status === "suspended" ? "suspend" : "reactivate"}`, { type: "user", id: param(req, "id") }, req.ip);
    back(res, `/admin/users/${param(req, "id")}`, { ok: status === "suspended" ? "Suspended and signed out." : "Reactivated." });
  }));
  r.post("/users/:id/clear-flags", action(async (req, res) => {
    await clearReviewFlags(param(req, "id"));
    await audit(req.admin!.id, "user.clear_flags", { type: "user", id: param(req, "id") }, req.ip);
    back(res, `/admin/users/${param(req, "id")}`, { ok: "Flags cleared." });
  }));
  r.post("/users/:id/adjust", action(async (req, res) => {
    const delta = Number(f(req, "sats"));
    const reason = f(req, "reason");
    await adjustBalance(param(req, "id"), delta, reason);
    await audit(req.admin!.id, "user.adjust_balance", { type: "user", id: param(req, "id"), details: { sats: delta, reason } }, req.ip);
    back(res, `/admin/users/${param(req, "id")}`, { ok: `Balance adjusted by ${delta.toLocaleString("en-US")} sats.` });
  }));

  // ── support ──
  r.get("/support", async (req, res) => {
    const status = (["open", "answered", "closed"] as const).find((x) => x === req.query.status) ?? "open";
    const tickets = await SupportTicket.find({ status }).sort({ updatedAt: status === "open" ? 1 : -1 }).limit(100).lean();
    const emails = new Map((await User.find({ _id: { $in: tickets.map((t) => t.userId) } }).select({ email: 1 }).lean()).map((u) => [String(u._id), u.email]));
    page(req, res, "Support", html`<h1>Support</h1>
      <div class="tabs">${["open", "answered", "closed"].map((st) => html`<a href="?status=${st}" class="${st === status ? "on" : ""}">${st}</a>`)}</div>
      <div class="card"><table><tr><th>Updated</th><th>User</th><th>Category</th><th>Subject</th><th>Messages</th></tr>
      ${tickets.map((t) => html`<tr><td>${dt(t.updatedAt)}</td><td>${emails.get(String(t.userId)) ?? ""}</td><td>${t.category}</td><td><a href="/admin/support/${String(t._id)}">${t.subject}</a></td><td class="num">${t.messages.length}</td></tr>`)}
      </table></div>`);
  });

  r.get("/support/:id", action(async (req, res) => {
    const t = await SupportTicket.findById(param(req, "id")).lean();
    if (!t) throw new AppError(404, "not_found", "Request not found.");
    const user = await User.findById(t.userId).select({ email: 1 }).lean();
    const csrf = csrfField(req.admin!.csrf);
    page(req, res, t.subject, html`<h1>${t.subject}</h1>
      <div class="card"><p>${statusPill(t.status ?? "open")} · ${t.category} · <a href="/admin/users/${String(t.userId)}">${user?.email ?? ""}</a></p>
        ${t.messages.map((m) => html`<div class="msg ${m.from}"><small class="muted">${m.from === "admin" ? "You" : "User"} · ${dt(m.at)}</small>\n${m.text}</div>`)}
        <form method="post" action="/admin/support/${String(t._id)}/reply" class="form">${csrf}<textarea name="text" required placeholder="Reply (the user gets a notification)"></textarea><button class="btn">Send reply</button></form>
        <form method="post" action="/admin/support/${String(t._id)}/close" class="inline">${csrf}<button class="btn ghost">Close request</button></form>
      </div>`);
  }));
  r.post("/support/:id/reply", action(async (req, res) => {
    const text = f(req, "text");
    if (!text) throw new AppError(400, "text_required", "Write a reply first.");
    await adminReply(param(req, "id"), text);
    await audit(req.admin!.id, "support.reply", { type: "ticket", id: param(req, "id") }, req.ip);
    back(res, `/admin/support/${param(req, "id")}`, { ok: "Reply sent." });
  }));
  r.post("/support/:id/close", action(async (req, res) => {
    await closeTicket(param(req, "id"));
    await audit(req.admin!.id, "support.close", { type: "ticket", id: param(req, "id") }, req.ip);
    back(res, "/admin/support", { ok: "Closed." });
  }));

  r.use(configPages());
  return r;
}
