import express, { Router, type Request, type Response } from "express";
import { AppError } from "../lib/errors.js";
import { SupportTicket, User } from "../models/index.js";
import type { SpeedClient } from "../wallet/speed.js";
import { approveWithdrawal, getWithdrawalForAdmin, rejectWithdrawal, resolveReconcile } from "../wallet/withdrawals.js";
import { adminReply, closeTicket } from "../support/service.js";
import { audit, requireAdmin, signIn, signOut } from "./auth.js";
import { csrfField, day, dayChart, dt, dtShort, html, initials, kpi, layout, legend, loginLayout, num, raw, sats, satsUsd, short, statusPill, usd, userLabel, type Html } from "./html.js";
import type { MarketCache } from "../content/market.js";
import { AppConfig } from "../models/index.js";
import {
  WITHDRAWAL_STATUSES,
  adjustBalance,
  clearReviewFlags,
  dailySeries,
  dashboardStats,
  listPurchasesAdmin,
  purchaseTotals,
  searchUsers,
  setUserStatus,
  userDetail,
  userStats,
  userTotals,
  withdrawalQueue,
  type DayRow,
  type WithdrawalStatus,
} from "./service.js";
import { configPages } from "./configPages.js";

export interface AdminOptions {
  speed?: SpeedClient;
  secureCookies: boolean;
  /** For showing sats in dollars (BTC price). */
  market?: MarketCache;
}

/** Renders a signed-in page, with a one-line message from ?ok= / ?err=. */
export function page(req: Request, res: Response, title: string, body: Html) {
  const ok = typeof req.query.ok === "string" ? req.query.ok : null;
  const err = typeof req.query.err === "string" ? req.query.err : null;
  // The layout shows the title in its header; drop a leading <h1> that older pages carry.
  const content = raw(body.value.replace(/^\s*<h1>[\s\S]*?<\/h1>/, ""));
  res.type("html").send(
    layout({ title, path: req.baseUrl + req.path, csrf: req.admin!.csrf, flash: err ? { kind: "err", text: err } : ok ? { kind: "ok", text: ok } : null, body: content }),
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

export function adminRouter(opts: AdminOptions) {
  const r = Router();
  r.use(express.urlencoded({ extended: false, limit: "50kb" }));
  r.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");
    next();
  });

  // ── sign-in ──
  r.get("/login", (_req, res) => res.type("html").send(loginLayout({})));
  r.post("/login", async (req, res) => {
    const email = f(req, "email");
    const err = await signIn(req, res, email, String((req.body as Record<string, string>).password ?? ""), opts.secureCookies);
    if (err) return void res.status(401).type("html").send(loginLayout({ error: err, email }));
    res.redirect(303, "/admin");
  });

  // Everything below needs a full session.
  r.use(requireAdmin);

  r.post("/logout", async (req, res) => {
    await signOut(req, res);
    res.redirect(303, "/admin/login");
  });

  // ── dashboard ──
  /** Speed account balance card (payouts are sent from this account). */
  async function speedCard(): Promise<Html> {
    if (!opts.speed?.balances) return html`<div class="card"><h2>Speed balance</h2><p class="muted">Speed isn't configured (SPEED_API_KEY). Payouts are paused.</p></div>`;
    try {
      const raw = await opts.speed.balances();
      return html`<div class="card"><div class="cardhead"><h2>Speed balance</h2><span class="muted">Payouts are sent from this account. Keep it above what's owed in open withdrawals.</span></div><pre class="mono" style="margin:0;white-space:pre-wrap">${JSON.stringify(raw, null, 2)}</pre></div>`;
    } catch (err) {
      return html`<div class="card"><h2>Speed balance</h2><span class="pill bad">Couldn't reach Speed: ${(err as Error).message}</span></div>`;
    }
  }

  async function btcPrice(): Promise<number | null> {
    try {
      return opts.market ? (await opts.market.get()).btcUsd : null;
    } catch {
      return null;
    }
  }

  r.get("/", async (req, res) => {
    const cfg = await AppConfig.findById("app").lean();
    const ecpm = cfg?.adEcpmUsd ?? 4;
    const [s, days, btc, speed, queue, latest] = await Promise.all([
      dashboardStats(),
      dailySeries(30, ecpm),
      btcPrice(),
      speedCard(),
      withdrawalQueue("pending_review"),
      listPurchasesAdmin({}, 1),
    ]);
    const money = (satsN: number) => satsUsd(satsN, btc);
    const sum = (f: (d: DayRow) => number) => days.reduce((a, d) => a + f(d), 0);
    const iap30 = sum((d) => d.iapUsd);
    const ads30 = sum((d) => d.adsUsd);
    const paidSats30 = sum((d) => d.paidSats);
    const paid30 = money(paidSats30);
    const net30 = paid30 == null ? null : iap30 + ads30 - paid30;
    const today = days[days.length - 1]!;
    const todayNet = money(today.paidSats) == null ? null : today.iapUsd + today.adsUsd - money(today.paidSats)!;

    const COLORS = { iap: "#6D35F5", ads: "#B588FF", paid: "#F04438" };
    const chart = dayChart(
      days.map((d) => ({
        label: d.date,
        up: [
          { value: d.iapUsd, color: COLORS.iap, name: "Purchases" },
          { value: d.adsUsd, color: COLORS.ads, name: "Ads (est.)" },
        ],
        down: [{ value: money(d.paidSats) ?? 0, color: COLORS.paid, name: "Paid out" }],
      })),
      (n) => usd(n, n < 10 ? 2 : 0),
    );

    page(req, res, "Dashboard", html`
      ${s.reconcile ? html`<div class="flash err">${s.reconcile} withdrawal(s) need reconciliation. <a href="/admin/withdrawals?status=needs_reconcile">Review now</a></div>` : ""}
      <div class="hero"><div class="grid">
        ${kpi("Net · 30 days", usd(net30), "purchases + ads − paid out", "glass")}
        ${kpi("Purchases · 30 days", usd(iap30), `${num(sum((d) => d.purchases))} purchases, gross`, "glass")}
        ${kpi("Ad revenue · 30 days (est.)", usd(ads30), `${num(sum((d) => d.adViews))} verified videos × eCPM ${usd(ecpm)}`, "glass")}
        ${kpi("Paid out · 30 days", usd(paid30), `${num(paidSats30)} sats${btc ? ` at BTC ${usd(btc, 0)}` : ""}`, "glass")}
      </div></div>
      <div class="grid">
        ${kpi("Today (UTC)", usd(todayNet), `${usd(today.iapUsd)} purchases · ${usd(today.adsUsd)} ads · ${num(today.paidSats)} sats out`)}
        ${kpi("Waiting for review", num(s.pendingReview), "withdrawals to approve", s.pendingReview ? "bad" : "")}
        ${kpi("Owed in open withdrawals", `${num(s.pendingSats)} sats`, usd(money(s.pendingSats)))}
        ${kpi("Owed to all users", sats(s.liabilitiesMsat), `${usd(money(s.liabilitiesMsat / 1000))} · available + locked`)}
        ${kpi("Active users", num(s.users), `${num(s.newUsers)} new today`)}
        ${kpi("Started mining · 24 h", num(s.activeToday))}
        ${kpi("Ad views · 24 h", num(s.claims24h), "verified by AdMob")}
        ${kpi("Mined · 24 h", sats(s.mined24hMsat), "credited to users")}
      </div>
      <div class="card"><div class="cardhead"><h2>Revenue by day · last 30 days</h2><span class="muted">Ads estimated at eCPM ${usd(ecpm)} (set in FAQs &amp; app)${btc ? ` · BTC ${usd(btc, 0)}` : " · BTC price unavailable"}</span></div>
        ${chart}${legend([{ color: COLORS.iap, name: "Purchases (gross)" }, { color: COLORS.ads, name: "Ad revenue (estimated)" }, { color: COLORS.paid, name: "Paid out to users" }])}</div>
      <div class="split">
        <div class="card"><div class="cardhead"><h2>Withdrawals waiting</h2><a href="/admin/withdrawals">Review all →</a></div>
          ${queue.length === 0 ? html`<p class="muted">Nothing waiting. 🎉</p>` : html`<table><tr><th>Requested</th><th>User</th><th class="num">Amount</th><th>To</th></tr>
          ${queue.slice(0, 6).map(({ w, user }) => html`<tr><td class="nowrap">${dtShort(w.createdAt)}</td><td><a href="/admin/users/${String(w.userId)}">${userLabel(user?.email, user?.name)}</a></td><td class="num">${num(w.amountSats)} sats</td><td class="mono">${short(w.destination, 22)}</td></tr>`)}</table>`}</div>
        <div class="card"><div class="cardhead"><h2>Latest purchases</h2><a href="/admin/purchases">All purchases →</a></div>
          ${latest.rows.length === 0 ? html`<p class="muted">No purchases yet.</p>` : html`<table><tr><th>When</th><th>User</th><th>Product</th><th class="num">Price</th></tr>
          ${latest.rows.slice(0, 6).map((p) => html`<tr><td class="nowrap">${dtShort(p.purchasedAt)}</td><td><a href="/admin/users/${p.userId}">${userLabel(p.email, p.name)}</a></td><td>${p.product}</td><td class="num">${usd(p.priceUsd)}</td></tr>`)}</table>`}</div>
      </div>
      <div class="card"><div class="cardhead"><h2>Day by day</h2><span class="muted">UTC days · newest first</span></div>
        <table><tr><th>Day</th><th class="num">New users</th><th class="num">Started mining</th><th class="num">Ad views</th><th class="num">Ads (est.)</th><th class="num">Purchases</th><th class="num">Purchase $</th><th class="num">Paid out</th><th class="num">Mined</th><th class="num">Net</th></tr>
        ${[...days].reverse().map((d) => {
          const p = money(d.paidSats);
          return html`<tr><td>${d.date}</td><td class="num">${num(d.newUsers)}</td><td class="num">${num(d.active)}</td><td class="num">${num(d.adViews)}</td><td class="num">${usd(d.adsUsd)}</td><td class="num">${num(d.purchases)}</td><td class="num">${usd(d.iapUsd)}</td><td class="num">${num(d.paidSats)} sats${p != null ? html` <span class="muted">${usd(p)}</span>` : ""}</td><td class="num">${sats(d.minedMsat)}</td><td class="num">${usd(p == null ? null : d.iapUsd + d.adsUsd - p)}</td></tr>`;
        })}
        <tr class="total"><td>30 days</td><td class="num">${num(sum((d) => d.newUsers))}</td><td class="num">${num(sum((d) => d.active))}</td><td class="num">${num(sum((d) => d.adViews))}</td><td class="num">${usd(ads30)}</td><td class="num">${num(sum((d) => d.purchases))}</td><td class="num">${usd(iap30)}</td><td class="num">${num(paidSats30)} sats</td><td class="num">${sats(sum((d) => d.minedMsat))}</td><td class="num">${usd(net30)}</td></tr></table>
        <p class="muted" style="margin:10px 0 0;font-size:12px">Purchase amounts are store prices before Apple's/Google's cut. Ad revenue is an estimate from verified videos; the exact amount is in your AdMob account. "Mined" is what users earned that day (your future payout liability).</p></div>
      ${speed}`);
  });

  // ── withdrawals ──
  r.get("/withdrawals", async (req, res) => {
    const status = (WITHDRAWAL_STATUSES as readonly string[]).includes(String(req.query.status)) ? (req.query.status as WithdrawalStatus) : "pending_review";
    const rows = await withdrawalQueue(status);
    const tabs = html`<div class="tabs">${WITHDRAWAL_STATUSES.map((st) => html`<a href="?status=${st}" class="${st === status ? "on" : ""}">${st.replace(/_/g, " ")}</a>`)}</div>`;
    const csrf = csrfField(req.admin!.csrf);
    const speed = await speedCard();
    page(req, res, "Withdrawals", html`
      ${speed}${tabs}
      <div class="card"><table><tr><th>Requested</th><th>User</th><th class="num">Amount</th><th>To</th><th>Checks</th><th>Status</th><th>Action</th></tr>
      ${rows.length === 0 ? html`<tr><td colspan="7" class="muted">Nothing here.</td></tr>` : ""}
      ${rows.map(({ w, user, paidCount }) => {
        const ageDays = user?.createdAt ? Math.floor((Date.now() - user.createdAt.getTime()) / 86_400_000) : 0;
        const flags = user?.reviewFlags?.length ?? 0;
        return html`<tr>
          <td class="nowrap">${dtShort(w.createdAt)}</td>
          <td><a href="/admin/users/${String(w.userId)}">${userLabel(user?.email, user?.name)}</a></td>
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
    const [users, totals] = await Promise.all([searchUsers(q), userTotals()]);
    const stats = await userStats(users.map((u) => u._id));
    page(req, res, "Users", html`
      <div class="grid">
        ${kpi("Active users", num(totals.active), `${num(totals.total)} total`)}
        ${kpi("Paying users", num(totals.withPurchase), "at least one purchase")}
        ${kpi("Suspended", num(totals.suspended))}
        ${kpi("Deleted", num(totals.deleted))}
      </div>
      <div class="card"><div class="cardhead"><h2>${q ? html`Results for “${q}”` : "Newest users"}</h2>
        <form method="get" class="inline"><input name="q" value="${q}" placeholder="Email, user id or referral code" size="34"><button class="btn ghost">Search</button></form></div>
      <table><tr><th>User</th><th>Joined</th><th>Status</th><th class="num">Balance</th><th class="num">Mining now</th><th class="num">Lifetime mined</th><th>Flags</th><th>2FA</th></tr>
      ${users.length === 0 ? html`<tr><td colspan="8" class="muted">No users match.</td></tr>` : ""}
      ${users.map((u) => {
        const st = stats(u._id);
        return html`<tr><td><a href="/admin/users/${String(u._id)}"><span class="avatar">${initials(u.name || u.email)}</span>${userLabel(u.email)}</a><div class="muted" style="margin-left:38px">${u.name}</div></td>
          <td class="nowrap">${day(u.createdAt)}</td><td>${statusPill(u.status ?? "active")}</td>
          <td class="num">${sats(st.availableMsat)}${st.lockedMsat ? html`<div class="muted">+${sats(st.lockedMsat)} locked</div>` : ""}</td>
          <td class="num">${st.gh.toLocaleString("en-US")} GH/s</td><td class="num">${sats(st.lifetimeMinedMsat)}</td>
          <td>${u.reviewFlags?.length ? html`<span class="pill bad">${u.reviewFlags.length} flag(s)</span>` : ""}</td><td>${u.twoFactor?.enabled ? html`<span class="pill good">on</span>` : html`<span class="pill grey">off</span>`}</td></tr>`;
      })}
      </table>${users.length >= 50 ? html`<p class="muted" style="margin:10px 0 0">Showing the first 50. Search to narrow down.</p>` : ""}</div>`);
  });

  // ── purchases ──
  r.get("/purchases", async (req, res) => {
    const status = (["granted", "refunded"] as const).find((x) => x === req.query.status);
    const store = (["app_store", "play_store"] as const).find((x) => x === req.query.store);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const pageNo = Math.max(1, Number(req.query.page) || 1);
    const [list, totals] = await Promise.all([listPurchasesAdmin({ status, store, q }, pageNo), purchaseTotals()]);
    const link = (p: Record<string, string | number | undefined>) => {
      const u = new URLSearchParams();
      for (const [k, v] of Object.entries({ status, store, q, page: undefined, ...p })) if (v) u.set(k, String(v));
      return `/admin/purchases${u.toString() ? `?${u}` : ""}`;
    };
    const tab = (label: string, p: Record<string, string | undefined>, on: boolean) => html`<a href="${link(p)}" class="${on ? "on" : ""}">${label}</a>`;
    page(req, res, "Purchases", html`
      <div class="grid">
        ${kpi("All time", usd(totals.all.usd), `${num(totals.all.n)} purchases, gross`)}
        ${kpi("Last 30 days", usd(totals.d30.usd), `${num(totals.d30.n)} purchases`)}
        ${kpi("Last 7 days", usd(totals.d7.usd), `${num(totals.d7.n)} purchases`)}
        ${kpi("Refunded", num(totals.refunded), "miners revoked, accounts flagged", totals.refunded ? "bad" : "")}
      </div>
      <div class="card">
        <div class="cardhead"><div class="tabs">${tab("All", { status: undefined }, !status)}${tab("Granted", { status: "granted" }, status === "granted")}${tab("Refunded", { status: "refunded" }, status === "refunded")}
          <span style="width:10px"></span>${tab("Both stores", { store: undefined }, !store)}${tab("Google Play", { store: "play_store" }, store === "play_store")}${tab("App Store", { store: "app_store" }, store === "app_store")}</div>
          <form method="get" class="inline">${status ? html`<input type="hidden" name="status" value="${status}">` : ""}${store ? html`<input type="hidden" name="store" value="${store}">` : ""}<input name="q" value="${q}" placeholder="Email, user id or transaction id" size="30"><button class="btn ghost">Search</button></form></div>
        <table><tr><th>When</th><th>User</th><th>Product</th><th>Store</th><th class="num">Price</th><th>Status</th><th>Transaction</th></tr>
        ${list.rows.length === 0 ? html`<tr><td colspan="7" class="muted">No purchases here yet.</td></tr>` : ""}
        ${list.rows.map((p) => html`<tr><td class="nowrap">${dtShort(p.purchasedAt)}</td><td><a href="/admin/users/${p.userId}">${userLabel(p.email, p.name)}</a></td>
          <td>${p.product}${p.kind === "super_miner" && p.superUntil ? html`<div class="muted">tier active until ${day(p.superUntil)}</div>` : ""}</td>
          <td>${p.store === "app_store" ? "App Store" : "Google Play"}</td>
          <td class="num">${usd(p.priceUsd)}${p.priceIsList ? html`<div class="muted" title="RevenueCat didn't report a price; this is the catalog price">list price</div>` : p.currency && p.currency !== "USD" ? html`<div class="muted">${p.currency}</div>` : ""}</td>
          <td>${statusPill(p.status)}</td><td class="mono" title="${p.storeTransactionId}">${short(p.storeTransactionId, 18)}</td></tr>`)}
        </table>
        ${list.pages > 1 ? html`<div class="pager">${list.page > 1 ? html`<a href="${link({ page: list.page - 1 })}" class="pill">← Newer</a>` : ""}<span class="muted">Page ${list.page} of ${list.pages} · ${num(list.total)} purchases</span>${list.page < list.pages ? html`<a href="${link({ page: list.page + 1 })}" class="pill">Older →</a>` : ""}</div>` : ""}
        <p class="muted" style="margin:10px 0 0;font-size:12px">Prices are what the store charged (gross). Apple and Google keep 15–30%; refunds come through RevenueCat and revoke the miner automatically.</p>
      </div>`);
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
