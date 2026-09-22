/**
 * Academy lessons: short, original guides about BitMine and Bitcoin basics.
 * Seeded once; admins can edit them afterwards (seeding never overwrites).
 * Bodies are plain paragraphs separated by blank lines.
 */
import { Lesson } from "../models/index.js";

export const LESSON_SEEDS = [
  {
    slug: "what-is-bitcoin",
    title: "What is Bitcoin?",
    summary: "The basics of Bitcoin: what it is, who runs it and why it has value.",
    level: "Beginner",
    category: "Blockchain",
    minutes: 4,
    image: "btc_cloud_hero",
    body: `Bitcoin is digital money that no bank or government controls. Instead, thousands of computers around the world keep a shared record of every payment, called the blockchain.

Every ten minutes or so, a new block of payments is added to that record. The computers that add blocks are called miners, and they're rewarded with new bitcoin for doing the work.

There will only ever be 21 million bitcoin. That fixed supply is a big part of why people treat it as a store of value, a bit like digital gold.

Bitcoin can be split into tiny pieces. The smallest unit is a satoshi, or "sat": one hundred-millionth of a bitcoin. In BitMine, balances are shown in sats because mining rewards are small and frequent.`,
  },
  {
    slug: "how-bitmine-works",
    title: "How BitMine mining works",
    summary: "Hashpower, miners and how your sats are credited every hour.",
    level: "Beginner",
    category: "Mining",
    minutes: 5,
    image: "miner_rig_3d",
    body: `In BitMine, your mining power is measured in hashpower: GH/s (gigahashes per second) and TH/s (1 TH/s = 1,000 GH/s). The more hashpower you have, the more sats you earn.

Your total hashpower is the sum of your miners. Free claims add 5.5 GH/s each. Super Miner tiers add their own claims. Paid miners add hashpower around the clock for 180 days.

BitMine credits your earnings to your balance every hour. You don't need to keep the app open: once your miners are running, the sats keep arriving.

Each day, tap Start mining to open that day's session. It unlocks your claims until midnight in your time zone, when claimed hashpower resets for the next day. Paid miners don't need a daily start.`,
  },
  {
    slug: "claims-and-super-miner",
    title: "Claims and Super Miner",
    summary: "Get the most from daily claims and the three Super Miner tiers.",
    level: "Beginner",
    category: "Mining",
    minutes: 4,
    image: "rocket_rewards",
    body: `A claim is a short video that adds hashpower until midnight. Everyone gets 60 free claims a day, each worth 5.5 GH/s, so up to 330 GH/s.

Claims made early in the day mine for longer, because claimed hashpower runs until midnight. A claim at 9 am earns about twice as much as one at 6 pm.

Super Miner tiers add a separate set of claims on top: Super Miner (30 claims of 5.5 GH/s), Pro (50 of 10 GH/s) and Max (50 of 20 GH/s, up to 1 TH/s a day). Tiers can be combined.

Paid miners are the way to earn without claiming. They mine 24/7 for 180 days, and you can own as many as you like.`,
  },
  {
    slug: "lightning-withdrawals",
    title: "Withdrawing with Lightning",
    summary: "Send your sats to a Speed address or any Lightning wallet.",
    level: "Intermediate",
    category: "Bitcoin",
    minutes: 5,
    image: "bitcoin_news_hero",
    body: `BitMine pays out over the Lightning Network, which settles in seconds with tiny fees. The minimum withdrawal is 2,500 sats.

You can withdraw in two ways. The easiest is a Speed address, which looks like name@speed.app. Create one for free in the Speed Wallet app.

With any other Lightning wallet, create an invoice for the exact amount you're withdrawing and paste it into BitMine. Invoices start with "lnbc" and expire, so create a fresh one each time.

Every withdrawal is reviewed before it's sent, usually within 24 hours. Your sats are set aside the moment you ask, and they return to your balance if a payout can't be made.`,
  },
  {
    slug: "keeping-your-account-safe",
    title: "Keeping your account safe",
    summary: "Two-step verification, strong passwords and avoiding scams.",
    level: "Beginner",
    category: "Security",
    minutes: 3,
    image: "user_profile_avatar",
    body: `Turn on two-step verification in Security. With it on, signing in and withdrawing need a code we email you, so a stolen password isn't enough.

Use a password you don't use anywhere else, and keep your email account secure: it's how codes reach you.

BitMine staff will never ask for your password or your codes. Ignore anyone offering to "double" your sats or asking you to send them bitcoin first.

If something looks wrong with your account, open a request in Help & Support and we'll look into it.`,
  },
  {
    slug: "referrals-explained",
    title: "Invite friends, earn together",
    summary: "How the 5% referral bonus works and how to share your code.",
    level: "Beginner",
    category: "Rewards",
    minutes: 2,
    image: "rocket_rewards",
    body: `Share your referral code from the Rewards screen. When friends sign up with it, you earn 5% of what they mine, every day, on top of your own mining.

Their earnings aren't reduced: the bonus is extra, paid by BitMine. Referral bonuses are credited once a day and capped at 5 sats a day in total.

Friends can add your code when they sign up, or later in Profile within their first 7 days.`,
  },
];

export async function listLessons() {
  const rows = await Lesson.find({ active: true }).sort({ order: 1 }).lean();
  return rows.map((l) => ({ slug: l.slug, title: l.title, summary: l.summary, level: l.level, category: l.category, minutes: l.minutes, image: l.image }));
}

export async function getLesson(slug: string) {
  const l = await Lesson.findOne({ slug, active: true }).lean();
  if (!l) return null;
  return { slug: l.slug, title: l.title, summary: l.summary, level: l.level, category: l.category, minutes: l.minutes, image: l.image, paragraphs: l.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) };
}
