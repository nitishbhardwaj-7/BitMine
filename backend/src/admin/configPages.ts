import { getGrowth } from "../settings/growth.js";
import { Router, type Request } from "express";
import { AppError } from "../lib/errors.js";
import { AdminAudit, AdminUser, AppConfig, Faq, Product, Settings } from "../models/index.js";
import { fastestSinglePackDays, type EconomicsSettings, type ProductSeed } from "../config/economics.js";
import { getEconomics, publishEconomics } from "../settings/economics.js";
import { audit } from "./auth.js";
import { csrfField, dt, html, statusPill } from "./html.js";
import { action, back, page, param } from "./router.js";
import { announce } from "./service.js";

const f = (req: Request, name: string) => String((req.body as Record<string, unknown>)[name] ?? "").trim();
const num = (req: Request, name: string) => {
  const v = Number(f(req, name));
  if (!Number.isFinite(v) || v < 0) throw new AppError(400, "invalid_number", `"${name}" must be a number ≥ 0.`);
  return v;
};

const ECON_FIELDS: [keyof EconomicsSettings, string, string][] = [
  ["rateMsatPerGhDay", "Mining rate (msat per GH/s per day)", "48 = 0.048 sats per GH/s per day"],
  ["claimGh", "GH/s per free claim", ""],
  ["claimsPerDay", "Free claims per day", ""],
  ["minWithdrawalSats", "Minimum withdrawal (sats)", ""],
  ["referralPercent", "Referral reward (%)", ""],
  ["referralCapSatsPerDay", "Referral cap (sats/day per referrer)", ""],
  ["withdrawalAutoApproveMaxSats", "Auto-approve withdrawals up to (sats)", "0 = review every withdrawal"],
  ["startAds", "Videos to watch to start mining each day", "0 = one tap; used when the daily start is on"],
];

async function productSeeds(): Promise<ProductSeed[]> {
  const products = await Product.find({ active: true }).lean();
  return products.map((p) => ({
    sku: p.sku, kind: p.kind, name: p.name, priceDisplayUsd: p.priceDisplayUsd, durationDays: p.durationDays,
    gh: p.gh ?? undefined, claimGh: p.claimGh ?? undefined, claimsPerDay: p.claimsPerDay ?? undefined, sortOrder: p.sortOrder ?? 0,
  }));
}

export function configPages() {
  const r = Router();

  // ── economics (versioned) ──
  r.get("/settings", async (req, res) => {
    const current = await getEconomics();
    const versions = await Settings.find({ key: "economics" }).sort({ version: -1 }).limit(20).lean();
    const days = fastestSinglePackDays(current, await productSeeds());
    const tomorrow = new Date(Date.now() + 86_400_000);
    tomorrow.setUTCHours(0, 0, 0, 0);
    page(req, res, "Economics", html`<h1>Economics</h1>
      <div class="card"><h2>In force now (v${current.version})</h2>
        <table>${ECON_FIELDS.map(([k, label]) => html`<tr><td>${label}</td><td class="num">${current[k] ?? 0}</td></tr>`)}<tr><td>Mining stops at midnight until the user starts it again</td><td class="num">${current.dailyStartRequired ? "yes" : "no (paid miners run 24/7)"}</td></tr></table>
        <p>15-day check: one Titan + all claims + Super Miner Max reaches the minimum in <b>${days.toFixed(1)} days</b> ${statusPill(days >= 15 ? "active" : "failed")}</p></div>
      <div class="card"><h2>Schedule a change</h2>
        <p class="muted">Changes only apply from the time you choose, so past mining is never repriced. Times are UTC.</p>
        <form method="post" action="/admin/settings" class="form">${csrfField(req.admin!.csrf)}
          ${ECON_FIELDS.map(([k, label, hint]) => html`<label>${label}${hint ? ` (${hint})` : ""}<input name="${k}" value="${current[k] ?? 0}" required></label>`)}
          <label>Daily start<select name="dailyStartRequired"><option value="1" ${current.dailyStartRequired ? "selected" : ""}>All mining stops at midnight until the user starts it again</option><option value="0" ${current.dailyStartRequired ? "" : "selected"}>Off: paid miners mine around the clock</option></select></label>
          <label>Takes effect (UTC)<input type="datetime-local" name="effectiveAt" value="${tomorrow.toISOString().slice(0, 16)}" required></label>
          <label><span><input type="checkbox" name="confirmGuard" value="yes"> Allow even if the 15-day check fails</span></label>
          <button class="btn">Schedule</button></form></div>
      <div class="card"><h2>History</h2><table><tr><th>Version</th><th>From</th>${ECON_FIELDS.map(([, label]) => html`<th>${label.split(" (")[0]}</th>`)}<th>Daily start</th></tr>
        ${versions.map((v) => html`<tr><td>v${v.version}</td><td>${dt(v.effectiveAt)}</td>${ECON_FIELDS.map(([k]) => html`<td class="num">${v.values[k] ?? 0}</td>`)}<td>${v.values.dailyStartRequired ? "yes" : "no"}</td></tr>`)}</table></div>`);
  });

  r.post("/settings", action(async (req, res) => {
    const values = Object.fromEntries(ECON_FIELDS.map(([k]) => [k, num(req, k)])) as unknown as EconomicsSettings;
    values.dailyStartRequired = f(req, "dailyStartRequired") === "1";
    for (const k of ["claimsPerDay", "minWithdrawalSats", "withdrawalAutoApproveMaxSats", "startAds"] as const) {
      if (!Number.isInteger(values[k])) throw new AppError(400, "invalid_number", `${k} must be a whole number.`);
    }
    const effectiveAt = new Date(`${f(req, "effectiveAt")}:00Z`);
    if (Number.isNaN(effectiveAt.getTime()) || effectiveAt.getTime() < Date.now() + 5 * 60_000) {
      throw new AppError(400, "invalid_time", "Choose a time at least 5 minutes from now (UTC).");
    }
    const days = fastestSinglePackDays(values, await productSeeds());
    if (days < 15 && f(req, "confirmGuard") !== "yes") {
      throw new AppError(400, "guard_failed", `With these numbers a single-pack user reaches the minimum in ${days.toFixed(1)} days (under 15). Tick the box to allow it anyway.`);
    }
    const version = await publishEconomics(values, effectiveAt, String(req.admin!.id));
    await audit(req.admin!.id, "settings.publish", { type: "settings", id: `economics:v${version}`, details: { values, effectiveAt } }, req.ip);
    back(res, "/admin/settings", { ok: `Version ${version} scheduled for ${dt(effectiveAt)}.` });
  }));

  // ── products ──
  r.get("/products", async (req, res) => {
    const products = await Product.find().sort({ sortOrder: 1 }).lean();
    const csrf = csrfField(req.admin!.csrf);
    page(req, res, "Products", html`<h1>Products</h1>
      <p class="muted">Changes apply to new purchases only; miners already bought keep what they were sold. Store IDs must match App Store Connect and Play Console exactly.</p>
      ${products.map((p) => html`<div class="card"><form method="post" action="/admin/products/${p.sku}" class="form">${csrf}
        <h2>${p.name} <span class="mono muted">${p.sku}</span> ${statusPill(p.active ? "active" : "failed")}</h2>
        <div class="row"><label>Name<input name="name" value="${p.name}" required></label><label>Display price (USD)<input name="priceDisplayUsd" value="${p.priceDisplayUsd}" required></label><label>Duration (days)<input name="durationDays" value="${p.durationDays}" required></label></div>
        ${p.kind !== "super_miner"
          ? html`<div class="row"><label>GH/s<input name="gh" value="${p.gh ?? ""}" required></label>${p.kind === "bundle" ? html`<label>Includes Super Miner tier (SKU)<input name="bundleSuperSku" value="${p.bundleSuperSku ?? ""}"></label>` : ""}</div>`
          : html`<div class="row"><label>GH/s per claim<input name="claimGh" value="${p.claimGh ?? ""}" required></label><label>Claims per day<input name="claimsPerDay" value="${p.claimsPerDay ?? ""}" required></label></div>`}
        <div class="row"><label>Apple product ID<input name="apple" value="${p.storeIds?.apple ?? ""}"></label><label>Google product ID<input name="google" value="${p.storeIds?.google ?? ""}"></label></div>
        <div class="row"><label>"Was" price shown struck through (USD, empty = none)<input name="listPriceUsd" value="${p.listPriceUsd ?? ""}"></label><label>Billing<select name="billing"><option value="one_time" ${p.billing === "subscription" ? "" : "selected"}>One-time purchase</option><option value="subscription" ${p.billing === "subscription" ? "selected" : ""}>Auto-renewing subscription</option></select></label></div>
        <div class="row"><label>Order<input name="sortOrder" value="${p.sortOrder ?? 0}"></label><label>Status<select name="active"><option value="yes" ${p.active ? "selected" : ""}>Active (sold in app)</option><option value="no" ${p.active ? "" : "selected"}>Hidden</option></select></label></div>
        <div><button class="btn">Save ${p.name}</button></div></form></div>`)}`);
  });

  r.post("/products/:sku", action(async (req, res) => {
    const p = await Product.findOne({ sku: param(req, "sku") }).lean();
    if (!p) throw new AppError(404, "not_found", "Product not found.");
    const set: Record<string, unknown> = {
      name: f(req, "name"),
      priceDisplayUsd: num(req, "priceDisplayUsd"),
      durationDays: num(req, "durationDays"),
      "storeIds.apple": f(req, "apple"),
      "storeIds.google": f(req, "google"),
      sortOrder: num(req, "sortOrder"),
      active: f(req, "active") === "yes",
    };
    set.billing = f(req, "billing") === "subscription" ? "subscription" : "one_time";
    const was = Number(f(req, "listPriceUsd"));
    const unset: Record<string, 1> = {};
    if (f(req, "listPriceUsd") && Number.isFinite(was) && was > 0) set.listPriceUsd = was;
    else unset.listPriceUsd = 1;
    if (p.kind === "bundle") set.bundleSuperSku = f(req, "bundleSuperSku");
    if (p.kind !== "super_miner") set.gh = num(req, "gh");
    else Object.assign(set, { claimGh: num(req, "claimGh"), claimsPerDay: num(req, "claimsPerDay") });
    if (!set.name || (set.durationDays as number) < 1) throw new AppError(400, "invalid", "Name and a duration of at least 1 day are required.");
    for (const store of ["apple", "google"] as const) {
      const id = set[`storeIds.${store}`] as string;
      if (id && (await Product.exists({ sku: { $ne: p.sku }, [`storeIds.${store}`]: id }))) {
        throw new AppError(409, "duplicate_store_id", `Another product already uses the ${store} ID "${id}".`);
      }
    }
    await Product.updateOne({ sku: p.sku }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    await audit(req.admin!.id, "product.update", { type: "product", id: p.sku, details: set }, req.ip);
    back(res, "/admin/products", { ok: `${set.name} saved.` });
  }));

  // ── FAQs and app config ──
  r.get("/content", async (req, res) => {
    const [faqs, cfg, g] = await Promise.all([Faq.find().sort({ order: 1, createdAt: 1 }).lean(), AppConfig.findById("app").lean(), getGrowth()]);
    const promoEnds = cfg?.promo?.endsAt ? cfg.promo.endsAt.toISOString().slice(0, 16) : "";
    const csrf = csrfField(req.admin!.csrf);
    page(req, res, "FAQs & app", html`<h1>FAQs & app config</h1>
      <div class="card"><h2>App config</h2><form method="post" action="/admin/content/app" class="form">${csrf}
        <div class="row"><label>Minimum Android version<input name="minAndroid" value="${cfg?.minVersion?.android ?? ""}"></label><label>Minimum iOS version<input name="minIos" value="${cfg?.minVersion?.ios ?? ""}"></label></div>
        <div class="row"><label>Latest Android version<input name="latestAndroid" value="${cfg?.latestVersion?.android ?? ""}"></label><label>Latest iOS version<input name="latestIos" value="${cfg?.latestVersion?.ios ?? ""}"></label></div>
        <label>Update message<input name="updateMessage" value="${cfg?.updateMessage ?? ""}"></label>
        <div class="row"><label>Play Store URL<input name="storeAndroid" value="${cfg?.storeUrls?.android ?? ""}"></label><label>App Store URL<input name="storeIos" value="${cfg?.storeUrls?.ios ?? ""}"></label></div>
        <div class="row"><label>Android rewarded ad unit<input name="adAndroidRewarded" value="${cfg?.adUnits?.android?.rewarded ?? ""}"></label><label>Android banner ad unit<input name="adAndroidBanner" value="${cfg?.adUnits?.android?.banner ?? ""}"></label></div>
        <div class="row"><label>iOS rewarded ad unit<input name="adIosRewarded" value="${cfg?.adUnits?.ios?.rewarded ?? ""}"></label><label>iOS banner ad unit<input name="adIosBanner" value="${cfg?.adUnits?.ios?.banner ?? ""}"></label></div>
        <div class="row"><label>AdMob test devices (comma-separated device IDs; these phones get test videos and can test claims end to end)<input name="admobTestDevices" value="${(cfg?.admobTestDevices ?? []).join(", ")}"></label>
        <label>Rewarded eCPM estimate (USD per 1,000 views, for the dashboard)<input name="adEcpmUsd" value="${cfg?.adEcpmUsd ?? 4}"></label></div>
        <div class="row"><label>Support email<input name="supportEmail" value="${cfg?.supportEmail ?? ""}"></label><label>Terms URL<input name="termsUrl" value="${cfg?.termsUrl ?? ""}"></label><label>Privacy URL<input name="privacyUrl" value="${cfg?.privacyUrl ?? ""}"></label></div>
        <div><button class="btn">Save app config</button></div></form></div>
      <div class="card"><h2>Perks & bonuses</h2><p class="muted">Applies as soon as it is saved. Streak and boost hashpower earn sats like any other, so keep them small next to what an ad view pays.</p>
        <form method="post" action="/admin/content/growth" class="form">${csrf}
        <div class="row"><label>Paid-miner owners skip the start videos<select name="paidSkipStartAds"><option value="1" ${g.paidSkipStartAds ? "selected" : ""}>Yes: one tap starts their day</option><option value="0" ${g.paidSkipStartAds ? "" : "selected"}>No: everyone watches</option></select></label>
        <label>Starter offer shown to new accounts for (hours, 0 = off)<input name="offerHours" value="${g.offerHours}" required></label></div>
        <div class="row"><label>Streak bonus every (days in a row, 0 = off)<input name="streakDays" value="${g.streakDays}" required></label><label>Streak bonus (GH/s until midnight)<input name="streakBonusGh" value="${g.streakBonusGh}" required></label></div>
        <div class="row"><label>Boost videos per day (0 = off)<input name="boostAdsPerDay" value="${g.boostAdsPerDay}" required></label><label>Boost lasts (minutes)<input name="boostMinutes" value="${g.boostMinutes}" required></label><label>Most GH/s one boost can add<input name="boostMaxGh" value="${g.boostMaxGh}" required></label></div>
        <div><button class="btn">Save perks</button></div></form></div>
      <div class="card"><h2>Sale banner</h2><p class="muted">Shows a countdown banner on Home and in the Store until the end time. The price itself is whatever the store charges: change it in Play Console / App Store Connect, and set the product's "was" price under Products.</p>
        <form method="post" action="/admin/content/promo" class="form">${csrf}
        <div class="row"><label>Status<select name="active"><option value="1" ${cfg?.promo?.active ? "selected" : ""}>On</option><option value="0" ${cfg?.promo?.active ? "" : "selected"}>Off</option></select></label><label>Ends (UTC)<input type="datetime-local" name="endsAt" value="${promoEnds}"></label><label>Badge (e.g. -30%)<input name="badge" maxlength="12" value="${cfg?.promo?.badge ?? ""}"></label></div>
        <label>Title<input name="title" maxlength="50" value="${cfg?.promo?.title ?? ""}"></label><label>Text<input name="body" maxlength="120" value="${cfg?.promo?.body ?? ""}"></label>
        <label>Product on sale (SKU, empty = whole store)<input name="sku" value="${cfg?.promo?.sku ?? ""}"></label>
        <div><button class="btn">Save sale banner</button></div></form></div>
      <div class="card"><h2>FAQs</h2>
        ${faqs.map((q) => html`<form method="post" action="/admin/content/faq/${String(q._id)}" class="form" style="border-top:1px solid var(--line);padding-top:10px">${csrf}
          <div class="row"><label style="flex:4">Question<input name="question" value="${q.question}" required></label><label>Order<input name="order" value="${q.order ?? 0}"></label>
          <label>Status<select name="active"><option value="yes" ${q.active ? "selected" : ""}>Shown</option><option value="no" ${q.active ? "" : "selected"}>Hidden</option></select></label></div>
          <label>Answer<textarea name="answer" required>${q.answer}</textarea></label><div><button class="btn ghost">Save</button></div></form>`)}
        <h2 style="margin-top:18px">Add a question</h2>
        <form method="post" action="/admin/content/faq" class="form">${csrf}<label>Question<input name="question" required></label><label>Answer<textarea name="answer" required></textarea></label><div><button class="btn">Add</button></div></form>
      </div>`);
  });

  r.post("/content/app", action(async (req, res) => {
    const set = {
      "minVersion.android": f(req, "minAndroid"), "minVersion.ios": f(req, "minIos"),
      "latestVersion.android": f(req, "latestAndroid"), "latestVersion.ios": f(req, "latestIos"),
      updateMessage: f(req, "updateMessage"),
      "storeUrls.android": f(req, "storeAndroid"), "storeUrls.ios": f(req, "storeIos"),
      "adUnits.android.rewarded": f(req, "adAndroidRewarded"), "adUnits.android.banner": f(req, "adAndroidBanner"),
      "adUnits.ios.rewarded": f(req, "adIosRewarded"), "adUnits.ios.banner": f(req, "adIosBanner"),
      supportEmail: f(req, "supportEmail"), termsUrl: f(req, "termsUrl"), privacyUrl: f(req, "privacyUrl"),
      admobTestDevices: f(req, "admobTestDevices").split(",").map((s) => s.trim()).filter(Boolean),
      adEcpmUsd: num(req, "adEcpmUsd"),
    };
    for (const v of [set["minVersion.android"], set["minVersion.ios"], set["latestVersion.android"], set["latestVersion.ios"]]) {
      if (v && !/^\d+\.\d+\.\d+$/.test(v)) throw new AppError(400, "invalid_version", `Versions look like 1.2.3 (got "${v}").`);
    }
    await AppConfig.updateOne({ _id: "app" }, { $set: set }, { upsert: true });
    await audit(req.admin!.id, "app_config.update", { type: "app_config", id: "app", details: set }, req.ip);
    back(res, "/admin/content", { ok: "App config saved. The app picks it up on next start." });
  }));
  r.post("/content/growth", action(async (req, res) => {
    const growth = {
      paidSkipStartAds: f(req, "paidSkipStartAds") === "1",
      offerHours: num(req, "offerHours"),
      streakDays: Math.floor(num(req, "streakDays")),
      streakBonusGh: num(req, "streakBonusGh"),
      boostAdsPerDay: Math.floor(num(req, "boostAdsPerDay")),
      boostMinutes: Math.floor(num(req, "boostMinutes")),
      boostMaxGh: num(req, "boostMaxGh"),
    };
    for (const [k, v] of Object.entries(growth)) {
      if (typeof v === "number" && (!Number.isFinite(v) || v < 0)) throw new AppError(400, "invalid", `${k} must be zero or more.`);
    }
    if (growth.boostAdsPerDay > 0 && growth.boostMinutes < 1) throw new AppError(400, "invalid", "A boost lasts at least 1 minute.");
    await AppConfig.updateOne({ _id: "app" }, { $set: { growth } }, { upsert: true });
    await audit(req.admin!.id, "growth.update", { type: "app_config", id: "app", details: growth }, req.ip);
    back(res, "/admin/content", { ok: "Perks saved." });
  }));
  r.post("/content/promo", action(async (req, res) => {
    const endsAt = f(req, "endsAt") ? new Date(`${f(req, "endsAt")}:00Z`) : null;
    const promo = { active: f(req, "active") === "1", title: f(req, "title").slice(0, 50), body: f(req, "body").slice(0, 120), badge: f(req, "badge").slice(0, 12), sku: f(req, "sku"), endsAt };
    if (promo.active && (!promo.title || !endsAt || Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now())) {
      throw new AppError(400, "invalid", "A sale needs a title and an end time in the future.");
    }
    if (promo.sku && !(await Product.exists({ sku: promo.sku }))) throw new AppError(400, "invalid", `No product has the SKU "${promo.sku}".`);
    await AppConfig.updateOne({ _id: "app" }, { $set: { promo } }, { upsert: true });
    await audit(req.admin!.id, "promo.update", { type: "app_config", id: "app", details: promo }, req.ip);
    back(res, "/admin/content", { ok: promo.active ? "Sale banner is on." : "Sale banner is off." });
  }));
  r.post("/content/faq", action(async (req, res) => {
    const max = await Faq.findOne().sort({ order: -1 }).lean();
    const doc = await Faq.create({ question: f(req, "question"), answer: f(req, "answer"), order: (max?.order ?? 0) + 10 });
    await audit(req.admin!.id, "faq.create", { type: "faq", id: String(doc._id) }, req.ip);
    back(res, "/admin/content", { ok: "Question added." });
  }));
  r.post("/content/faq/:id", action(async (req, res) => {
    await Faq.updateOne({ _id: param(req, "id") }, { $set: { question: f(req, "question"), answer: f(req, "answer"), order: num(req, "order"), active: f(req, "active") === "yes" } });
    await audit(req.admin!.id, "faq.update", { type: "faq", id: param(req, "id") }, req.ip);
    back(res, "/admin/content", { ok: "Saved." });
  }));

  // ── announcements ──
  r.get("/announce", (req, res) => {
    page(req, res, "Announce", html`<h1>Send an announcement</h1>
      <div class="card"><p class="muted">Goes to every active user's notification list, and as a push to their phones. It can't be undone.</p>
      <form method="post" action="/admin/announce" class="form">${csrfField(req.admin!.csrf)}
        <label>Title<input name="title" maxlength="60" required></label><label>Message<textarea name="body" maxlength="240" required></textarea></label>
        <label>Type SEND to confirm<input name="confirm" required pattern="SEND"></label><div><button class="btn bad">Send to everyone</button></div></form></div>`);
  });
  r.post("/announce", action(async (req, res) => {
    if (f(req, "confirm") !== "SEND") throw new AppError(400, "confirm", "Type SEND to confirm.");
    const title = f(req, "title");
    const body = f(req, "body");
    if (!title || !body) throw new AppError(400, "required", "Title and message are required.");
    const count = await announce(title.slice(0, 60), body.slice(0, 240));
    await audit(req.admin!.id, "announce", { details: { title, body, count } }, req.ip);
    back(res, "/admin/announce", { ok: `Sent to ${count.toLocaleString("en-US")} users.` });
  }));

  // ── audit log ──
  r.get("/audit", async (req, res) => {
    const rows = await AdminAudit.find().sort({ createdAt: -1 }).limit(200).lean();
    const admins = new Map((await AdminUser.find({ _id: { $in: rows.map((x) => x.adminId) } }).lean()).map((a) => [String(a._id), a.email]));
    page(req, res, "Audit log", html`<h1>Audit log</h1><div class="card"><table><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th><th>IP</th></tr>
      ${rows.map((x) => html`<tr><td>${dt(x.createdAt)}</td><td>${admins.get(String(x.adminId)) ?? ""}</td><td>${x.action}</td><td class="mono">${x.targetType ? `${x.targetType}:${x.targetId}` : ""}</td>
        <td class="mono">${x.details ? JSON.stringify(x.details).slice(0, 300) : ""}</td><td class="mono">${x.ip ?? ""}</td></tr>`)}</table></div>`);
  });

  return r;
}
