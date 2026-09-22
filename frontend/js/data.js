/* ==========================================================================
   BITMINE MOCK DATA & APP STATE
   ========================================================================== */

export const mockData = {
  user: {
    name: "Nitish Bhardwaj",
    email: "nitish@example.com",
    avatar: "./assets/images/user_profile_avatar.jpg",
    balanceUsd: 1248.32,
    balanceBtc: 0.0186,
    todayChangePct: "+2.4%",
    rewardPoints: 1250,
    referralCode: "NITISH77",
    totalReferrals: 24,
    totalEarnedBtc: 0.0045,
    totalEarnedUsd: 302.12,
    kycStatus: "Verified",
    totalHashrate: "2.50 TH/s",
    totalHashrateChange: "+12%",
    totalRewardsBtc: "0.0234 BTC",
    totalRewardsUsd: "$1,576.32"
  },

  cryptoMarket: [
    {
      id: "btc",
      symbol: "BTC",
      name: "Bitcoin",
      price: "$67,284",
      change24h: "+2.4%",
      isPositive: true,
      amount: "0.0156",
      fiatValue: "$1,045.23",
      color: "#F7931A",
      sparkline: "M0,18 Q12,14 24,16 T48,6"
    },
    {
      id: "eth",
      symbol: "ETH",
      name: "Ethereum",
      price: "$3,412",
      change24h: "+1.8%",
      isPositive: true,
      amount: "0.2371",
      fiatValue: "$176.32",
      color: "#627EEA",
      sparkline: "M0,16 Q12,17 24,12 T48,8"
    },
    {
      id: "sol",
      symbol: "SOL",
      name: "Solana",
      price: "$158.21",
      change24h: "+3.1%",
      isPositive: true,
      amount: "1.245",
      fiatValue: "$198.32",
      color: "#14F195",
      sparkline: "M0,19 Q12,15 24,9 T48,4"
    },
    {
      id: "usdt",
      symbol: "USDT",
      name: "Tether",
      price: "$1.00",
      change24h: "+0.1%",
      isPositive: true,
      amount: "25.50",
      fiatValue: "$25.50",
      color: "#26A17B",
      sparkline: "M0,12 Q12,12 24,11 T48,12"
    },
    {
      id: "bnb",
      symbol: "BNB",
      name: "BNB",
      price: "$651.32",
      change24h: "+0.9%",
      isPositive: true,
      amount: "0.12",
      fiatValue: "$78.14",
      color: "#F3BA2F",
      sparkline: "M0,15 Q12,16 24,11 T48,9"
    },
    {
      id: "xrp",
      symbol: "XRP",
      name: "XRP",
      price: "$0.584",
      change24h: "-1.2%",
      isPositive: false,
      amount: "0.00",
      fiatValue: "$0.00",
      color: "#23292F",
      sparkline: "M0,6 Q12,8 24,14 T48,19"
    },
    {
      id: "ada",
      symbol: "ADA",
      name: "Cardano",
      price: "$0.421",
      change24h: "+2.1%",
      isPositive: true,
      amount: "0.00",
      fiatValue: "$0.00",
      color: "#0033AD",
      sparkline: "M0,17 Q12,13 24,10 T48,5"
    },
    {
      id: "doge",
      symbol: "DOGE",
      name: "Dogecoin",
      price: "$0.124",
      change24h: "+4.3%",
      isPositive: true,
      amount: "0.00",
      fiatValue: "$0.00",
      color: "#C2A633",
      sparkline: "M0,18 Q12,11 24,14 T48,4"
    },
    {
      id: "trx",
      symbol: "TRX",
      name: "TRON",
      price: "$0.158",
      change24h: "+0.7%",
      isPositive: true,
      amount: "0.00",
      fiatValue: "$0.00",
      color: "#EF0027",
      sparkline: "M0,14 Q12,14 24,10 T48,7"
    }
  ],

  miners: [
    {
      id: "BM-001",
      name: "Standard Miner",
      desc: "A reliable miner for steady growth.",
      hashrate: "1.00 TH/s",
      totalMined: "0.0124 BTC",
      efficiency: "0.08 J/GH",
      uptime: "99.8%",
      progress: 78,
      nextPayout: "2d 4h 12m",
      status: "Active",
      image: "./assets/images/miner_rig_3d.jpg"
    },
    {
      id: "BM-002",
      name: "Pro Miner",
      desc: "High-yield computing node for boosted hash.",
      hashrate: "0.50 TH/s",
      totalMined: "0.0068 BTC",
      efficiency: "0.06 J/GH",
      uptime: "99.9%",
      progress: 56,
      nextPayout: "3d 1h 20m",
      status: "Active",
      image: "./assets/images/miner_rig_3d.jpg"
    },
    {
      id: "BM-003",
      name: "Ultra Miner",
      desc: "Dedicated enterprise hash cluster.",
      hashrate: "1.00 TH/s",
      totalMined: "0.0000 BTC",
      efficiency: "0.05 J/GH",
      uptime: "0.0%",
      progress: 0,
      nextPayout: "Paused",
      status: "Inactive",
      image: "./assets/images/miner_rig_3d.jpg"
    }
  ],

  newsArticles: [
    {
      id: "news-1",
      category: "BITCOIN",
      title: "Bitcoin Hits New Milestone as Institutional Adoption Grows",
      summary: "Major institutions continue to show confidence in Bitcoin as a long-term reserve asset with record network difficulty.",
      date: "Sep 20, 2026",
      readTime: "4 min read",
      featured: true,
      image: "./assets/images/bitcoin_news_hero.jpg"
    },
    {
      id: "news-2",
      category: "MARKET",
      title: "Crypto Market Shows Strong Recovery This Week",
      summary: "Surging ETF inflows and hash rate expansion propel global crypto market capitalization above key resistance.",
      date: "Sep 19, 2026",
      readTime: "3 min read",
      featured: false,
      image: "./assets/images/btc_cloud_hero.jpg"
    },
    {
      id: "news-3",
      category: "MINING",
      title: "Next-Gen ASIC Efficiency Breaks 15 J/TH Threshold",
      summary: "Breakthrough 2nm chipsets deliver unprecedented thermal efficiency for clean cloud computing clusters.",
      date: "Sep 18, 2026",
      readTime: "5 min read",
      featured: false,
      image: "./assets/images/miner_rig_3d.jpg"
    }
  ],

  academyLessons: [
    {
      id: "lesson-1",
      title: "What is Bitcoin?",
      desc: "Learn the basics of Bitcoin, cryptography, and decentralized consensus.",
      duration: "5 min",
      level: "Beginner",
      image: "./assets/images/btc_cloud_hero.jpg"
    },
    {
      id: "lesson-2",
      title: "How Cloud Mining Works",
      desc: "Understand remote hashpower leasing, pool settlements, and daily rewards.",
      duration: "8 min",
      level: "Beginner",
      image: "./assets/images/miner_rig_3d.jpg"
    },
    {
      id: "lesson-3",
      title: "Mastering Lightning Withdrawals",
      desc: "Instant micro-settlement via Speed and BOLT11 Lightning invoices.",
      duration: "6 min",
      level: "Intermediate",
      image: "./assets/images/rocket_rewards.jpg"
    }
  ],

  milestoneRewards: [
    {
      id: "m-1",
      title: "Reach 10 Referrals",
      reward: "Get 0.001 BTC bonus",
      progress: "6/10",
      pct: 60
    },
    {
      id: "m-2",
      title: "Reach 25 Referrals",
      reward: "Unlock Super Miner Pro for 30 days",
      progress: "6/25",
      pct: 24
    }
  ]
};
