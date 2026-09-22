/**
 * Seed content: FAQs and app config defaults. Seeding only inserts what's
 * missing, so admin edits survive re-seeding.
 */
export const FAQ_SEEDS = [
  {
    seedKey: "how-mining-works",
    question: "How does mining work in BitMine?",
    answer:
      "Your miners add up to your total hashpower (GH/s). BitMine credits sats to your balance every hour based on that hashpower. You don't need to keep the app open.",
  },
  {
    seedKey: "start-mining",
    question: "Why do I need to tap Start mining every day?",
    answer:
      "Starting today's session unlocks your free claims. Paid miners keep mining around the clock without it.",
  },
  {
    seedKey: "claims",
    question: "What are claims and when do they reset?",
    answer:
      "Each claim adds 5.5 GH/s after a short video, up to 60 a day. Claimed hashpower mines until midnight in your time zone, then resets.",
  },
  {
    seedKey: "super-miner",
    question: "What is Super Miner?",
    answer:
      "Super Miner tiers add their own daily claims on top of the free ones: 30 × 5.5 GH/s, 50 × 10 GH/s or 50 × 20 GH/s, depending on the tier.",
  },
  {
    seedKey: "withdraw-minimum",
    question: "How much do I need to withdraw?",
    answer: "The minimum withdrawal is 2,500 sats (0.000025 BTC).",
  },
  {
    seedKey: "withdraw-where",
    question: "Where can I withdraw to?",
    answer:
      "To a Speed Lightning address (name@speed.app), or to a Lightning invoice from any wallet for the exact amount you're withdrawing.",
  },
  {
    seedKey: "withdraw-time",
    question: "How long does a withdrawal take?",
    answer:
      "Each withdrawal is reviewed before it's sent, usually within 24 hours. Once approved, Lightning payments arrive in seconds.",
  },
  {
    seedKey: "paid-miners",
    question: "How long do paid miners last?",
    answer: "Paid miners mine for 180 days from purchase, 24 hours a day. You can own as many as you like.",
  },
];

/** Google's public AdMob test ad units: safe until the real ones are created. */
export const APP_CONFIG_DEFAULTS = {
  minVersion: { android: "1.0.0", ios: "1.0.0" },
  latestVersion: { android: "1.0.0", ios: "1.0.0" },
  updateMessage: "A new version of BitMine is available.",
  storeUrls: { android: "", ios: "" },
  adUnits: {
    android: { rewarded: "ca-app-pub-3940256099942544/5224354917", banner: "ca-app-pub-3940256099942544/6300978111" },
    ios: { rewarded: "ca-app-pub-3940256099942544/1712485313", banner: "ca-app-pub-3940256099942544/2934735716" },
  },
  supportEmail: "",
  termsUrl: "",
  privacyUrl: "",
};
