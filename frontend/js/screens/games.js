/* ==========================================================================
   GAMES — Block Miner and Hash Match.
   Play a round; a win is claimed by watching a rewarded video (hashpower
   until midnight), a loss needs a video before the next try. The server
   starts and closes every round, caps the day's rewards and only grants
   after AdMob confirms the video (backend/src/games/service.js).

   The game screens draw themselves into #gameStage and are not re-rendered
   by data refreshes (keys: []), so a status poll can't reset a round.
   ========================================================================== */

import { post, ApiError } from '../api.js';
import { esc, header, toast } from '../ui.js';
import { icons } from '../icons.js';
import { state, refresh } from '../store.js';
import { watchAd } from './mining.js';

const GAMES = {
  block: {
    name: 'Block Miner',
    tagline: 'Stop the hash in the target zone',
    rules: ['The marker sweeps across the bar.', 'Tap when it is inside the glowing zone.', 'Hit 3 zones to mine the block. One miss is allowed.'],
    win: 'Block mined!',
    lose: 'The block got away',
  },
  match: {
    name: 'Hash Match',
    tagline: 'Match the coin pairs before time runs out',
    rules: ['Tap two cards to flip them.', 'Matching coins stay open.', 'Find all 6 pairs in 45 seconds.'],
    win: 'All pairs matched!',
    lose: "Time's up",
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reward = () => state.status?.games?.gh ?? 5.5;

// ── Home: the two game tiles ──────────────────────────────────────────────
export function gamesHTML() {
  const g = state.status?.games;
  if (!g) return '';
  const left = Math.max(0, g.cap - g.used);
  return `
    <div>
      <div class="section-header-row"><span class="section-title">Play &amp; earn</span><span class="text-xs text-muted" style="font-weight: 600;">${left ? `${left} reward${left === 1 ? '' : 's'} left today` : 'Back after midnight'}</span></div>
      <div class="game-tiles">
        ${Object.entries(GAMES).map(([id, game]) => `
          <div class="game-tile ${id}" data-go="game-${id}">
            <div class="game-tile-art">${id === 'block' ? blockArt : matchArt}</div>
            <h4>${game.name}</h4>
            <p>${game.tagline}</p>
            <span class="game-tile-reward">${icons.bolt} Win +${g.gh} GH/s</span>
          </div>`).join('')}
      </div>
    </div>`;
}
const blockArt = '<div class="art-bar"><span class="art-zone"></span><span class="art-marker"></span></div>';
const matchArt = '<div class="art-cards"><span>₿</span><span class="back"></span><span class="back"></span><span>₿</span></div>';

// ── shared round flow ─────────────────────────────────────────────────────
function shell(id) {
  return `
    <div class="screen-scroll-view game-screen animate-fade-up">
      ${header(GAMES[id].name)}
      <div class="screen-content-padding"><div class="game-stage" id="gameStage" data-game="${id}"></div></div>
    </div>`;
}

function mount(root, id) {
  const stage = root.querySelector('#gameStage');
  if (!stage) return;
  const game = GAMES[id];
  const alive = () => stage.isConnected;
  let working = false;

  /** A panel with one main button; `onMain` runs once at a time. */
  function panel({ tone = '', icon, title, text, button, onMain, extra = '' }) {
    stage.innerHTML = `
      <div class="game-panel ${tone}">
        <div class="game-panel-icon">${icon}</div>
        <h3>${esc(title)}</h3>
        <div class="game-panel-text">${text}</div>
        ${button ? `<button class="btn-primary btn-block" data-g="main">${button}</button>` : ''}
        ${extra}
      </div>`;
    const main = stage.querySelector('[data-g="main"]');
    main?.addEventListener('click', async () => {
      if (working) return;
      working = true;
      main.disabled = true;
      try {
        await onMain();
      } catch (err) {
        if (alive()) toast(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.', 'error');
      } finally {
        working = false;
        if (main.isConnected) main.disabled = false;
      }
    });
  }
  const backLink = '<button class="btn-soft btn-block" data-go="home">Back to Home</button>';

  function intro() {
    const s = state.status;
    const g = s?.games;
    if (!g) return panel({ icon: icons.clock, title: 'Games are taking a break', text: '<p>Please check back later.</p>', extra: backLink });
    if (!s.session?.active) {
      return panel({ icon: icons.bolt, title: "Start today's mining first", text: '<p>Game rewards mine until midnight, so your day needs to be started.</p>', extra: '<button class="btn-primary btn-block" data-go="mining">Start mining</button>' });
    }
    if (g.locked) return lost();
    if (g.used >= g.cap) {
      return panel({ icon: icons.gift, title: "All of today's rewards claimed", text: `<p>You won ${g.cap} times today. New rewards unlock after midnight.</p>`, extra: backLink });
    }
    panel({
      icon: id === 'block' ? icons.miner : icons.gift,
      title: game.tagline,
      text: `<ol class="game-rules">${game.rules.map((r) => `<li>${r}</li>`).join('')}</ol><p class="game-reward-line">${icons.bolt} Win <strong>+${g.gh} GH/s</strong> until midnight · ${g.used}/${g.cap} today</p>`,
      button: 'Play',
      onMain: play,
    });
  }

  async function play() {
    let round;
    try {
      round = await post('/v1/games/rounds', { game: id });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'retry_required') return lost();
      await refresh('status').catch(() => undefined);
      if (alive()) intro();
      throw err;
    }
    if (!alive()) return;
    const won = await (id === 'block' ? playBlock(stage, alive) : playMatch(stage, alive));
    if (!alive()) return; // left mid-round: the round is simply abandoned
    const result = await post(`/v1/games/rounds/${round.roundId}/finish`, { won }).catch(() => ({ status: won ? 'won' : 'lost' }));
    refresh('status').catch(() => undefined); // the Home tiles follow the result
    if (!alive()) return;
    if (result.status === 'won') wonPanel(round.roundId);
    else lost();
  }

  function wonPanel(roundId) {
    panel({
      tone: 'win',
      icon: icons.gift,
      title: game.win,
      text: `<p>Watch a short video to claim <strong>+${reward()} GH/s</strong> until midnight.</p>`,
      button: `${icons.bolt} Watch video &amp; claim`,
      onMain: async () => {
        const { status } = await watchAd({ kind: 'game', roundId });
        await refresh('status').catch(() => undefined);
        if (!alive()) return;
        if (status === 'verified') return claimed();
        if (status === 'skipped') return toast('Watch the whole video to claim your reward.', 'error');
        if (status === 'unsupported') return toast('Rewards are claimed in the BitMine phone app.', 'error');
        toast(status === 'pending' ? "Still confirming your video. It'll appear in a moment." : "That video couldn't be confirmed. Please try again.", status === 'pending' ? undefined : 'error');
        if (status === 'pending') claimed();
      },
    });
  }

  function claimed() {
    const g = state.status?.games;
    const more = g && g.used < g.cap;
    panel({
      tone: 'win',
      icon: icons.bolt,
      title: `+${reward()} GH/s added`,
      text: `<p>It mines for you until midnight.${g ? ` ${g.used}/${g.cap} rewards claimed today.` : ''}</p>`,
      button: more ? 'Play again' : '',
      onMain: play,
      extra: backLink,
    });
  }

  function lost() {
    panel({
      tone: 'lose',
      icon: icons.clock,
      title: game.lose,
      text: '<p>Watch a short video to try again.</p>',
      button: `${icons.bolt} Watch video &amp; retry`,
      onMain: async () => {
        const { status } = await watchAd({ kind: 'retry' }).catch((err) => {
          // Already unlocked (e.g. from the other game): just play.
          if (err instanceof ApiError && err.code === 'retry_not_needed') return { status: 'verified' };
          throw err;
        });
        await refresh('status').catch(() => undefined);
        if (!alive()) return;
        if (status === 'verified') return play();
        if (status === 'skipped') return toast('Watch the whole video to try again.', 'error');
        if (status === 'unsupported') return toast('Retries are unlocked in the BitMine phone app.', 'error');
        toast('Still confirming your video. Tap again in a moment.');
      },
      extra: backLink,
    });
  }

  // Status may still be loading on a cold start.
  if (state.status) intro();
  else refresh('status').catch(() => undefined).then(() => alive() && intro());
}

// ── Block Miner ───────────────────────────────────────────────────────────
// Three zones, each narrower and faster. Resolves true when all are hit.
const LEVELS = [
  { width: 0.3, sweepsPerSec: 0.55 },
  { width: 0.22, sweepsPerSec: 0.75 },
  { width: 0.15, sweepsPerSec: 0.95 },
];
const MISSES_ALLOWED = 1;

function playBlock(stage, alive) {
  return new Promise((resolve) => {
    stage.innerHTML = `
      <div class="block-game">
        <div class="game-hud"><span id="bgLevel"></span><span id="bgLives"></span></div>
        <div class="block-cube" id="bgCube">${[0, 1, 2].map(() => '<span></span>').join('')}</div>
        <div class="block-bar" id="bgBar"><div class="block-zone" id="bgZone"></div><div class="block-marker" id="bgMarker"></div></div>
        <button class="btn-primary btn-block block-tap" id="bgTap">${icons.bolt} TAP</button>
        <p class="bm-hint text-center">Tap when the marker is inside the zone.</p>
      </div>`;
    const $ = (id) => stage.querySelector(`#${id}`);
    const marker = $('bgMarker');
    const zone = $('bgZone');
    const bar = $('bgBar');
    let level = 0;
    let misses = 0;
    let zoneStart = 0;
    let levelStart = 0;
    let pos = 0;
    let open = false; // taps count only while a level is running

    function setLevel() {
      const L = LEVELS[level];
      zoneStart = 0.08 + Math.random() * (0.84 - L.width);
      zone.style.left = `${zoneStart * 100}%`;
      zone.style.width = `${L.width * 100}%`;
      $('bgLevel').textContent = `Zone ${level + 1} of ${LEVELS.length}`;
      $('bgLives').textContent = misses >= MISSES_ALLOWED ? 'No misses left' : `${MISSES_ALLOWED - misses} miss allowed`;
      levelStart = performance.now();
      open = false;
      setTimeout(() => (open = true), 400);
    }

    /** Where the marker is at `now` (0..1, back and forth): the same maths draws it and judges a tap. */
    const markerAt = (now) => 1 - Math.abs(((((now - levelStart) / 1000) * LEVELS[level].sweepsPerSec) % 2) - 1);

    function frame(now) {
      if (!alive()) return resolve(false);
      pos = markerAt(now);
      marker.style.transform = `translateX(${pos * (bar.clientWidth - marker.offsetWidth)}px)`;
      raf = requestAnimationFrame(frame);
    }
    let raf = requestAnimationFrame(frame);

    async function tap() {
      if (!open) return;
      open = false;
      const L = LEVELS[level];
      // Judge the moment of the tap itself, not the last frame drawn.
      pos = markerAt(performance.now());
      marker.style.transform = `translateX(${pos * (bar.clientWidth - marker.offsetWidth)}px)`;
      const hit = pos >= zoneStart && pos <= zoneStart + L.width;
      bar.classList.add(hit ? 'hit' : 'miss');
      if (hit) $('bgCube').children[level].classList.add('on');
      else misses++;
      cancelAnimationFrame(raf);
      await sleep(700);
      if (!alive()) return resolve(false);
      bar.classList.remove('hit', 'miss');
      if (hit && level === LEVELS.length - 1) return resolve(true);
      if (!hit && misses > MISSES_ALLOWED) return resolve(false);
      if (hit) level++;
      setLevel();
      raf = requestAnimationFrame(frame);
    }
    $('bgTap').addEventListener('pointerdown', tap);
    bar.addEventListener('pointerdown', tap);
    setLevel();
  });
}

// ── Hash Match ────────────────────────────────────────────────────────────
const COINS = [
  { s: '₿', c: '#F7931A' },
  { s: 'Ξ', c: '#627EEA' },
  { s: 'S', c: '#14F195' },
  { s: 'B', c: '#F3BA2F' },
  { s: 'X', c: '#23292F' },
  { s: 'A', c: '#0033AD' },
];
const MATCH_SECONDS = 45;

function playMatch(stage, alive) {
  return new Promise((resolve) => {
    const deck = [...COINS, ...COINS].map((coin, i) => ({ coin, i })).sort(() => Math.random() - 0.5);
    stage.innerHTML = `
      <div class="match-game">
        <div class="game-hud"><span id="mgPairs">0 of ${COINS.length} pairs</span><span id="mgTime">${MATCH_SECONDS}s</span></div>
        <div class="match-timer"><div id="mgBar"></div></div>
        <div class="match-grid">
          ${deck.map((d, n) => `<button class="match-card" data-n="${n}" aria-label="Card"><span class="match-face" style="background: ${d.coin.c};">${d.coin.s}</span></button>`).join('')}
        </div>
      </div>`;
    const cards = [...stage.querySelectorAll('.match-card')];
    const started = performance.now();
    let open = [];
    let pairs = 0;
    let locked = false;
    let done = false;

    const finish = (won) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      resolve(won);
    };
    const timer = setInterval(() => {
      if (!alive()) return finish(false);
      const left = MATCH_SECONDS - (performance.now() - started) / 1000;
      stage.querySelector('#mgTime').textContent = `${Math.max(0, Math.ceil(left))}s`;
      stage.querySelector('#mgBar').style.width = `${Math.max(0, (left / MATCH_SECONDS) * 100)}%`;
      if (left <= 0) finish(false);
    }, 100);

    cards.forEach((card) =>
      card.addEventListener('click', async () => {
        const n = Number(card.dataset.n);
        if (done || locked || card.classList.contains('open')) return;
        card.classList.add('open');
        open.push(n);
        if (open.length < 2) return;
        const [a, b] = open;
        open = [];
        if (deck[a].coin === deck[b].coin) {
          cards[a].classList.add('matched');
          cards[b].classList.add('matched');
          pairs++;
          stage.querySelector('#mgPairs').textContent = `${pairs} of ${COINS.length} pairs`;
          if (pairs === COINS.length) {
            await sleep(450);
            finish(true);
          }
          return;
        }
        locked = true;
        await sleep(650);
        cards[a].classList.remove('open');
        cards[b].classList.remove('open');
        locked = false;
      }),
    );
  });
}

export const screens = {
  'game-block': { tab: 'home', nav: false, keys: [], render: () => shell('block'), after: (root) => mount(root, 'block') },
  'game-match': { tab: 'home', nav: false, keys: [], render: () => shell('match'), after: (root) => mount(root, 'match') },
};
