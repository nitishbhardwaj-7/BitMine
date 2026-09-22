import { mockData } from './data.js';

class BitMineApp {
  constructor() {
    this.currentScreen = 'home';
    this.screenHistory = [];
    this.balanceHidden = false;
    this.currentCurrency = 'USD';
    this.currentViewMode = 'single'; // 'single' or 'gallery'
    this.marketFilter = 'all';
    this.minersFilter = 'all';
    this.walletTab = 'assets';

    this.init();
  }

  init() {
    this.bindEvents();
    this.renderScreen(this.currentScreen);
    this.renderGalleryGrid();
    this.startLiveAccrualTicker();
  }

  bindEvents() {
    // Top Simulator Toolbar Controls
    const singleModeBtn = document.getElementById('btnModeSingle');
    const galleryModeBtn = document.getElementById('btnModeGallery');
    const screenJumper = document.getElementById('screenJumperSelect');

    if (singleModeBtn) {
      singleModeBtn.addEventListener('click', () => this.switchViewMode('single'));
    }
    if (galleryModeBtn) {
      galleryModeBtn.addEventListener('click', () => this.switchViewMode('gallery'));
    }
    if (screenJumper) {
      screenJumper.addEventListener('change', (e) => {
        this.navigateTo(e.target.value);
        if (this.currentViewMode === 'gallery') {
          this.switchViewMode('single');
        }
      });
    }

    // Bottom Navigation Bar Items
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const targetScreen = item.getAttribute('data-screen');
        if (targetScreen) {
          this.navigateTo(targetScreen);
        }
      });
    });

    // Close Bottom Sheet Events
    const sheetBackdrop = document.getElementById('sheetBackdrop');
    const sheetCloseBtn = document.getElementById('sheetCloseBtn');
    const sheetDragHandle = document.getElementById('sheetDragHandle');
    if (sheetBackdrop) sheetBackdrop.addEventListener('click', () => this.closeBottomSheet());
    if (sheetCloseBtn) sheetCloseBtn.addEventListener('click', () => this.closeBottomSheet());
    if (sheetDragHandle) sheetDragHandle.addEventListener('click', () => this.closeBottomSheet());

    // Delegate Click Events across the App
    document.addEventListener('click', (e) => {
      // Balance Eye Toggle
      const eyeBtn = e.target.closest('#balanceEyeToggle');
      if (eyeBtn) {
        this.toggleBalanceVisibility();
        return;
      }

      // Currency Switcher
      const currencyBtn = e.target.closest('#currencySelectPill');
      if (currencyBtn) {
        this.toggleCurrency();
        return;
      }

      // Back Button
      const backBtn = e.target.closest('.back-btn-circle');
      if (backBtn) {
        this.goBack();
        return;
      }

      // Copy Referral Code with Animated Checkmark Microinteraction
      const copyBtn = e.target.closest('#copyReferralBtn');
      if (copyBtn) {
        navigator.clipboard?.writeText(mockData.user.referralCode);
        const originalHTML = copyBtn.innerHTML;
        copyBtn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#12B76A" stroke-width="3.5" style="margin-right: 3px;"><polyline points="20 6 9 17 4 12"/></svg>
          <span style="color: #12B76A; font-weight: 800;">Copied!</span>
        `;
        copyBtn.style.background = '#FFFFFF';
        this.showToast(`Referral code "${mockData.user.referralCode}" copied!`);
        setTimeout(() => {
          copyBtn.innerHTML = originalHTML;
          copyBtn.style.background = '';
        }, 2200);
        return;
      }

      // Navigate to Miner Details
      const minerCard = e.target.closest('[data-miner-card]');
      if (minerCard) {
        this.navigateTo('miner-details');
        return;
      }

      // Navigate to Rewards
      const rewardsBtn = e.target.closest('[data-open-rewards]');
      if (rewardsBtn) {
        this.navigateTo('rewards');
        return;
      }

      // Navigate to News
      const newsBtn = e.target.closest('[data-open-news]');
      if (newsBtn) {
        this.navigateTo('news');
        return;
      }

      // Navigate to Academy
      const academyBtn = e.target.closest('[data-open-academy]');
      if (academyBtn) {
        this.navigateTo('academy');
        return;
      }

      // Navigate to Settings
      const settingsBtn = e.target.closest('[data-open-settings]');
      if (settingsBtn) {
        this.navigateTo('settings');
        return;
      }

      // Open 2FA Setup Sheet
      const setup2faBtn = e.target.closest('[data-setup-2fa]');
      if (setup2faBtn) {
        this.openBottomSheet('2fa');
        return;
      }

      // Open Add Miner / Buy Sheet
      const addMinerBtn = e.target.closest('[data-add-miner]');
      if (addMinerBtn) {
        this.openBottomSheet('buy');
        return;
      }

      // Filter Pills in Miners Screen
      const minerPill = e.target.closest('.miners-filter-pill');
      if (minerPill) {
        document.querySelectorAll('.miners-filter-pill').forEach(p => p.classList.remove('active'));
        minerPill.classList.add('active');
        this.minersFilter = minerPill.getAttribute('data-filter') || 'all';
        this.filterMinersList(this.minersFilter);
        return;
      }

      // Filter Pills in Market Screen
      const marketPill = e.target.closest('.market-filter-pill');
      if (marketPill) {
        document.querySelectorAll('.market-filter-pill').forEach(p => p.classList.remove('active'));
        marketPill.classList.add('active');
        this.marketFilter = marketPill.getAttribute('data-filter') || 'all';
        this.filterMarketList(this.marketFilter);
        return;
      }

      // Segmented Tabs in Wallet Screen
      const walletSegTab = e.target.closest('.wallet-seg-tab');
      if (walletSegTab) {
        document.querySelectorAll('.wallet-seg-tab').forEach(t => t.classList.remove('active'));
        walletSegTab.classList.add('active');
        this.walletTab = walletSegTab.getAttribute('data-tab') || 'assets';
        this.toggleWalletTab(this.walletTab);
        return;
      }

      // Action shortcut buttons (Deposit, Withdraw, Buy, Send, Receive)
      const actionBtn = e.target.closest('.action-shortcut-item');
      if (actionBtn) {
        const action = actionBtn.getAttribute('data-action');
        this.openBottomSheet(action);
        return;
      }

      // Star favorite toggles with Micro-bounce
      const starBtn = e.target.closest('.star-favorite-btn');
      if (starBtn) {
        starBtn.classList.toggle('active');
        this.showToast(starBtn.classList.contains('active') ? 'Added to favorites' : 'Removed from favorites');
        return;
      }
    });
  }

  /* Opens Modern Liquid-Glass Bottom Sheet */
  openBottomSheet(type) {
    const backdrop = document.getElementById('sheetBackdrop');
    const sheet = document.getElementById('mainBottomSheet');
    const titleEl = document.getElementById('sheetTitle');
    const bodyEl = document.getElementById('sheetBodyContent');
    if (!backdrop || !sheet) return;

    if (type === 'deposit') {
      titleEl.textContent = 'Instant Deposit (Lightning)';
      bodyEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 14px; text-align: center;">
          <p style="font-size: 13px; color: var(--text-secondary);">Send Bitcoin instantly via Lightning Network with zero fees.</p>
          <div style="background: #F4F0FD; border: 1px dashed var(--color-lavender-border); border-radius: 18px; padding: 14px; display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <div style="width: 130px; height: 130px; background: #FFFFFF; border-radius: 12px; display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow-subtle);">
              <svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="#25105C" stroke-width="1.8"><rect width="10" height="10" x="3" y="3" rx="2"/><rect width="10" height="10" x="14" y="3" rx="2"/><rect width="10" height="10" x="3" y="14" rx="2"/><circle cx="18" cy="18" r="3"/><line x1="8" y1="8" x2="8.01" y2="8"/><line x1="19" y1="8" x2="19.01" y2="8"/><line x1="8" y1="19" x2="8.01" y2="19"/></svg>
            </div>
            <span style="font-size: 13px; font-weight: 700; color: var(--text-primary);">nitish@speed.app</span>
          </div>
          <button class="btn-primary" style="width: 100%; padding: 11px;" onclick="window.bitmineApp.copyAndClose('nitish@speed.app', 'Lightning address copied!')">
            Copy Lightning Address
          </button>
        </div>
      `;
    } else if (type === 'withdraw') {
      titleEl.textContent = 'Lightning Withdrawal';
      bodyEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 14px;">
          <p style="font-size: 13px; color: var(--text-secondary);">Minimum payout is 2,500 sats. Instant settlement via Speed.</p>
          <div>
            <label style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Speed Address or BOLT11</label>
            <input type="text" placeholder="name@speed.app or lnbc..." value="nitish@speed.app" style="width: 100%; background: #F3F3F8; border: 1px solid var(--border-subtle); border-radius: 12px; padding: 10px 14px; font-size: 14px; margin-top: 4px; font-weight: 600;"/>
          </div>
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">
              <span>Amount (Sats)</span>
              <span style="color: var(--color-primary-purple); cursor: pointer;" onclick="document.getElementById('wdAmt').value='1860000'">Max (1,860,000 sats)</span>
            </div>
            <input id="wdAmt" type="number" placeholder="2500" value="5000" style="width: 100%; background: #F3F3F8; border: 1px solid var(--border-subtle); border-radius: 12px; padding: 10px 14px; font-size: 14px; margin-top: 4px; font-weight: 700; color: var(--text-primary);"/>
          </div>
          <button class="btn-primary" style="width: 100%; padding: 11px;" onclick="window.bitmineApp.simulateWithdrawal()">
            Confirm Withdrawal
          </button>
        </div>
      `;
    } else if (type === 'buy' || type === 'add-miner') {
      titleEl.textContent = 'Cloud Mining Hardware';
      bodyEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <p style="font-size: 13px; color: var(--text-secondary);">Lease 24/7 dedicated ASIC hashpower for 180 days.</p>
          <div style="background: #FAF8FE; border: 1px solid var(--color-lavender-border); border-radius: 16px; padding: 12px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <h4 style="font-size: 14px; font-weight: 800;">Titan Miner Pack</h4>
              <p style="font-size: 11px; color: var(--text-secondary);">2,000 GH/s · 180 Days 24/7</p>
            </div>
            <span style="font-size: 16px; font-weight: 800; color: var(--color-primary-purple);">$49.99</span>
          </div>
          <div style="background: #FAF8FE; border: 1px solid var(--color-lavender-border); border-radius: 16px; padding: 12px; display: flex; justify-content: space-between; align-items: center;">
            <div>
              <h4 style="font-size: 14px; font-weight: 800;">Super Miner Pro</h4>
              <p style="font-size: 11px; color: var(--text-secondary);">+50 claims/day at 10 GH/s · 365 Days</p>
            </div>
            <span style="font-size: 16px; font-weight: 800; color: var(--color-primary-purple);">$49.00</span>
          </div>
          <button class="btn-primary" style="width: 100%; padding: 11px;" onclick="window.bitmineApp.simulateBuy()">
            Lease Hashpower
          </button>
        </div>
      `;
    } else if (type === '2fa') {
      titleEl.textContent = 'Two-Factor Authentication';
      bodyEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 14px; text-align: center;">
          <p style="font-size: 13px; color: var(--text-secondary);">We sent a 6-digit verification code to <strong>nitish@example.com</strong>.</p>
          <div style="display: flex; justify-content: center; gap: 8px; margin: 4px 0;">
            <input type="text" maxlength="1" value="8" style="width: 44px; height: 48px; text-align: center; font-size: 20px; font-weight: 800; background: #F3F3F8; border: 1px solid var(--border-subtle); border-radius: 12px;"/>
            <input type="text" maxlength="1" value="3" style="width: 44px; height: 48px; text-align: center; font-size: 20px; font-weight: 800; background: #F3F3F8; border: 1px solid var(--border-subtle); border-radius: 12px;"/>
            <input type="text" maxlength="1" value="9" style="width: 44px; height: 48px; text-align: center; font-size: 20px; font-weight: 800; background: #F3F3F8; border: 1px solid var(--border-subtle); border-radius: 12px;"/>
            <input type="text" maxlength="1" value="2" style="width: 44px; height: 48px; text-align: center; font-size: 20px; font-weight: 800; background: #F3F3F8; border: 1px solid var(--border-subtle); border-radius: 12px;"/>
            <input type="text" maxlength="1" value="1" style="width: 44px; height: 48px; text-align: center; font-size: 20px; font-weight: 800; background: #F3F3F8; border: 1px solid var(--border-subtle); border-radius: 12px;"/>
            <input type="text" maxlength="1" value="7" style="width: 44px; height: 48px; text-align: center; font-size: 20px; font-weight: 800; background: #F3F3F8; border: 1px solid var(--border-subtle); border-radius: 12px;"/>
          </div>
          <button class="btn-primary" style="width: 100%; padding: 11px;" onclick="window.bitmineApp.copyAndClose('', '2FA Successfully Enabled!')">
            Verify & Activate 2FA
          </button>
        </div>
      `;
    } else {
      titleEl.textContent = `${type.toUpperCase()} Action`;
      bodyEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <p style="font-size: 13px; color: var(--text-secondary);">Execute ${type} action on your BitMine cloud account.</p>
          <button class="btn-primary" style="width: 100%; padding: 11px;" onclick="window.bitmineApp.closeBottomSheet()">Confirm</button>
        </div>
      `;
    }

    backdrop.classList.add('active');
    sheet.classList.add('active');
  }

  closeBottomSheet() {
    const backdrop = document.getElementById('sheetBackdrop');
    const sheet = document.getElementById('mainBottomSheet');
    if (backdrop) backdrop.classList.remove('active');
    if (sheet) sheet.classList.remove('active');
  }

  copyAndClose(text, message) {
    if (text) navigator.clipboard?.writeText(text);
    this.closeBottomSheet();
    this.showToast(message);
  }

  simulateWithdrawal() {
    this.closeBottomSheet();
    this.showToast('Withdrawal of 5,000 sats submitted for review!');
  }

  simulateBuy() {
    this.closeBottomSheet();
    this.showToast('Miner activated! Hashpower added to your account.');
  }

  /* Live Number Counter Interpolation */
  animateNumber(el, start, end, duration, formatFn) {
    if (!el) return;
    const startTime = performance.now();
    const update = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * ease;
      el.textContent = formatFn(current);
      if (progress < 1) {
        requestAnimationFrame(update);
      }
    };
    requestAnimationFrame(update);
  }

  /* Live Cloud Mining Accrual Ticker */
  startLiveAccrualTicker() {
    setInterval(() => {
      if (this.balanceHidden) return;
      // Increment satoshis slightly
      mockData.user.balanceUsd += 0.01;
      mockData.user.balanceBtc = Number((mockData.user.balanceBtc + 0.00000002).toFixed(6));

      const balanceEl = document.querySelector('.hero-balance-value');
      const walletMainEl = document.querySelector('.wallet-main-amount');
      const walletSubEl = document.querySelector('.wallet-btc-equiv');

      if (balanceEl && this.currentCurrency === 'USD') {
        balanceEl.textContent = `$${mockData.user.balanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
      if (walletMainEl) {
        if (this.currentCurrency === 'USD') {
          walletMainEl.textContent = `$${mockData.user.balanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
          if (walletSubEl) walletSubEl.textContent = `≈ ${mockData.user.balanceBtc} BTC`;
        } else {
          walletMainEl.textContent = `${mockData.user.balanceBtc} BTC`;
          if (walletSubEl) walletSubEl.textContent = `≈ $${mockData.user.balanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
        }
      }
    }, 4000);
  }

  switchViewMode(mode) {
    this.currentViewMode = mode;
    const singleStage = document.getElementById('singleSimulatorStage');
    const galleryStage = document.getElementById('multiGalleryStage');
    const btnSingle = document.getElementById('btnModeSingle');
    const btnGallery = document.getElementById('btnModeGallery');

    if (mode === 'single') {
      singleStage.style.display = 'flex';
      galleryStage.classList.remove('active');
      btnSingle.classList.add('active');
      btnGallery.classList.remove('active');
    } else {
      singleStage.style.display = 'none';
      galleryStage.classList.add('active');
      btnSingle.classList.remove('active');
      btnGallery.classList.add('active');
    }
  }

  navigateTo(screenId) {
    if (this.currentScreen !== screenId) {
      this.screenHistory.push(this.currentScreen);
    }
    this.currentScreen = screenId;
    this.renderScreen(screenId);

    // Update screen jumper dropdown
    const jumper = document.getElementById('screenJumperSelect');
    if (jumper) {
      jumper.value = screenId;
    }

    // Scroll to top
    const container = document.getElementById('activeScreenContainer');
    if (container) {
      container.scrollTop = 0;
    }
  }

  goBack() {
    if (this.screenHistory.length > 0) {
      const prev = this.screenHistory.pop();
      this.currentScreen = prev;
      this.renderScreen(prev);
    } else {
      this.navigateTo('home');
    }
  }

  renderScreen(screenId) {
    const container = document.getElementById('activeScreenContainer');
    const bottomNav = document.getElementById('mainBottomNav');
    const statusBar = document.getElementById('phoneStatusBar');

    // Sync Bottom Navigation items
    const primaryTabs = ['home', 'wallet', 'miners', 'market', 'profile'];
    document.querySelectorAll('.nav-item').forEach(item => {
      const target = item.getAttribute('data-screen');
      if (target === screenId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // Check if bottom nav should be visible or hidden for detail screens
    if (primaryTabs.includes(screenId)) {
      bottomNav.style.display = 'flex';
    } else {
      // In mobile fintech apps, bottom nav can stay or be hidden; let's keep it visible for effortless exploration
      bottomNav.style.display = 'flex';
    }

    // Status bar text color adaptation (Home and Miner Details have dark hero top)
    if (screenId === 'home' || screenId === 'miner-details') {
      statusBar.classList.remove('dark-text');
      statusBar.classList.add('light-text');
    } else {
      statusBar.classList.remove('light-text');
      statusBar.classList.add('dark-text');
    }

    // Generate HTML for the active screen
    container.innerHTML = this.getScreenHTML(screenId);
  }

  toggleBalanceVisibility() {
    this.balanceHidden = !this.balanceHidden;
    const balanceEls = document.querySelectorAll('.hero-balance-value, .wallet-main-amount');
    balanceEls.forEach(el => {
      if (this.balanceHidden) {
        el.textContent = '••••••••';
      } else {
        el.textContent = this.currentCurrency === 'USD' ? `$${mockData.user.balanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : `${mockData.user.balanceBtc} BTC`;
      }
    });
    this.showToast(this.balanceHidden ? 'Balances hidden' : 'Balances visible');
  }

  toggleCurrency() {
    this.currentCurrency = this.currentCurrency === 'USD' ? 'BTC' : 'USD';
    const pill = document.getElementById('currencySelectPill');
    if (pill) {
      pill.innerHTML = `${this.currentCurrency} <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>`;
    }
    const balanceEl = document.querySelector('.wallet-main-amount');
    const subEl = document.querySelector('.wallet-btc-equiv');
    if (balanceEl && subEl && !this.balanceHidden) {
      if (this.currentCurrency === 'USD') {
        balanceEl.textContent = `$${mockData.user.balanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
        subEl.textContent = `≈ ${mockData.user.balanceBtc} BTC`;
      } else {
        balanceEl.textContent = `${mockData.user.balanceBtc} BTC`;
        subEl.textContent = `≈ $${mockData.user.balanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      }
    }
    this.showToast(`Currency changed to ${this.currentCurrency}`);
  }

  filterMinersList(filter) {
    const list = document.getElementById('minersCardList');
    if (!list) return;
    const cards = list.querySelectorAll('.miner-card-item');
    cards.forEach(card => {
      const status = card.getAttribute('data-status');
      if (filter === 'all' || status === filter) {
        card.style.display = 'flex';
      } else {
        card.style.display = 'none';
      }
    });
  }

  filterMarketList(filter) {
    const list = document.getElementById('marketCoinList');
    if (!list) return;
    const rows = list.querySelectorAll('.market-coin-row');
    rows.forEach(row => {
      const isPositive = row.getAttribute('data-positive') === 'true';
      if (filter === 'all') {
        row.style.display = 'flex';
      } else if (filter === 'gainers') {
        row.style.display = isPositive ? 'flex' : 'none';
      } else if (filter === 'losers') {
        row.style.display = !isPositive ? 'flex' : 'none';
      } else if (filter === 'favorites') {
        const isFav = row.querySelector('.star-favorite-btn')?.classList.contains('active');
        row.style.display = isFav ? 'flex' : 'none';
      }
    });
  }

  toggleWalletTab(tab) {
    const assetsContainer = document.getElementById('walletAssetsContainer');
    const txContainer = document.getElementById('walletTransactionsContainer');
    if (assetsContainer && txContainer) {
      if (tab === 'assets') {
        assetsContainer.style.display = 'block';
        txContainer.style.display = 'none';
      } else {
        assetsContainer.style.display = 'none';
        txContainer.style.display = 'block';
      }
    }
  }

  showToast(message) {
    const toast = document.getElementById('bmToast');
    if (toast) {
      toast.querySelector('.toast-msg').textContent = message;
      toast.classList.add('show');
      clearTimeout(this.toastTimeout);
      this.toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
      }, 2400);
    }
  }

  /* HTML Generator for All 10 Screens */
  getScreenHTML(screenId) {
    switch (screenId) {
      case 'home': return this.getHomeScreenHTML();
      case 'wallet': return this.getWalletScreenHTML();
      case 'miners': return this.getMinersScreenHTML();
      case 'market': return this.getMarketScreenHTML();
      case 'profile': return this.getProfileScreenHTML();
      case 'miner-details': return this.getMinerDetailsScreenHTML();
      case 'rewards': return this.getRewardsScreenHTML();
      case 'news': return this.getNewsScreenHTML();
      case 'academy': return this.getAcademyScreenHTML();
      case 'settings': return this.getSettingsScreenHTML();
      default: return this.getHomeScreenHTML();
    }
  }

  /* 1. HOME SCREEN */
  getHomeScreenHTML() {
    const u = mockData.user;
    return `
      <div class="screen-scroll-view animate-fade-up">
        <!-- Hero Dark Gradient Area -->
        <div class="home-hero">
          <!-- Ambient Drifting Glow Blobs -->
          <div class="hero-ambient-blob-1"></div>
          <div class="hero-ambient-blob-2"></div>

          <div class="hero-top-bar" style="margin-top: 32px;">
            <div class="hero-brand">
              <button class="hero-icon-btn" aria-label="Menu" data-open-settings>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
              </button>
              <span class="brand-title">BitMine</span>
              <div class="network-pill">
                <span class="pulse-dot"></span>
                <span>Mainnet</span>
              </div>
            </div>
            <div class="hero-top-icons">
              <button class="hero-icon-btn" aria-label="Notifications" data-open-news>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                <span class="notification-badge-dot"></span>
              </button>
              <button class="hero-icon-btn" aria-label="Profile" data-open-rewards>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
              </button>
            </div>
          </div>

          <div class="hero-balance-section">
            <div class="hero-balance-text">
              <span class="hero-greeting">Good morning,</span>
              <span class="hero-subtitle">Keep mining a brighter tomorrow</span>
              <div class="hero-balance-row">
                <span class="hero-balance-value">$${u.balanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                <button class="balance-eye-btn" id="balanceEyeToggle" aria-label="Toggle Balance">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
              </div>
              <div style="margin-top: 6px;">
                <span class="pct-pill glass-light">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m18 15-6-6-6 6"/></svg>
                  ${u.todayChangePct} today
                </span>
              </div>
            </div>

            <!-- Floating 3D Bitcoin Cloud Illustration -->
            <div class="hero-illustration">
              <img src="./assets/images/btc_cloud_hero.jpg" alt="Bitcoin Cloud" class="hero-cloud-img"/>
            </div>
          </div>

          <!-- 4 Circular Action Shortcuts -->
          <div class="action-shortcut-group">
            <div class="action-shortcut-item" data-action="deposit">
              <div class="action-circle-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
              </div>
              <span class="action-shortcut-label">Deposit</span>
            </div>
            <div class="action-shortcut-item" data-action="withdraw">
              <div class="action-circle-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
              </div>
              <span class="action-shortcut-label">Withdraw</span>
            </div>
            <div class="action-shortcut-item" data-action="buy">
              <div class="action-circle-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
              </div>
              <span class="action-shortcut-label">Buy</span>
            </div>
            <div class="action-shortcut-item" data-action="more">
              <div class="action-circle-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/></svg>
              </div>
              <span class="action-shortcut-label">More</span>
            </div>
          </div>

          <!-- Security 2FA Card -->
          <div class="security-alert-card">
            <div class="security-alert-left">
              <div class="shield-icon-glow">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              </div>
              <div class="security-alert-text">
                <h4>Secure Your Account</h4>
                <p>Enable 2FA to keep your assets safe and secure.</p>
              </div>
            </div>
            <button class="btn-primary" style="padding: 7px 14px; font-size: 12px;" data-setup-2fa>Set Up</button>
          </div>
        </div>

        <!-- Dashboard Content Body -->
        <div class="screen-content-padding" style="margin-top: 4px;">
          <!-- Horizontal Crypto Market Ticker -->
          <div class="crypto-ticker-scroll">
            <div class="crypto-ticker-item" data-screen="market">
              <span class="coin-mini-icon" style="background: #F7931A;">₿</span>
              <span style="font-size: 12px; font-weight: 700;">BTC</span>
              <span style="font-size: 12px; font-weight: 700; color: #171622;">$67,284</span>
              <span class="pct-pill gain" style="padding: 1px 5px; font-size: 10px;">+2.4%</span>
            </div>
            <div class="crypto-ticker-item" data-screen="market">
              <span class="coin-mini-icon" style="background: #627EEA;">Ξ</span>
              <span style="font-size: 12px; font-weight: 700;">ETH</span>
              <span style="font-size: 12px; font-weight: 700; color: #171622;">$3,412</span>
              <span class="pct-pill gain" style="padding: 1px 5px; font-size: 10px;">+1.8%</span>
            </div>
            <div class="crypto-ticker-item" data-screen="market">
              <span class="coin-mini-icon" style="background: #14F195; color: #000;">S</span>
              <span style="font-size: 12px; font-weight: 700;">SOL</span>
              <span style="font-size: 12px; font-weight: 700; color: #171622;">$158.21</span>
              <span class="pct-pill gain" style="padding: 1px 5px; font-size: 10px;">+3.1%</span>
            </div>
          </div>

          <!-- Section: Your Mining Overview -->
          <div class="section-header-row">
            <span class="section-title">Your Mining Overview</span>
            <span class="section-link" data-screen="miners">View All</span>
          </div>

          <!-- 2-Column Stat Cards -->
          <div class="overview-grid">
            <div class="bm-stat-card" data-miner-card>
              <div class="icon-box-purple">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
              </div>
              <div>
                <span class="text-xs text-muted" style="font-weight: 600; text-transform: uppercase;">Total Hashrate</span>
                <div style="display: flex; align-items: baseline; gap: 6px; margin-top: 2px;">
                  <strong style="font-size: 17px; font-weight: 800; color: var(--text-primary);">${u.totalHashrate}</strong>
                  <span class="pct-pill gain" style="padding: 1px 5px; font-size: 10px;">${u.totalHashrateChange}</span>
                </div>
              </div>
            </div>

            <div class="bm-stat-card" data-miner-card>
              <div class="icon-box-purple">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 12v10H4V12"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>
              </div>
              <div>
                <span class="text-xs text-muted" style="font-weight: 600; text-transform: uppercase;">Total Rewards</span>
                <div style="margin-top: 2px;">
                  <strong style="font-size: 16px; font-weight: 800; color: var(--text-primary);">${u.totalRewardsBtc}</strong>
                  <span class="text-xs text-muted" style="display: block;">≈ ${u.totalRewardsUsd}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Promotional Upgrade Card -->
          <div class="promo-upgrade-card" data-add-miner>
            <div class="promo-left">
              <div class="promo-miner-thumb">
                <img src="./assets/images/miner_rig_3d.jpg" alt="Miner"/>
              </div>
              <div class="promo-text">
                <h4>Upgrade Your Mining Power</h4>
                <p>Get higher rewards with premium miners.</p>
              </div>
            </div>
            <div style="color: var(--color-primary-purple);">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* 2. WALLET SCREEN */
  getWalletScreenHTML() {
    const u = mockData.user;
    return `
      <div class="screen-scroll-view animate-fade-up">
        <!-- Light Top Header -->
        <div class="screen-header" style="padding-top: 36px;">
          <h2 class="screen-title">Wallet</h2>
          <div class="screen-header-right">
            <button class="icon-action-btn" aria-label="QR Scanner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect width="10" height="10" x="7" y="7" rx="2"/></svg>
            </button>
          </div>
        </div>

        <div class="screen-content-padding" style="gap: 14px;">
          <!-- Total Balance Card -->
          <div class="bm-card wallet-balance-card">
            <div class="wallet-balance-label-row">
              <span class="text-xs text-muted" style="font-weight: 600; text-transform: uppercase;">Total Balance</span>
              <button class="currency-select-pill" id="currencySelectPill">
                ${this.currentCurrency}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>
              </button>
            </div>
            <div class="wallet-main-amount">$${u.balanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
            <div class="wallet-btc-equiv">≈ ${u.balanceBtc} BTC</div>

            <!-- 4 Circular Action Buttons (Light Soft Lavender Style) -->
            <div class="action-shortcut-group" style="margin-top: 18px;">
              <div class="action-shortcut-item" data-action="deposit">
                <div class="action-circle-btn light">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
                </div>
                <span class="action-shortcut-label light">Deposit</span>
              </div>
              <div class="action-shortcut-item" data-action="withdraw">
                <div class="action-circle-btn light">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
                </div>
                <span class="action-shortcut-label light">Withdraw</span>
              </div>
              <div class="action-shortcut-item" data-action="send">
                <div class="action-circle-btn light">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </div>
                <span class="action-shortcut-label light">Send</span>
              </div>
              <div class="action-shortcut-item" data-action="receive">
                <div class="action-circle-btn light">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </div>
                <span class="action-shortcut-label light">Receive</span>
              </div>
            </div>
          </div>

          <!-- Segmented Control (Assets vs Transactions) -->
          <div class="segmented-control">
            <div class="segmented-tab wallet-seg-tab active" data-tab="assets">Assets</div>
            <div class="segmented-tab wallet-seg-tab" data-tab="transactions">Transactions</div>
          </div>

          <!-- Asset List Container -->
          <div id="walletAssetsContainer" class="bm-card" style="padding: 0; overflow: hidden;">
            ${mockData.cryptoMarket.slice(0, 5).map(c => `
              <div class="asset-item-row" data-screen="market">
                <div class="asset-left">
                  <div class="asset-icon-circle" style="background: ${c.color};">
                    ${c.symbol === 'BTC' ? '₿' : c.symbol === 'ETH' ? 'Ξ' : c.symbol[0]}
                  </div>
                  <div class="asset-names">
                    <h4>${c.symbol}</h4>
                    <p>${c.name}</p>
                  </div>
                </div>
                <div class="asset-right">
                  <span class="asset-amount">${c.amount}</span>
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span class="asset-fiat-value">${c.fiatValue}</span>
                    <span class="pct-pill ${c.isPositive ? 'gain' : 'loss'}" style="font-size: 10px; padding: 1px 5px;">${c.change24h}</span>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>

          <!-- Transactions Container (Hidden initially) -->
          <div id="walletTransactionsContainer" class="bm-card" style="display: none; padding: 16px;">
            <div style="display: flex; flex-direction: column; gap: 12px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <h4 style="font-size: 14px; font-weight: 700;">Daily Mining Reward</h4>
                  <p style="font-size: 11px; color: var(--text-secondary);">Today, 00:00 UTC · Standard Miner</p>
                </div>
                <span style="font-size: 14px; font-weight: 700; color: var(--color-success);">+0.00048 BTC</span>
              </div>
              <div style="border-top: 1px solid #F1F1F6; padding-top: 12px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <h4 style="font-size: 14px; font-weight: 700;">Lightning Withdrawal</h4>
                  <p style="font-size: 11px; color: var(--text-secondary);">Yesterday, 14:22 · Speed Lightning</p>
                </div>
                <span style="font-size: 14px; font-weight: 700; color: var(--text-primary);">-2,500 sats</span>
              </div>
            </div>
          </div>

          <!-- Bottom Promotional Banner -->
          <div class="promo-upgrade-card" style="background: linear-gradient(135deg, #F0EAFE 0%, #FFFFFF 100%);">
            <div class="promo-left">
              <div class="promo-miner-thumb" style="background: #180F33;">
                <img src="./assets/images/rocket_rewards.jpg" alt="Earn"/>
              </div>
              <div class="promo-text">
                <h4>Earn More with BitMine</h4>
                <p>Stake, mine and grow your crypto.</p>
              </div>
            </div>
            <button class="btn-primary" style="padding: 7px 14px; font-size: 11px;" data-open-rewards>Get Started</button>
          </div>
        </div>
      </div>
    `;
  }

  /* 3. MY MINERS SCREEN */
  getMinersScreenHTML() {
    return `
      <div class="screen-scroll-view animate-fade-up">
        <!-- Screen Header -->
        <div class="screen-header" style="padding-top: 36px;">
          <h2 class="screen-title">My Miners</h2>
          <button class="btn-primary" style="padding: 6px 14px; font-size: 12px;" data-add-miner>+ Add Miner</button>
        </div>

        <div class="screen-content-padding" style="gap: 14px;">
          <!-- Filter Tabs -->
          <div class="filter-pills-row">
            <button class="filter-pill miners-filter-pill active" data-filter="all">All (3)</button>
            <button class="filter-pill miners-filter-pill" data-filter="active">Active (2)</button>
            <button class="filter-pill miners-filter-pill" data-filter="inactive">Inactive (1)</button>
          </div>

          <!-- Miner Cards List -->
          <div id="minersCardList" style="display: flex; flex-direction: column; gap: 14px;">
            ${mockData.miners.map(m => `
              <div class="miner-card-item" data-miner-card data-status="${m.status.toLowerCase()}">
                <div class="miner-card-header">
                  <div class="miner-id-title">
                    <div class="icon-box-purple sm">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
                    </div>
                    <div>
                      <h4>${m.id}</h4>
                      <p>${m.name}</p>
                    </div>
                  </div>
                  <span class="badge-status ${m.status.toLowerCase()}">
                    <span class="dot"></span>
                    ${m.status}
                  </span>
                </div>

                <div class="miner-body-grid">
                  <div class="miner-chassis-preview">
                    <img src="${m.image}" alt="${m.name}" style="${m.status === 'Inactive' ? 'filter: grayscale(0.8) opacity(0.7);' : ''}"/>
                  </div>
                  <div class="miner-stats-col">
                    <div class="miner-stat-row">
                      <div class="icon-box-purple sm" style="width: 26px; height: 26px; border-radius: 6px;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                      </div>
                      <div class="miner-stat-text">
                        <span>Hashrate</span>
                        <strong>${m.hashrate}</strong>
                      </div>
                    </div>
                    <div class="miner-stat-row">
                      <div class="icon-box-purple sm" style="width: 26px; height: 26px; border-radius: 6px;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v12"/><path d="M16 10H9.5a2.5 2.5 0 0 0 0 5H14"/></svg>
                      </div>
                      <div class="miner-stat-text">
                        <span>Total Mined</span>
                        <strong>${m.totalMined}</strong>
                      </div>
                    </div>
                  </div>
                </div>

                ${m.status === 'Active' ? `
                  <div>
                    <div class="bm-progress-track">
                      <div class="bm-progress-fill" style="width: ${m.progress}%;"></div>
                    </div>
                    <div class="miner-payout-info">
                      <span>Next payout in <strong>${m.nextPayout}</strong></span>
                      <span style="font-weight: 700; color: var(--color-primary-purple);">${m.progress}%</span>
                    </div>
                  </div>
                ` : `
                  <button class="btn-primary" style="width: 100%; padding: 8px; font-size: 13px;">Reactivate</button>
                `}
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  /* 4. MARKET SCREEN */
  getMarketScreenHTML() {
    return `
      <div class="screen-scroll-view animate-fade-up">
        <!-- Screen Header -->
        <div class="screen-header" style="padding-top: 36px;">
          <h2 class="screen-title">Market</h2>
          <div class="screen-header-right">
            <button class="icon-action-btn" aria-label="Search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </button>
            <button class="icon-action-btn" aria-label="Favorites">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            </button>
          </div>
        </div>

        <div class="screen-content-padding" style="gap: 14px;">
          <!-- Filter Tabs -->
          <div class="filter-pills-row">
            <button class="filter-pill market-filter-pill active" data-filter="all">All</button>
            <button class="filter-pill market-filter-pill" data-filter="gainers">Top Gainers</button>
            <button class="filter-pill market-filter-pill" data-filter="losers">Top Losers</button>
            <button class="filter-pill market-filter-pill" data-filter="favorites">Favorites</button>
          </div>

          <!-- Coin List Table -->
          <div class="bm-card" style="padding: 6px 0; overflow: hidden;">
            <div class="market-table-header">
              <span style="width: 38%;">Coin</span>
              <span style="width: 28%; text-align: right;">Price</span>
              <span style="width: 34%; text-align: right;">24h</span>
            </div>

            <div id="marketCoinList">
              ${mockData.cryptoMarket.map(c => `
                <div class="market-coin-row" data-positive="${c.isPositive}">
                  <div class="market-coin-left">
                    <div class="asset-icon-circle" style="width: 34px; height: 34px; font-size: 13px; background: ${c.color};">
                      ${c.symbol === 'BTC' ? '₿' : c.symbol === 'ETH' ? 'Ξ' : c.symbol[0]}
                    </div>
                    <div>
                      <h4 style="font-size: 14px; font-weight: 700; color: var(--text-primary);">${c.symbol}</h4>
                      <p style="font-size: 11px; color: var(--text-secondary);">${c.name}</p>
                    </div>
                  </div>

                  <div class="market-coin-center">
                    ${c.price}
                  </div>

                  <div class="market-coin-right">
                    <!-- Mini Sparkline SVG -->
                    <svg class="sparkline-svg" viewBox="0 0 48 24">
                      <path d="${c.sparkline}" fill="none" stroke="${c.isPositive ? '#12B76A' : '#F04438'}" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    <span class="pct-pill ${c.isPositive ? 'gain' : 'loss'}" style="font-size: 11px; padding: 2px 6px;">
                      ${c.change24h}
                    </span>
                    <button class="star-favorite-btn" aria-label="Favorite">
                      <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Market Alert Banner -->
          <div class="promo-upgrade-card" style="background: linear-gradient(135deg, #F0EAFE 0%, #FFFFFF 100%);">
            <div class="promo-left">
              <div class="icon-box-purple" style="background: var(--color-primary-purple); color: #FFF;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              </div>
              <div class="promo-text">
                <h4>Stay Ahead of the Market</h4>
                <p>Get real-time alerts and insights.</p>
              </div>
            </div>
            <div style="color: var(--color-primary-purple);">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* 5. PROFILE SCREEN */
  getProfileScreenHTML() {
    const u = mockData.user;
    return `
      <div class="screen-scroll-view animate-fade-up">
        <!-- Header -->
        <div class="screen-header" style="padding-top: 36px;">
          <h2 class="screen-title">Profile</h2>
          <button class="icon-action-btn" aria-label="Settings" data-open-settings>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        </div>

        <div class="screen-content-padding" style="gap: 14px;">
          <!-- User Info Card -->
          <div class="profile-user-card" data-open-settings>
            <div class="profile-user-left">
              <div class="profile-avatar-circle">
                <img src="${u.avatar}" alt="${u.name}"/>
              </div>
              <div class="profile-user-meta">
                <h3>${u.name}</h3>
                <p>${u.email}</p>
              </div>
            </div>
            <div style="color: var(--text-muted);">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg>
            </div>
          </div>

          <!-- My Rewards Banner -->
          <div class="profile-rewards-banner" data-open-rewards>
            <div>
              <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.85;">My Rewards</span>
              <h3 style="font-size: 19px; font-weight: 800; margin-top: 2px;">${u.rewardPoints.toLocaleString()} Points</h3>
            </div>
            <button class="btn-white">Redeem</button>
          </div>

          <!-- Grouped Section 1: Account Features -->
          <div class="grouped-list-section">
            <div class="grouped-list-item" data-open-settings>
              <div class="grouped-item-left">
                <div class="grouped-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
                </div>
                <span class="grouped-item-title">My Account</span>
              </div>
              <div class="grouped-item-right">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
              </div>
            </div>

            <div class="grouped-list-item">
              <div class="grouped-item-left">
                <div class="grouped-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><line x1="15" y1="8" x2="17" y2="8"/><line x1="15" y1="12" x2="17" y2="12"/></svg>
                </div>
                <span class="grouped-item-title">KYC Verification</span>
              </div>
              <div class="grouped-item-right">
                <span class="badge-status active">Verified</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
              </div>
            </div>

            <div class="grouped-list-item">
              <div class="grouped-item-left">
                <div class="grouped-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                </div>
                <span class="grouped-item-title">Payment Methods</span>
              </div>
              <div class="grouped-item-right">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
              </div>
            </div>

            <div class="grouped-list-item" data-screen="miners">
              <div class="grouped-item-left">
                <div class="grouped-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                </div>
                <span class="grouped-item-title">My Subscriptions</span>
              </div>
              <div class="grouped-item-right">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
              </div>
            </div>

            <div class="grouped-list-item" data-open-rewards>
              <div class="grouped-item-left">
                <div class="grouped-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 12v10H4V12"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/></svg>
                </div>
                <span class="grouped-item-title">Referral Program</span>
              </div>
              <div class="grouped-item-right">
                <span class="badge-status lavender">Earn Together</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
              </div>
            </div>

            <div class="grouped-list-item" data-open-news>
              <div class="grouped-item-left">
                <div class="grouped-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                </div>
                <span class="grouped-item-title">Notifications</span>
              </div>
              <div class="grouped-item-right">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
              </div>
            </div>
          </div>

          <!-- Grouped Section 2: Support & Info -->
          <div class="grouped-list-section">
            <div class="grouped-list-item" data-open-academy>
              <div class="grouped-item-left">
                <div class="grouped-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
                </div>
                <span class="grouped-item-title">Help & Support</span>
              </div>
              <div class="grouped-item-right">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
              </div>
            </div>

            <div class="grouped-list-item" data-open-academy>
              <div class="grouped-item-left">
                <div class="grouped-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                </div>
                <span class="grouped-item-title">FAQ</span>
              </div>
              <div class="grouped-item-right">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
              </div>
            </div>

            <div class="grouped-list-item">
              <div class="grouped-item-left">
                <div class="grouped-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                </div>
                <span class="grouped-item-title">Rate BitMine</span>
              </div>
              <div class="grouped-item-right">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
              </div>
            </div>
          </div>

          <!-- Grouped Section 3: Logout -->
          <div class="grouped-list-section">
            <div class="grouped-list-item" style="color: var(--color-danger);">
              <div class="grouped-item-left">
                <div class="grouped-item-icon" style="background: var(--color-danger-bg); color: var(--color-danger);">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                </div>
                <span class="grouped-item-title" style="color: var(--color-danger); font-weight: 600;">Log Out</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* 6. MINER DETAILS SCREEN */
  getMinerDetailsScreenHTML() {
    return `
      <div class="screen-scroll-view animate-fade-up">
        <!-- Screen Header -->
        <div class="screen-header" style="padding-top: 36px;">
          <div class="screen-header-left">
            <button class="back-btn-circle" aria-label="Back">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <h2 class="screen-title">Miner Details</h2>
          </div>
          <button class="icon-action-btn" aria-label="Options">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/></svg>
          </button>
        </div>

        <div class="screen-content-padding" style="gap: 16px;">
          <!-- 3D Miner Showcase Hero -->
          <div class="miner-hero-showcase">
            <div class="miner-showcase-rig">
              <img src="./assets/images/miner_rig_3d.jpg" alt="Miner Rig"/>
            </div>
            <div style="margin-top: 10px;">
              <span class="badge-status active" style="margin-bottom: 8px;">
                <span class="dot"></span> Active
              </span>
              <h3 style="font-size: 20px; font-weight: 800;">BM-001 Standard Miner</h3>
              <p style="font-size: 12px; color: rgba(255, 255, 255, 0.7); margin-top: 4px;">A reliable miner for steady growth.</p>
            </div>
          </div>

          <!-- 4-Grid Miner Stats -->
          <div class="miner-details-grid">
            <div class="bm-stat-card">
              <span class="text-xs text-muted" style="font-weight: 600; text-transform: uppercase;">Hashrate</span>
              <strong style="font-size: 18px; font-weight: 800; color: var(--text-primary);">1.00 TH/s</strong>
            </div>
            <div class="bm-stat-card">
              <span class="text-xs text-muted" style="font-weight: 600; text-transform: uppercase;">Power Efficiency</span>
              <strong style="font-size: 18px; font-weight: 800; color: var(--text-primary);">0.08 J/GH</strong>
            </div>
            <div class="bm-stat-card">
              <span class="text-xs text-muted" style="font-weight: 600; text-transform: uppercase;">Total Mined</span>
              <strong style="font-size: 18px; font-weight: 800; color: var(--text-primary);">0.0124 BTC</strong>
            </div>
            <div class="bm-stat-card">
              <span class="text-xs text-muted" style="font-weight: 600; text-transform: uppercase;">Uptime</span>
              <strong style="font-size: 18px; font-weight: 800; color: var(--color-success);">99.8%</strong>
            </div>
          </div>

          <!-- Payout Progress Card -->
          <div class="bm-card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span class="text-sm font-semibold text-primary">Payout Progress</span>
              <span class="text-sm font-bold text-purple">78%</span>
            </div>
            <div class="bm-progress-track">
              <div class="bm-progress-fill" style="width: 78%;"></div>
            </div>
            <div class="miner-payout-info" style="margin-top: 8px;">
              <span>Next payout in <strong>2d 4h 12m</strong></span>
              <span>Estimated: <strong>0.0021 BTC</strong></span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* 7. REWARDS SCREEN */
  getRewardsScreenHTML() {
    const u = mockData.user;
    return `
      <div class="screen-scroll-view animate-fade-up">
        <!-- Header -->
        <div class="screen-header" style="padding-top: 36px;">
          <div class="screen-header-left">
            <button class="back-btn-circle" aria-label="Back">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <h2 class="screen-title">Rewards</h2>
          </div>
        </div>

        <div class="screen-content-padding" style="gap: 16px;">
          <!-- Invite & Earn Hero Card -->
          <div class="rewards-hero-card">
            <div class="rewards-hero-content">
              <h3>Invite & Earn</h3>
              <p>Get 10% bonus on your friend's mining rewards.</p>
              <div class="referral-box-row">
                <span class="referral-code-text">${u.referralCode}</span>
                <button class="btn-primary" id="copyReferralBtn" style="padding: 5px 14px; font-size: 11px;">Copy</button>
              </div>
            </div>
            <div class="rewards-rocket-illustration">
              <img src="./assets/images/rocket_rewards.jpg" alt="Rocket"/>
            </div>
          </div>

          <!-- Referral Stats Grid -->
          <div class="overview-grid">
            <div class="bm-stat-card">
              <div class="icon-box-purple">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </div>
              <div>
                <span class="text-xs text-muted" style="font-weight: 600; text-transform: uppercase;">Total Referrals</span>
                <strong style="font-size: 20px; font-weight: 800; color: var(--text-primary); display: block; margin-top: 2px;">${u.totalReferrals}</strong>
              </div>
            </div>

            <div class="bm-stat-card">
              <div class="icon-box-purple">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 12v10H4V12"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/></svg>
              </div>
              <div>
                <span class="text-xs text-muted" style="font-weight: 600; text-transform: uppercase;">Total Earned</span>
                <strong style="font-size: 16px; font-weight: 800; color: var(--text-primary); display: block; margin-top: 2px;">${u.totalEarnedBtc} BTC</strong>
                <span class="text-xs text-muted">≈ $${u.totalEarnedUsd}</span>
              </div>
            </div>
          </div>

          <!-- Milestone Rewards -->
          <div class="section-header-row" style="margin-top: 4px;">
            <span class="section-title">Milestone Rewards</span>
            <span class="section-link">View All</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 10px;">
            ${mockData.milestoneRewards.map(m => `
              <div class="bm-card" style="padding: 14px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <div class="icon-box-purple sm">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    </div>
                    <div>
                      <h4 style="font-size: 13px; font-weight: 700;">${m.title}</h4>
                      <p style="font-size: 11px; color: var(--text-secondary);">${m.reward}</p>
                    </div>
                  </div>
                  <span style="font-size: 12px; font-weight: 700; color: var(--color-primary-purple);">${m.progress}</span>
                </div>
                <div class="bm-progress-track">
                  <div class="bm-progress-fill" style="width: ${m.pct}%;"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  /* 8. NEWS SCREEN */
  getNewsScreenHTML() {
    return `
      <div class="screen-scroll-view animate-fade-up">
        <!-- Header -->
        <div class="screen-header" style="padding-top: 36px;">
          <div class="screen-header-left">
            <button class="back-btn-circle" aria-label="Back">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <h2 class="screen-title">News</h2>
          </div>
        </div>

        <div class="screen-content-padding" style="gap: 14px;">
          <!-- Filter Tabs -->
          <div class="filter-pills-row">
            <button class="filter-pill active">All</button>
            <button class="filter-pill">Bitcoin</button>
            <button class="filter-pill">Mining</button>
            <button class="filter-pill">Market</button>
            <button class="filter-pill">Web3</button>
          </div>

          <!-- Featured Article -->
          <div class="featured-news-card">
            <div class="featured-news-thumb">
              <img src="./assets/images/bitcoin_news_hero.jpg" alt="Bitcoin News"/>
            </div>
            <div class="featured-news-body">
              <span class="badge-status lavender" style="align-self: flex-start;">BITCOIN</span>
              <h3>Bitcoin Hits New Milestone as Institutional Adoption Grows</h3>
              <p>Major institutions continue to show confidence in Bitcoin as a long-term asset with record hash security.</p>
              <div class="news-meta-row">
                <span>Sep 20, 2026</span>
                <span>•</span>
                <span>4 min read</span>
              </div>
            </div>
          </div>

          <!-- Secondary Articles -->
          <div style="display: flex; flex-direction: column; gap: 12px;">
            ${mockData.newsArticles.slice(1).map(a => `
              <div class="bm-card" style="padding: 12px; display: flex; gap: 12px; align-items: center;">
                <div style="width: 76px; height: 76px; border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; background: #0B0A18;">
                  <img src="${a.image}" alt="${a.title}" style="width: 100%; height: 100%; object-fit: cover;"/>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                  <span class="badge-status lavender" style="font-size: 10px; padding: 1px 6px; align-self: flex-start;">${a.category}</span>
                  <h4 style="font-size: 13px; font-weight: 700; line-height: 1.3;">${a.title}</h4>
                  <div class="news-meta-row" style="font-size: 11px;">
                    <span>${a.date}</span>
                    <span>•</span>
                    <span>${a.readTime}</span>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  /* 9. ACADEMY SCREEN */
  getAcademyScreenHTML() {
    return `
      <div class="screen-scroll-view animate-fade-up">
        <!-- Header -->
        <div class="screen-header" style="padding-top: 36px;">
          <div class="screen-header-left">
            <button class="back-btn-circle" aria-label="Back">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <h2 class="screen-title">Academy</h2>
          </div>
        </div>

        <div class="screen-content-padding" style="gap: 16px;">
          <!-- Filter Tabs -->
          <div class="filter-pills-row">
            <button class="filter-pill active">All</button>
            <button class="filter-pill">Beginner</button>
            <button class="filter-pill">Mining</button>
            <button class="filter-pill">Blockchain</button>
          </div>

          <!-- Featured Course Card -->
          <div class="academy-hero-card">
            <div class="academy-hero-left">
              <h3>Learn Crypto Mining</h3>
              <p>A complete guide for beginners from hashrate basics to Lightning payouts.</p>
              <button class="btn-white" style="font-size: 11px; padding: 7px 16px;">Start Learning</button>
            </div>
            <div class="academy-cap-thumb">
              <img src="./assets/images/academy_cap.jpg" alt="Academy"/>
            </div>
          </div>

          <!-- Popular Lessons Section -->
          <div class="section-header-row">
            <span class="section-title">Popular Lessons</span>
            <span class="section-link">View All</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 10px;">
            ${mockData.academyLessons.map(l => `
              <div class="lesson-list-item">
                <div class="lesson-left">
                  <div class="lesson-thumb">
                    <img src="${l.image}" alt="${l.title}"/>
                  </div>
                  <div>
                    <h4 style="font-size: 13.5px; font-weight: 700; color: var(--text-primary); margin-bottom: 2px;">${l.title}</h4>
                    <p style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">${l.desc}</p>
                    <span style="font-size: 10.5px; font-weight: 600; color: var(--color-primary-purple);">${l.duration} • ${l.level}</span>
                  </div>
                </div>
                <div class="play-circle-btn">
                  <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  /* 10. SETTINGS SCREEN */
  getSettingsScreenHTML() {
    return `
      <div class="screen-scroll-view animate-fade-up">
        <!-- Header -->
        <div class="screen-header" style="padding-top: 36px;">
          <div class="screen-header-left">
            <button class="back-btn-circle" aria-label="Back">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <h2 class="screen-title">Settings</h2>
          </div>
        </div>

        <div class="screen-content-padding" style="gap: 14px;">
          <!-- Grouped Settings List -->
          <div class="grouped-list-section">
            <div class="grouped-list-item">
              <div class="grouped-item-left">
                <div class="grouped-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                </div>
                <span class="grouped-item-title">Account Settings</span>
              </div>
              <div class="grouped-item-right">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
              </div>
            </div>

            <div class="grouped-list-item">
              <div class="grouped-item-left">
                <div class="grouped-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                </div>
                <span class="grouped-item-title">Security & 2FA</span>
              </div>
              <div class="grouped-item-right">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
              </div>
            </div>

            <div class="grouped-list-item">
              <div class="grouped-item-left">
                <div class="grouped-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                </div>
                <span class="grouped-item-title">Notifications</span>
              </div>
              <div class="grouped-item-right">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
              </div>
            </div>

            <div class="grouped-list-item">
              <div class="grouped-item-left">
                <div class="grouped-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>
                </div>
                <span class="grouped-item-title">Appearance</span>
              </div>
              <div class="grouped-item-right">
                <span style="font-size: 13px; color: var(--text-secondary);">Light</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
              </div>
            </div>

            <div class="grouped-list-item">
              <div class="grouped-item-left">
                <div class="grouped-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                </div>
                <span class="grouped-item-title">Language</span>
              </div>
              <div class="grouped-item-right">
                <span style="font-size: 13px; color: var(--text-secondary);">English</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
              </div>
            </div>

            <div class="grouped-list-item">
              <div class="grouped-item-left">
                <div class="grouped-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                </div>
                <span class="grouped-item-title">Privacy & Data</span>
              </div>
              <div class="grouped-item-right">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
              </div>
            </div>

            <div class="grouped-list-item">
              <div class="grouped-item-left">
                <div class="grouped-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                </div>
                <span class="grouped-item-title">Terms of Service</span>
              </div>
              <div class="grouped-item-right">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
              </div>
            </div>

            <div class="grouped-list-item">
              <div class="grouped-item-left">
                <div class="grouped-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                </div>
                <span class="grouped-item-title">About BitMine</span>
              </div>
              <div class="grouped-item-right">
                <span style="font-size: 13px; color: var(--color-primary-purple); font-weight: 600;">v1.0.0</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* Generate Floating Bottom Nav HTML for specific active tab */
  getBottomNavHTML(activeTab = 'home') {
    const tabs = [
      { id: 'home', label: 'Home', icon: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
      { id: 'wallet', label: 'Wallet', icon: '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>' },
      { id: 'miners', label: 'Miners', icon: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>' },
      { id: 'market', label: 'Market', icon: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>' },
      { id: 'profile', label: 'Profile', icon: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/>' }
    ];

    return `
      <div class="bm-bottom-nav-wrapper">
        <nav class="bm-bottom-nav" aria-label="Navigation">
          ${tabs.map(t => `
            <div class="nav-item ${t.id === activeTab ? 'active' : ''}" data-screen="${t.id}">
              <div class="nav-icon-container">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${t.icon}</svg>
              </div>
              <span class="nav-item-label">${t.label}</span>
            </div>
          `).join('')}
        </nav>
      </div>
    `;
  }

  /* Renders the 10-Screen Multi Gallery Grid (Matching User Screenshot Layout) */
  renderGalleryGrid() {
    const galleryGrid = document.getElementById('screensGridContainer');
    if (!galleryGrid) return;

    const allScreens = [
      { id: 'home', label: 'Home', num: 1 },
      { id: 'wallet', label: 'Wallet', num: 2 },
      { id: 'miners', label: 'Miners', num: 3 },
      { id: 'market', label: 'Market', num: 4 },
      { id: 'profile', label: 'Profile', num: 5 },
      { id: 'miner-details', label: 'Miner Details', num: 6 },
      { id: 'rewards', label: 'Rewards', num: 7 },
      { id: 'news', label: 'News', num: 8 },
      { id: 'academy', label: 'Academy', num: 9 },
      { id: 'settings', label: 'Settings', num: 10 }
    ];

    galleryGrid.innerHTML = allScreens.map(s => `
      <div class="gallery-screen-card">
        <div class="gallery-screen-title">
          <span class="screen-num-pill">${s.num}</span>
          <span>${s.label}</span>
        </div>
        <div class="gallery-phone-frame" data-gallery-jump="${s.id}">
          <div class="phone-screen-inner" style="position: relative;">
            <div class="phone-status-bar ${s.id === 'home' || s.id === 'miner-details' ? 'light-text' : 'dark-text'}">
              <span>9:41</span>
              <div class="dynamic-island">
                <div class="island-camera"></div>
                <div class="island-sensor"></div>
              </div>
              <div class="status-bar-icons">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.66-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z"/></svg>
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 4h-3V2h-4v2H7v18h10V4z"/></svg>
              </div>
            </div>
            ${this.getScreenHTML(s.id)}
            ${['home', 'wallet', 'miners', 'market', 'profile'].includes(s.id) ? this.getBottomNavHTML(s.id) : ''}
            <div class="phone-home-indicator"></div>
          </div>
        </div>
      </div>
    `).join('');

    // Clicking any phone in the gallery zooms straight into it in single mode!
    galleryGrid.querySelectorAll('[data-gallery-jump]').forEach(el => {
      el.addEventListener('click', () => {
        const target = el.getAttribute('data-gallery-jump');
        if (target) {
          this.navigateTo(target);
          this.switchViewMode('single');
        }
      });
    });
  }
}

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  window.bitmineApp = new BitMineApp();
});
