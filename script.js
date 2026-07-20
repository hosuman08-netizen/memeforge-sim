/* ============================================================================
   MemeForge — a bonding-curve launchpad simulator.

   FICTIONAL SIMULATION ONLY. No real money, tokens, wallets or blockchain.
   Everything below runs in the browser against generated state.

   The mechanics are modelled on how public launchpads actually work, because
   an inaccurate simulation is a worse toy:

   · Constant-product curve on VIRTUAL reserves (x*y=k), not linear/exponential.
     Seed state 30 SOL x 1,073,000,191 tokens => k ~= 3.219e10,
     opening price ~= 0.000000028 SOL/token. Issuance is strictly concave:
     every additional SOL buys fewer tokens than the last.
   · 1B supply: ~800M sold on the curve, 200M reserved for the DEX pool.
   · Graduation triggers at 85 SOL of REAL bonded reserve (virtual 30 -> 115).
     At migration the 30 SOL virtual advance is reclaimed, the pool is seeded,
     and the LP tokens are BURNED — liquidity can never be pulled after that.
   · Under 2% of coins ever graduate. Most die on the curve. That rate is the
     realism anchor; a sim where you usually make it is a toy.
   · King of the Hill is scored on multi-input VELOCITY — holder growth,
     comment/reaction velocity and trade volume together — not raw volume.
   · Creator fees taper regressively: ~0.95% per trade under $300k mcap down to
     ~0.05% past $20M. You earn most while you are small.
   ========================================================================== */
'use strict';

/* ══════════════════════════ 1. CURVE + VENUE MATH ══════════════════════════ */

const SIM = {
  SOL_USD: 170,          // fictional display rate
  TICK_MS: 550,
  MAX_COINS: 44
};

const CURVE = {
  V_SOL: 30,                    // virtual SOL reserve seed
  V_TOK: 1073000191,            // virtual token reserve seed
  TOTAL: 1000000000,            // 1B fixed supply
  CURVE_SUPPLY: 800000000,      // sold on the curve
  POOL_SUPPLY: 200000000        // paired into the pool at migration
};
CURVE.K = CURVE.V_SOL * CURVE.V_TOK;   // 32,190,005,730

const VENUES = {
  pumpforge: {
    id: 'pumpforge', name: 'PumpForge', blurb: 'The default. Free to create, graduates early.',
    launchFee: 0, gradSol: 85, burnAtGrad: 0, pool: 'ForgeSwap'
  },
  moonforge: {
    id: 'moonforge', name: 'MoonForge', blurb: 'Costs 0.02 to launch and graduates far later — but burns supply on the way out.',
    launchFee: 0.02, gradSol: 500, burnAtGrad: 175000000, pool: 'RayPool'
  }
};

/* Price of the next token = SOL reserve / token reserve. */
function price(c)     { return c.vSol / c.vTok; }
function mcapSol(c)   { return price(c) * CURVE.TOTAL; }
function mcapUsd(c)   { return mcapSol(c) * SIM.SOL_USD; }
function realSol(c)   { return Math.max(0, c.vSol - CURVE.V_SOL); }
function soldTokens(c){ return Math.max(0, CURVE.V_TOK - c.vTok); }
function progress(c)  { return Math.min(1, realSol(c) / VENUES[c.venue].gradSol); }
/* Liquidity a seller can actually pull out right now. */
function liquidity(c) { return realSol(c); }

/* x*y=k: SOL in -> tokens out. Strictly increasing, strictly concave. */
function quoteBuy(c, solIn) {
  if (solIn <= 0) return 0;
  const newSol = c.vSol + solIn;
  return c.vTok - (CURVE.K / newSol);
}
/* x*y=k: tokens in -> SOL out. */
function quoteSell(c, tokIn) {
  if (tokIn <= 0) return 0;
  const newTok = c.vTok + tokIn;
  return Math.max(0, c.vSol - (CURVE.K / newTok));
}

/* Creator fee taper (regressive): 0.95% under $300k mcap -> 0.05% past $20M. */
function creatorFeePct(c) {
  const m = mcapUsd(c);
  if (m <= 3e5) return 0.95;
  if (m >= 2e7) return 0.05;
  const t = (Math.log10(m) - Math.log10(3e5)) / (Math.log10(2e7) - Math.log10(3e5));
  return 0.95 + t * (0.05 - 0.95);
}

/* ══════════════════════════ 2. STATE ══════════════════════════ */

const HISTORY_KEY  = 'memeforge.history';
const WALLET_KEY   = 'memeforge.wallet';
const START_SOL    = 10;

const world = {
  coins: [], byId: {},
  kingId: null, crownedAt: 0,
  feed: [],                 // cross-coin live activity stream (board ticker)
  tick: 0, timer: null, seq: 1
};

let wallet = { sol: START_SOL, pos: {}, realized: 0, fees: 0 };
let pending = [];      // in-flight transactions (priority-fee latency)

const ui = {
  view: 'board',
  openId: null,
  boardTab: 'new',
  tokenTab: 'trades',
  draft: { avatar: '🐕', venue: 'pumpforge' },
  exec: { amount: 0.5, slippage: 15, priority: 0.001 }
};

/* Decorative hype-eye state, preserved from the original build. */
const _eye = { pulse: 0.5 };
const _mood = { energy: 0.5 };

/* ══════════════════════════ 3. UTIL ══════════════════════════ */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(arr, r) { return arr[Math.floor((r == null ? Math.random() : r) * arr.length) % arr.length]; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function fmtSol(n) {
  if (!isFinite(n)) return '0';
  if (n === 0) return '0';
  const a = Math.abs(n);
  if (a < 0.0001) return n.toExponential(2);
  if (a < 1) return n.toFixed(4);
  if (a < 1000) return n.toFixed(2);
  return Math.round(n).toLocaleString();
}
function fmtUsd(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}
function fmtTok(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}
function fmtPrice(n) { return n < 0.001 ? n.toExponential(2) : n.toFixed(6); }
function ago(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return Math.floor(s / 3600) + 'h';
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}
function shortWallet(id) { return String(id).slice(0, 4) + '…' + String(id).slice(-4); }
function makeWalletId(r) {
  const cs = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < 10; i++) s += cs[Math.floor((r ? r() : Math.random()) * cs.length)];
  return s;
}

function toast(msg, kind) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { el.hidden = true; }, 2800);
}

/* ══════════════════════════ 4. COIN FACTORY ══════════════════════════ */

const AVATARS = ['🐕','🐸','🐱','🦊','👽','🤖','🐋','🦍','🌙','🔥','💎','🍌','☠️','🧠','👑','🐍','🦄','⚡'];
const NAME_A = ['Doge','Pepe','Wojak','Chad','Moon','Turbo','Ghost','Based','Cyber','Holy','Quantum','Feral','Silent','Golden','Cosmic','Diamond','Rogue','Neon'];
const NAME_B = ['Reborn','Inu','Coin','Protocol','Cartel','Syndicate','Machine','Empire','Priest','Baby','Killer','Maxi','Society','Kernel','Vault','Beast'];

function newCoinId() { return 'c' + (world.seq++); }

function mkCoin(opts) {
  const seed = (Math.random() * 1e9) | 0;
  const rnd = mulberry32(seed);
  const venue = VENUES[opts.venue] ? opts.venue : 'pumpforge';

  const c = {
    id: newCoinId(),
    name: opts.name, ticker: opts.ticker || '', avatar: opts.avatar || pick(AVATARS),
    hue: opts.hue != null ? opts.hue : Math.floor(rnd() * 360),
    desc: opts.desc || '', twitter: opts.twitter || '', telegram: opts.telegram || '', website: opts.website || '',
    venue: venue,

    vSol: CURVE.V_SOL, vTok: CURVE.V_TOK,

    createdAt: Date.now(),
    revealed: false,          // off-chain until the first buy
    isPlayer: !!opts.isPlayer,

    dev: { wallet: makeWalletId(rnd), tokens: 0, spent: 0, sold: false, soldAt: 0 },

    trades: [], comments: [],
    holderCount: 0, holderSeed: seed,
    bundled: false,

    volSol: 0, buys: 0, sells: 0,
    creatorFees: 0,

    hVel: 0, cVel: 0, vVel: 0, momentum: 0,
    kothAt: 0, everKoth: false,

    graduated: false, graduatedAt: 0, burned: 0, dead: false,
    poolSol: 0, poolTokens: 0, gradPrice: 0, gradMcap: 0,
    hist: [], peak: 0, stream: 0,

    fate: null, peakTarget: 0, life: 0, age: 0, rnd: rnd
  };
  c.peak = price(c);
  c.hist.push(price(c));
  return c;
}

/* Assign a simulated coin its fate. This is the realism anchor:
   under 2% graduate, a visible minority stall near KOTH, most die. */
function assignFate(c) {
  const r = c.rnd();
  const g = VENUES[c.venue].gradSol;
  if (r < 0.018)     { c.fate = 'graduate'; c.peakTarget = g * (1.02 + c.rnd() * 0.25); }
  else if (r < 0.10) { c.fate = 'koth';     c.peakTarget = g * (0.50 + c.rnd() * 0.35); }
  else if (r < 0.34) { c.fate = 'traction'; c.peakTarget = g * (0.10 + c.rnd() * 0.28); }
  else               { c.fate = 'die';      c.peakTarget = g * (0.004 + c.rnd() * 0.05); }
  c.life = 90 + Math.floor(c.rnd() * 260);
  // bundling: a dev quietly holding supply through sock-puppet wallets
  c.bundled = c.rnd() < (c.fate === 'die' ? 0.34 : 0.10);
  return c;
}

function spawnSimCoin() {
  const c = mkCoin({
    name: pick(NAME_A) + ' ' + pick(NAME_B),
    venue: Math.random() < 0.16 ? 'moonforge' : 'pumpforge'
  });
  c.ticker = c.name.split(' ').map(function (w) { return w.slice(0, 3); }).join('').toUpperCase().slice(0, 7);
  assignFate(c);
  // simulated coins reveal with a dev buy, exactly like real ones
  const devBuy = 0.2 + c.rnd() * (c.bundled ? 4 : 1.5);
  applyBuy(c, devBuy, c.dev.wallet, 'dev');
  c.dev.tokens = soldTokens(c);
  c.dev.spent = devBuy;
  c.holderCount = 1;              // the dev is a holder the moment they buy
  c.revealed = true;
  pushFeed(c, 'new', devBuy, 0);
  addCoin(c);
  return c;
}

function addCoin(c) {
  world.coins.push(c);
  world.byId[c.id] = c;
  // retire the oldest dead simulated coin so the board stays light
  if (world.coins.length > SIM.MAX_COINS) {
    let cut = -1;
    for (let i = 0; i < world.coins.length; i++) {
      const x = world.coins[i];
      if (!x.isPlayer && !x.graduated && x.dead) { cut = i; break; }
    }
    // never evict a graduate — the Graduated board is the record of what made it
    if (cut < 0) for (let i = 0; i < world.coins.length; i++) {
      if (!world.coins[i].isPlayer && !world.coins[i].graduated) { cut = i; break; }
    }
    if (cut >= 0) { delete world.byId[world.coins[cut].id]; world.coins.splice(cut, 1); }
  }
}

/* ══════════════════════════ 5. TRADE EXECUTION ══════════════════════════ */

function logTrade(c, kind, w, sol, tokens, tag) {
  c.trades.unshift({ kind: kind, w: w, sol: sol, tokens: tokens, ts: Date.now(), tag: tag || '' });
  if (c.trades.length > 60) c.trades.pop();
}

/* Cross-coin live feed. The board's realism gap on a real launchpad is not a
   single coin — it is the wall of OTHER coins ticking up and down at once.
   Notable events (sized buys/sells, dev exits, KOTH, graduation, reveals) are
   streamed here so the board reads as a live market, not a static list. */
function pushFeed(c, kind, sol, tokens) {
  world.feed.unshift({
    id: c.id, ticker: c.ticker, avatar: c.avatar, hue: c.hue,
    kind: kind, sol: sol || 0, tokens: tokens || 0,
    mcap: mcapUsd(c), ts: Date.now(), seq: world.seq++
  });
  if (world.feed.length > 26) world.feed.pop();
}

/* A buy that actually moves the curve. The creator fee is skimmed first. */
function applyBuy(c, solIn, walletId, tag) {
  if (c.graduated || !(solIn > 0)) return 0;
  const fee = solIn * creatorFeePct(c) / 100;
  const intoCurve = solIn - fee;
  const tokens = quoteBuy(c, intoCurve);

  c.vSol += intoCurve;
  c.vTok = CURVE.K / c.vSol;
  c.creatorFees += fee;
  c.volSol += solIn;
  c.buys++;
  c.hVel += 1; c.vVel += solIn;
  if (Math.random() < 0.72) c.holderCount++;

  const p = price(c);
  if (p > c.peak) c.peak = p;
  logTrade(c, 'buy', walletId, solIn, tokens, tag);
  if (tag === 'whale' || tag === 'dev' || walletId === 'you' || solIn >= 0.35) {
    pushFeed(c, tag === 'whale' ? 'whale' : 'buy', solIn, tokens);
  }
  checkGraduation(c);
  return tokens;
}

function applySell(c, tokIn, walletId, tag) {
  if (c.graduated || !(tokIn > 0)) return 0;
  const sol = quoteSell(c, tokIn);
  c.vTok += tokIn;
  c.vSol = CURVE.K / c.vTok;
  c.volSol += sol;
  c.sells++;
  c.vVel += sol;
  // never fall below 1 while supply is out — somebody is holding it
  if (c.holderCount > 1 && Math.random() < 0.55) c.holderCount--;
  logTrade(c, 'sell', walletId, sol, tokIn, tag);
  if (tag === 'DEV SOLD' || walletId === 'you' || sol >= 0.35) {
    pushFeed(c, tag === 'DEV SOLD' ? 'devsell' : 'sell', sol, tokIn);
  }
  return sol;
}

/* The discrete, dramatic migration event. */
function checkGraduation(c) {
  if (c.graduated) return;
  const v = VENUES[c.venue];
  if (realSol(c) < v.gradSol) return;

  c.graduated = true;
  c.graduatedAt = Date.now();
  c.burned = v.burnAtGrad;
  c.gradMcap = mcapUsd(c);
  c.gradPrice = price(c);
  // the protocol reclaims the 30 SOL virtual advance; the rest seeds the pool
  c.poolSol = realSol(c);
  c.poolTokens = CURVE.POOL_SUPPLY - v.burnAtGrad;

  logTrade(c, 'grad', 'protocol', c.poolSol, c.poolTokens, 'LP burned');
  pushFeed(c, 'grad', c.poolSol, c.poolTokens);
  if (c.isPlayer) {
    remember('graduate', '$' + c.ticker + ' GRADUATED — ' + fmtSol(c.poolSol) + ' SOL into ' + v.pool + ', LP burned');
    pulseSurprise(1);
  }
  // The migration is the rarest moment on the curve — under 2% ever get here.
  // Celebrate it. Seeding replays history silently; only live graduations fire.
  if (!world.seeding) celebrateGraduation(c);
}

/* ══════════ Player order flow: presets, slippage, priority fee ══════════ */

/* Priority fee buys inclusion speed. A cheap fee lands late, and by then the
   price has moved — which is how you miss an entry on a real launchpad. */
function latencyTicks(pf) {
  if (pf >= 0.01)   return 0;
  if (pf >= 0.005)  return 1;
  if (pf >= 0.001)  return 2;
  if (pf >= 0.0005) return 3;
  return 4;
}

function submitBuy() {
  const c = world.byId[ui.openId];
  if (!c) return;
  if (c.graduated) { toast('Graduated — it trades on ' + VENUES[c.venue].pool + ' now.'); return; }
  const amt = Number(ui.exec.amount);
  if (!(amt > 0)) { toast('Set an amount first.'); return; }
  const pf = Number(ui.exec.priority) || 0;
  if (wallet.sol < amt + pf) { toast('Not enough SOL. Sell something first.', 'bad'); return; }

  // quote at click time — this is what slippage tolerance is measured against
  const tokens = quoteBuy(c, amt * (1 - creatorFeePct(c) / 100));
  if (!(tokens > 0)) { toast('Quote failed.', 'bad'); return; }

  wallet.sol -= (amt + pf);       // the priority fee is spent whether or not it lands
  pending.push({
    kind: 'buy', coinId: c.id, amt: amt, pf: pf, quotedPrice: amt / tokens,
    slip: Number(ui.exec.slippage), at: world.tick + latencyTicks(pf)
  });
  renderToken();
}

function submitSell(fraction) {
  const c = world.byId[ui.openId];
  if (!c) return;
  const pos = wallet.pos[c.id];
  if (!pos || pos.tokens <= 0) { toast('No position in $' + c.ticker + '.'); return; }
  if (c.graduated) { toast('Graduated — it trades on ' + VENUES[c.venue].pool + ' now.'); return; }
  const tokens = pos.tokens * clamp(fraction, 0.01, 1);
  const pf = Number(ui.exec.priority) || 0;
  if (wallet.sol < pf) { toast('Not enough SOL for the priority fee.', 'bad'); return; }

  const quotedOut = quoteSell(c, tokens);
  if (!(quotedOut > 0)) { toast('No liquidity to sell into.', 'bad'); return; }
  wallet.sol -= pf;
  pending.push({
    kind: 'sell', coinId: c.id, tokens: tokens, pf: pf,
    quotedPrice: quotedOut / tokens, slip: Number(ui.exec.slippage),
    at: world.tick + latencyTicks(pf)
  });
  renderToken();
}

/* Settle everything scheduled to land on this tick. */
function settlePending() {
  const still = [];
  for (let i = 0; i < pending.length; i++) {
    const tx = pending[i];
    if (tx.at > world.tick) { still.push(tx); continue; }
    const c = world.byId[tx.coinId];
    if (!c) continue;

    if (tx.kind === 'buy') {
      const tokens = quoteBuy(c, tx.amt * (1 - creatorFeePct(c) / 100));
      if (!(tokens > 0)) { wallet.sol += tx.amt; continue; }
      const execPrice = tx.amt / tokens;
      const slipPct = (execPrice / tx.quotedPrice - 1) * 100;
      if (slipPct > tx.slip) {
        // the classic: your fee was too low, the price ran, the tx reverts
        wallet.sol += tx.amt;                 // trade amount returns, priority fee is gone
        remember('fail', 'Buy of $' + c.ticker + ' failed — ' + slipPct.toFixed(1) + '% slippage exceeded ' + tx.slip + '% tolerance');
        toast('TX failed: ' + slipPct.toFixed(1) + '% slippage > ' + tx.slip + '% tolerance. Priority fee burned.', 'bad');
        continue;
      }
      applyBuy(c, tx.amt, 'you', 'you');
      const pos = wallet.pos[c.id] || (wallet.pos[c.id] = { tokens: 0, cost: 0 });
      pos.tokens += tokens; pos.cost += tx.amt;
      if (c.isPlayer) c.dev.tokens += tokens;
      pulseSurprise(0.5);
      toast('Filled ' + fmtTok(tokens) + ' $' + c.ticker + ' @ ' + fmtPrice(execPrice) +
        (slipPct > 0.5 ? ' (' + slipPct.toFixed(1) + '% slip)' : ''), 'good');

    } else {
      const pos = wallet.pos[c.id];
      if (!pos || pos.tokens <= 0) continue;
      const tokens = Math.min(tx.tokens, pos.tokens);
      const out = quoteSell(c, tokens);
      const execPrice = out / tokens;
      const slipPct = (1 - execPrice / tx.quotedPrice) * 100;
      if (slipPct > tx.slip) {
        remember('fail', 'Sell of $' + c.ticker + ' failed — ' + slipPct.toFixed(1) + '% slippage exceeded ' + tx.slip + '%');
        toast('TX failed: price moved ' + slipPct.toFixed(1) + '% against you. Priority fee burned.', 'bad');
        continue;
      }
      applySell(c, tokens, 'you', 'you');
      const costOut = pos.cost * (tokens / pos.tokens);
      const pnl = out - costOut;
      pos.tokens -= tokens; pos.cost -= costOut;
      wallet.sol += out;
      wallet.realized += pnl;
      if (pos.tokens <= 1e-6) delete wallet.pos[c.id];
      if (c.isPlayer) {
        c.dev.sold = true; c.dev.soldAt = Date.now();
        c.dev.tokens = Math.max(0, c.dev.tokens - tokens);
        logTrade(c, 'devsell', 'you', out, tokens, 'DEV SOLD');
      }
      remember('sell', 'Sold ' + fmtTok(tokens) + ' $' + c.ticker + ' for ' + fmtSol(out) + ' SOL · P&L ' + (pnl >= 0 ? '+' : '') + fmtSol(pnl));
      toast((pnl >= 0 ? '🟢 +' : '🔴 ') + fmtSol(pnl) + ' SOL realized', pnl >= 0 ? 'good' : 'bad');
    }
  }
  pending = still;
  saveWallet();
}

/* ══════════════════════════ 6. HOLDER MODEL ══════════════════════════ */

/* The holder distribution is generated from the coin's seed so it stays stable
   across renders, then reconciled against the real dev holding and your real
   position. Bundled coins push the top wallets into a cluster wired to the dev. */
function holderTable(c) {
  const r = mulberry32(c.holderSeed);
  const sold = soldTokens(c);
  if (sold <= 0) return { rows: [], top10: 0, devPct: 0, bundledPct: 0, sold: 0 };

  const devTok = Math.min(c.dev.sold ? 0 : c.dev.tokens, sold);
  const yourTok = (wallet.pos[c.id] && wallet.pos[c.id].tokens) || 0;
  const rest = Math.max(0, sold - devTok - yourTok);

  const n = clamp(Math.max(6, c.holderCount), 6, 40);
  const w = [];
  for (let i = 0; i < n; i++) {
    // power-law-ish: a few large wallets, then a long tail
    w.push((Math.pow(1 - i / (n + 2), 3.2) + 0.02) * (0.6 + r() * 0.8));
  }
  let sum = 0; for (let i = 0; i < n; i++) sum += w[i];
  if (!(sum > 0)) sum = 1;

  const rows = [];
  if (devTok > 0) rows.push({ w: c.dev.wallet, tokens: devTok, dev: true, bundle: false });
  if (yourTok > 0) rows.push({ w: 'you', tokens: yourTok, dev: false, bundle: false, you: true });
  for (let i = 0; i < n; i++) {
    rows.push({ w: makeWalletId(r), tokens: rest * (w[i] / sum), dev: false, bundle: c.bundled && i < 7 });
  }
  rows.sort(function (a, b) { return b.tokens - a.tokens; });

  // concentration is measured across the full distribution, dust included
  let t10 = 0; for (let i = 0; i < Math.min(10, rows.length); i++) t10 += rows[i].tokens;
  let bn = 0; for (let i = 0; i < rows.length; i++) if (rows[i].bundle) bn += rows[i].tokens;

  // ...but a wallet holding effectively nothing is not a holder worth drawing.
  // Without this a dev-only coin renders six empty bubbles that imply distribution.
  const shown = rows.filter(function (r) {
    return r.dev || r.you || (r.tokens / sold) >= 0.0005;
  });

  return {
    rows: shown.length ? shown : rows.slice(0, 1), sold: sold,
    top10: t10 / sold * 100,
    bundledPct: bn / sold * 100,
    devPct: devTok / sold * 100
  };
}

/* ══════════════════════════ 7. WORLD SIMULATION ══════════════════════════ */

const COMMENTS = [
  'lfg', 'dev doxxed?', 'chart looks primed', 'top 10 is way too concentrated',
  'bundled, look at the map', 'this is the one', 'ape or regret',
  'holders climbing fast', 'dev sold, im out', 'sending', 'liquidity is thin',
  'first', 'send it to koth', 'graduation or nothing', 'careful here',
  'up only', 'bought the dip', 'volume with no holders is fake'
];

function simCoinTick(c) {
  c.age++;

  // trajectory: rise fast, peak around 30% of life, then bleed out
  const t = c.age / c.life;
  const s = (t / 0.3) * Math.exp(1 - (t / 0.3));
  const desired = c.peakTarget * clamp(s, 0, 1.4) * (0.75 + c.rnd() * 0.5);
  const actual = realSol(c);
  const gap = desired - actual;

  if (gap > 0.02) {
    // buy size scales with the remaining gap, so a coin converges on its
    // trajectory instead of crawling — a hard cap here would mean nothing
    // could ever traverse 85 SOL and graduation would be unreachable
    const whale = c.rnd() < 0.08;
    const step = gap * (whale ? 0.18 + c.rnd() * 0.22 : 0.04 + c.rnd() * 0.09);
    const amt = Math.min(gap, Math.max(0.01, step));
    applyBuy(c, amt, makeWalletId(c.rnd), whale ? 'whale' : '');
  } else if (gap < -0.02 && soldTokens(c) > 0) {
    const frac = clamp(Math.abs(gap) / Math.max(actual, 0.1), 0.01, 0.22) * (0.4 + c.rnd() * 0.8);
    applySell(c, soldTokens(c) * clamp(frac, 0.002, 0.2), makeWalletId(c.rnd), c.rnd() < 0.1 ? 'whale' : '');
  }

  // bundled devs quietly exit near the top
  if (c.bundled && !c.dev.sold && t > 0.32 && c.rnd() < 0.05 && c.dev.tokens > 0) {
    applySell(c, c.dev.tokens, c.dev.wallet, 'DEV SOLD');
    c.dev.sold = true; c.dev.soldAt = Date.now(); c.dev.tokens = 0;
  }

  // comment/reaction velocity tracks heat, and feeds back into board placement
  if (c.rnd() < clamp(0.05 + progress(c) * 0.5, 0, 0.55)) {
    c.comments.unshift({ w: makeWalletId(c.rnd), text: pick(COMMENTS, c.rnd()), ts: Date.now(), likes: Math.floor(c.rnd() * 24) });
    if (c.comments.length > 40) c.comments.pop();
    c.cVel += 1;
  }

  if (c.age > c.life && !c.graduated) c.dead = true;
}

/* The player's coin is not on rails. Its flow is driven by what the player
   actually does: buying, commenting, streaming, sharing. */
function playerCoinTick(c) {
  c.age++;
  const heat = clamp(c.cVel * 0.10 + c.hVel * 0.05 + (c.stream ? 0.55 : 0), 0, 1.6);
  const base = 0.02 + heat * 0.55;

  if (Math.random() < 0.30 + heat * 0.45) {
    const whale = Math.random() < 0.06 + heat * 0.06;
    applyBuy(c, whale ? 0.6 + Math.random() * 2.2 : 0.02 + Math.random() * base, makeWalletId(), whale ? 'whale' : '');
  }
  // organic sell pressure — always present, heavier once the dev has sold
  if (soldTokens(c) > 0 && Math.random() < (c.dev.sold ? 0.42 : 0.26)) {
    applySell(c, soldTokens(c) * (0.004 + Math.random() * 0.035), makeWalletId(), '');
  }
  if (Math.random() < 0.06 + heat * 0.16) {
    c.comments.unshift({ w: makeWalletId(), text: pick(COMMENTS), ts: Date.now(), likes: Math.floor(Math.random() * 18) });
    if (c.comments.length > 40) c.comments.pop();
    c.cVel += 1;
  }
  if (c.stream > 0) {
    c.stream--;
    if (c.stream === 0) toast('Stream ended. Holder count is what tells you if it converted.');
  }
}

/* KOTH is scored on velocity across three inputs, not raw volume.
   A coin with volume but no holder or comment momentum surfaces poorly. */
const KOTH_MCAP_USD = 30000;
/* Pure read of the current score — no decay applied. */
function computeMomentum(c) { return c.hVel * 3.0 + c.cVel * 4.5 + c.vVel * 2.2; }
/* One tick of the score: every input decays, then the score is recomputed. */
function scoreMomentum(c) {
  c.hVel *= 0.90; c.cVel *= 0.90; c.vVel *= 0.90;
  c.momentum = computeMomentum(c);
  return c.momentum;
}

function worldTick() {
  world.tick++;

  for (let i = 0; i < world.coins.length; i++) {
    const c = world.coins[i];
    if (c.graduated) continue;
    if (c.isPlayer) playerCoinTick(c); else simCoinTick(c);
    scoreMomentum(c);
    c.hist.push(price(c));
    if (c.hist.length > 200) c.hist.shift();
  }

  settlePending();

  // crown the king: clear the mcap floor first, then win on velocity
  const eligible = world.coins.filter(function (c) {
    return !c.graduated && c.revealed && mcapUsd(c) >= KOTH_MCAP_USD;
  });
  eligible.sort(function (a, b) { return b.momentum - a.momentum; });
  const top = eligible[0];
  if (top && top.id !== world.kingId) {
    const prev = world.byId[world.kingId];
    world.kingId = top.id; world.crownedAt = Date.now();
    top.everKoth = true; top.kothAt = Date.now();
    pushFeed(top, 'koth', 0, 0);
    if (top.isPlayer) {
      remember('koth', '$' + top.ticker + ' took King of the Hill' + (prev ? ' from $' + prev.ticker : ''));
      toast('👑 $' + top.ticker + ' is King of the Hill — front page slot.', 'good');
      pulseSurprise(0.95);
    }
  } else if (!top) {
    world.kingId = null;
  }

  if (Math.random() < 0.42) spawnSimCoin();

  render();
}

/* ══════════════════════════ 8. NAVIGATION ══════════════════════════ */

const VIEWS = ['board', 'create', 'devbuy', 'token', 'you'];
function go(view, id) {
  ui.view = view;
  if (id) ui.openId = id;
  for (let i = 0; i < VIEWS.length; i++) {
    const el = document.getElementById('view-' + VIEWS[i]);
    if (el) el.hidden = (VIEWS[i] !== view);
  }
  if (window.scrollTo) window.scrollTo(0, 0);
  render();
}

/* ══════════════════════════ 9. RENDER — BOARD ══════════════════════════ */

const BOARD_HINTS = {
  new: 'Freshly revealed coins, newest first. Creation is free — a coin only appears here once someone makes the first buy.',
  climbing: 'Ranked by momentum: holder growth, comment velocity and volume combined. Volume alone will not surface a coin.',
  koth: 'Coins past the $30K mcap floor, fighting for the crown. Highest momentum takes the front-page slot.',
  graduated: 'Made it off the curve. Liquidity migrated to the pool and the LP tokens were burned — under 2% of coins get here.'
};

function boardCoins(tab) {
  const live = world.coins.filter(function (c) { return c.revealed; });
  if (tab === 'graduated') return live.filter(function (c) { return c.graduated; }).sort(function (a, b) { return b.graduatedAt - a.graduatedAt; });
  const active = live.filter(function (c) { return !c.graduated; });
  if (tab === 'new')      return active.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).slice(0, 16);
  if (tab === 'climbing') return active.slice().sort(function (a, b) { return b.momentum - a.momentum; }).slice(0, 16);
  if (tab === 'koth')     return active.filter(function (c) { return mcapUsd(c) >= KOTH_MCAP_USD; })
                                       .sort(function (a, b) { return b.momentum - a.momentum; }).slice(0, 16);
  return active;
}

function coinRow(c) {
  const p = progress(c) * 100;
  const isKing = c.id === world.kingId;
  const h = c.hist.length;
  const change = h > 12 ? (c.hist[h - 1] / c.hist[h - 12] - 1) * 100 : 0;
  return '<button class="row' + (c.isPlayer ? ' mine' : '') + (isKing ? ' king-row' : '') + '" data-coin="' + c.id + '">' +
    '<span class="row-av" style="--h:' + c.hue + '">' + c.avatar + '</span>' +
    '<span class="row-mid">' +
      '<span class="row-t">$' + esc(c.ticker) + (c.isPlayer ? '<em class="mine-tag">yours</em>' : '') + (isKing ? ' 👑' : '') + '</span>' +
      '<span class="row-n">' + esc(c.name) + '</span>' +
    '</span>' +
    '<span class="row-num">' +
      '<span class="row-mc">' + fmtUsd(mcapUsd(c)) + '</span>' +
      '<span class="row-ch ' + (change >= 0 ? 'up' : 'down') + '">' + (change >= 0 ? '+' : '') + change.toFixed(1) + '%</span>' +
    '</span>' +
    '<span class="row-bar"><i style="width:' + clamp(p, 0, 100).toFixed(1) + '%"></i></span>' +
  '</button>';
}

/* Feed labels/verbs, kept terse so a chip reads in one glance. */
const FEED_LABEL = {
  buy: 'bought', whale: 'whale buy', sell: 'sold', devsell: 'dev sold',
  grad: 'graduated', koth: 'took KOTH', new: 'launched'
};

/* The live rail. Fresh-gated: only events newer than the last paint animate in,
   so the strip pulses on genuine activity instead of reflowing every tick. */
function renderLiveFeed() {
  const el = document.getElementById('liveFeed');
  if (!el) return;
  const items = world.feed.slice(0, 16);
  if (!items.length) { el.innerHTML = ''; return; }
  const seen = ui._feedSeen || 0;
  let newest = seen;
  const chips = items.map(function (f) {
    const fresh = f.seq > seen;
    if (f.seq > newest) newest = f.seq;
    const amt = (f.kind === 'buy' || f.kind === 'whale' || f.kind === 'sell' ||
                 f.kind === 'devsell' || (f.kind === 'new' && f.sol > 0))
      ? ' <span class="fc-sol">' + fmtSol(f.sol) + '</span>' : '';
    return '<button class="feed-chip fk-' + f.kind + (fresh ? ' fresh' : '') + '" data-coin="' + f.id + '"' +
      ' title="$' + esc(f.ticker) + ' — ' + FEED_LABEL[f.kind] + ' · ' + fmtUsd(f.mcap) + ' mcap">' +
      '<span class="fc-av" style="--h:' + f.hue + '">' + f.avatar + '</span>' +
      '<span class="fc-tx"><b>$' + esc(f.ticker) + '</b> ' + FEED_LABEL[f.kind] + amt + '</span>' +
    '</button>';
  }).join('');
  el.innerHTML = '<div class="feed-head"><span class="live-dot"></span>LIVE</div>' +
    '<div class="feed-rail">' + chips + '</div>';
  ui._feedSeen = newest;
}

/* ══════════════════════════ THE HILL — KOTH competition viz ══════════════════════════
   King of the Hill is a race, not a badge. The throne is held on momentum, and
   momentum is a live number every coin is fighting to raise. This panel draws
   that fight: who holds the crown, who is closing in, how far back they are, and
   what is fuelling each climb (holder growth · social velocity · volume). Every
   value is read straight off the sim — the gaps are real, the fuel mix is real. */

/* Split a coin's momentum into its three real contributions (same weights the
   crown is actually scored on). Returns fractions that sum to ~1. */
function momentumFuel(c) {
  const h = c.hVel * 3.0, s = c.cVel * 4.5, v = c.vVel * 2.2;
  const tot = h + s + v || 1;
  return { h: h / tot, s: s / tot, v: v / tot, raw: h + s + v };
}

function renderKingRace() {
  const kc = document.getElementById('kingCard');
  if (!kc) return;

  const active = world.coins.filter(function (c) { return c.revealed && !c.graduated; });
  const king = world.byId[world.kingId];

  // lead-change flash: remember who wore it last paint
  const changed = king && ui._lastKingId && ui._lastKingId !== king.id;
  ui._lastKingId = king ? king.id : ui._lastKingId;

  // No throne yet — show who is climbing toward the $30K contention floor so the
  // panel is a race even before anyone qualifies.
  if (!king) {
    const climbers = active.slice()
      .sort(function (a, b) { return mcapUsd(b) - mcapUsd(a); }).slice(0, 3);
    kc.className = 'hill vacant';
    kc.innerHTML =
      '<div class="hill-top"><span class="hill-crown">👑</span><span class="hill-title">The Hill is open</span>' +
        '<span class="hill-sub">no coin past the $30K floor</span></div>' +
      (climbers.length
        ? '<div class="hill-race">' + climbers.map(function (c) {
            const pctToFloor = clamp(mcapUsd(c) / KOTH_MCAP_USD * 100, 0, 100);
            return '<button class="race-row" data-coin="' + c.id + '">' +
              '<span class="rr-av" style="--h:' + c.hue + '">' + c.avatar + '</span>' +
              '<span class="rr-id"><b>$' + esc(c.ticker) + '</b><em>' + fmtUsd(mcapUsd(c)) + '</em></span>' +
              '<span class="rr-bar"><i class="to-floor" style="width:' + pctToFloor.toFixed(0) + '%"></i></span>' +
              '<span class="rr-gap">' + pctToFloor.toFixed(0) + '%<em>to floor</em></span>' +
            '</button>';
          }).join('') + '</div>'
        : '<div class="hill-empty">Give it a moment — momentum decides who takes the slot.</div>');
    return;
  }

  const kingMom = Math.max(king.momentum, 1e-6);
  const kf = momentumFuel(king);
  const heldMs = Date.now() - (world.crownedAt || Date.now());
  const heldTxt = heldMs < 60000 ? Math.max(1, Math.round(heldMs / 1000)) + 's'
    : Math.round(heldMs / 60000) + 'm';

  const contenders = active
    .filter(function (c) { return c.id !== king.id; })
    .sort(function (a, b) { return b.momentum - a.momentum; })
    .slice(0, 3);

  // the top contender's gap decides the threat level of the throne
  const chaser = contenders[0];
  const chaserGap = chaser ? (kingMom - chaser.momentum) / kingMom : 1;
  const contested = chaser && chaserGap < 0.12;   // within 12% = throne under threat

  const fuelBar =
    '<span class="fuel" title="What is fuelling the crown: holder growth · social · volume">' +
      '<i class="f-h" style="width:' + (kf.h * 100).toFixed(0) + '%"></i>' +
      '<i class="f-s" style="width:' + (kf.s * 100).toFixed(0) + '%"></i>' +
      '<i class="f-v" style="width:' + (kf.v * 100).toFixed(0) + '%"></i>' +
    '</span>';

  const race = contenders.map(function (c) {
    const rel = clamp(c.momentum / kingMom, 0, 1);        // bar vs the throne
    const gap = clamp((kingMom - c.momentum) / kingMom * 100, 0, 100);
    const near = gap < 12;                                 // real striking distance
    return '<button class="race-row' + (near ? ' near' : '') + (c.isPlayer ? ' mine' : '') + '" data-coin="' + c.id + '">' +
      '<span class="rr-av" style="--h:' + c.hue + '">' + c.avatar + '</span>' +
      '<span class="rr-id"><b>$' + esc(c.ticker) + (c.isPlayer ? ' <em class="rr-you">you</em>' : '') + '</b>' +
        '<em>' + fmtUsd(mcapUsd(c)) + '</em></span>' +
      '<span class="rr-bar"><i style="width:' + (rel * 100).toFixed(0) + '%"></i></span>' +
      '<span class="rr-gap' + (near ? ' hot' : '') + '">' + (near ? '⚡ ' : '') + '−' + gap.toFixed(0) + '%' +
        '<em>' + (near ? 'striking' : 'behind') + '</em></span>' +
    '</button>';
  }).join('');

  kc.className = 'hill' + (contested ? ' contested' : '') + (changed ? ' flash' : '');
  kc.innerHTML =
    '<div class="hill-top">' +
      '<span class="hill-crown">👑</span><span class="hill-title">King of the Hill</span>' +
      '<span class="hill-held" title="How long this coin has held the throne">held ' + heldTxt + '</span>' +
    '</div>' +
    '<button class="throne" data-coin="' + king.id + '">' +
      '<span class="th-av" style="--h:' + king.hue + '">' + king.avatar + '</span>' +
      '<span class="th-id"><b>$' + esc(king.ticker) + (king.isPlayer ? ' <em class="rr-you">you</em>' : '') + '</b>' +
        '<em>' + esc(king.name) + '</em></span>' +
      '<span class="th-stats"><b>' + fmtUsd(mcapUsd(king)) + '</b>' +
        '<em>' + king.holderCount + ' holders · ' + (progress(king) * 100).toFixed(0) + '% to grad</em></span>' +
    '</button>' +
    '<div class="hill-fuel"><span class="hf-lbl">fuelling the crown</span>' + fuelBar +
      '<span class="hf-key"><i class="f-h"></i>holders <i class="f-s"></i>social <i class="f-v"></i>volume</span></div>' +
    (contested
      ? '<div class="hill-alert">⚡ Throne contested — $' + esc(chaser.ticker) + ' is ' + (chaserGap * 100).toFixed(0) + '% off the crown</div>'
      : '') +
    (race ? '<div class="hill-race"><div class="hr-lbl">closing in</div>' + race + '</div>' : '');
}

function renderBoard() {
  renderLiveFeed();
  renderKingRace();
  const hint = document.getElementById('boardHint');
  if (hint) hint.textContent = BOARD_HINTS[ui.boardTab] || '';
  const list = document.getElementById('boardList');
  if (!list) return;
  const rows = boardCoins(ui.boardTab);
  list.innerHTML = rows.length
    ? rows.map(coinRow).join('')
    : '<div class="empty">Nothing here yet. ' +
      (ui.boardTab === 'graduated' ? 'Graduation is rare — under 2% of coins ever migrate.' : 'Give it a moment.') + '</div>';
}

/* ══════════════════════════ 10. RENDER — TOKEN PAGE ══════════════════════════ */

function renderTokenHead(c) {
  const el = document.getElementById('tokenHead');
  if (!el) return;
  const v = VENUES[c.venue];
  el.innerHTML =
    '<div class="tk-head">' +
      '<span class="tk-av" style="--h:' + c.hue + '">' + c.avatar + '</span>' +
      '<div class="tk-id">' +
        '<div class="tk-t">$' + esc(c.ticker) +
          (c.id === world.kingId ? ' <span class="crown">👑 KOTH</span>' : '') +
          (c.graduated ? ' <span class="grad-tag">GRADUATED</span>' : '') + '</div>' +
        '<div class="tk-n">' + esc(c.name) + '</div>' +
      '</div>' +
    '</div>' +
    (c.desc ? '<p class="tk-desc">' + esc(c.desc) + '</p>' : '') +
    '<div class="tk-meta"><span>' + v.name + '</span>' +
      (c.isPlayer ? '<span class="tk-you">your coin</span>' : '') +
      '<span>created ' + ago(c.createdAt) + ' ago</span>' +
      (c.twitter ? '<span>X ✓</span>' : '') + (c.telegram ? '<span>TG ✓</span>' : '') + (c.website ? '<span>web ✓</span>' : '') +
      '<span class="tk-immutable">metadata immutable</span></div>';
}

function renderStats(c) {
  const el = document.getElementById('tokenStats');
  const h = holderTable(c);
  if (el) el.innerHTML =
    '<div class="stat"><span class="sl">Market cap</span><span class="sv">' + fmtUsd(mcapUsd(c)) + '</span></div>' +
    '<div class="stat"><span class="sl">Price</span><span class="sv">' + fmtPrice(price(c)) + '<em> SOL</em></span></div>' +
    '<div class="stat"><span class="sl">Liquidity</span><span class="sv">' + fmtSol(liquidity(c)) + '<em> SOL</em></span></div>' +
    '<div class="stat"><span class="sl">Holders</span><span class="sv">' + c.holderCount + '</span></div>' +
    '<div class="stat"><span class="sl">Top 10</span><span class="sv ' + (h.top10 > 45 ? 'down' : '') + '">' + h.top10.toFixed(1) + '%</span></div>' +
    '<div class="stat"><span class="sl">Dev</span><span class="sv ' + (c.dev.sold ? 'down' : '') + '">' + (c.dev.sold ? 'SOLD' : h.devPct.toFixed(1) + '%') + '</span></div>';

  const gb = document.getElementById('gradBar');
  const v = VENUES[c.venue];
  if (!gb) return;
  gb.innerHTML = c.graduated
    ? '<div class="grad-done"><b>Migrated to ' + v.pool + '.</b> ' +
        fmtSol(c.poolSol) + ' SOL and ' + fmtTok(c.poolTokens) + ' tokens seeded the pool. ' +
        'The 30 SOL virtual advance was reclaimed by the protocol' +
        (c.burned ? ', and ' + fmtTok(c.burned) + ' tokens were burned' : '') + '.' +
        '<span class="lpburn">🔥 LP tokens burned — liquidity can never be pulled.</span></div>'
    : '<div class="grad-wrap">' +
        '<div class="grad-top"><span>Bonding curve progress</span><b>' + fmtSol(realSol(c)) + ' / ' + v.gradSol + ' SOL</b></div>' +
        '<div class="grad-track"><i style="width:' + (progress(c) * 100).toFixed(2) + '%"></i></div>' +
        '<div class="grad-foot">' + (progress(c) * 100).toFixed(1) + '% — at ' + v.gradSol +
          ' SOL bonded it migrates to ' + v.pool + ' and the LP is burned. Under 2% of coins get there.</div>' +
      '</div>';
}

const PRESETS = [0.25, 0.5, 1, 2, 5, 10];
const PRIOS = [[0.0001, 'minimum'], [0.0005, 'low'], [0.001, 'normal'], [0.005, 'high'], [0.01, 'turbo']];

function renderTradePanel(c) {
  const el = document.getElementById('tradePanel');
  if (!el) return;
  const pos = wallet.pos[c.id];
  const held = pos ? pos.tokens : 0;

  if (c.graduated) {
    const gv = held > 0 ? held * (c.gradPrice || price(c)) : 0;
    el.innerHTML = '<div class="card"><b>Off the curve.</b> In a real launchpad you would trade this on ' +
      VENUES[c.venue].pool + ' from here. The curve is closed and the LP is burned.' +
      (held > 0 ? '<div class="hint">You still hold ' + fmtTok(held) + ' $' + esc(c.ticker) + ' — worth about ' + fmtSol(gv) + ' SOL at the migration price.</div>' : '') +
      '</div>';
    return;
  }

  const val = held > 0 ? quoteSell(c, held) : 0;
  const pnl = held > 0 ? val - pos.cost : 0;
  let inflight = 0, landIn = 0;
  for (let i = 0; i < pending.length; i++) if (pending[i].coinId === c.id) {
    inflight++; if (inflight === 1) landIn = Math.max(0, pending[i].at - world.tick);
  }

  const est = quoteBuy(c, ui.exec.amount * (1 - creatorFeePct(c) / 100));
  const impact = est > 0 ? ((ui.exec.amount / est) / price(c) - 1) * 100 : 0;

  el.innerHTML = '<div class="card trade">' +
    '<div class="trade-simnote">Simulated order — no real funds move.</div>' +

    '<div class="presets">' + PRESETS.map(function (p) {
      return '<button class="pill' + (ui.exec.amount === p ? ' on' : '') + '" data-amt="' + p + '">' + p + '</button>';
    }).join('') +
      '<input class="amt" id="amtIn" type="number" min="0" step="0.05" value="' + ui.exec.amount + '">' +
      '<span class="amt-unit">SOL</span></div>' +

    '<div class="quote"><span>≈ ' + fmtTok(est) + ' $' + esc(c.ticker) + '</span>' +
      '<span class="' + (impact > 3 ? 'down' : '') + '">' + impact.toFixed(2) + '% price impact</span>' +
      '<span>' + creatorFeePct(c).toFixed(2) + '% creator fee</span></div>' +

    '<details class="adv"' + (ui.exec.slippage !== 15 || ui.exec.priority !== 0.001 ? ' open' : '') + '>' +
      '<summary>Slippage &amp; priority fee</summary>' +
      '<div class="adv-grid">' +
        '<label>Slippage tolerance<select id="slipIn">' +
          [1, 5, 10, 15, 25, 50].map(function (s) {
            return '<option value="' + s + '"' + (ui.exec.slippage === s ? ' selected' : '') + '>' + s + '%</option>';
          }).join('') + '</select></label>' +
        '<label>Priority fee<select id="prioIn">' +
          PRIOS.map(function (p) {
            return '<option value="' + p[0] + '"' + (ui.exec.priority === p[0] ? ' selected' : '') + '>' + p[0] + ' SOL — ' + p[1] + '</option>';
          }).join('') + '</select></label>' +
      '</div>' +
      '<p class="hint">A higher priority fee lands your order sooner. A cheap one means the price has already moved by the time it fills — and if it moved past your slippage tolerance the transaction reverts and the fee is gone.</p>' +
    '</details>' +

    (inflight ? '<div class="inflight">⏳ ' + inflight + ' order' + (inflight > 1 ? 's' : '') +
      ' in flight — landing in ' + landIn + ' block' + (landIn === 1 ? '' : 's') + '</div>' : '') +

    '<div class="trade-btns">' +
      '<button class="primary" id="buyBtn">Buy ' + ui.exec.amount + ' SOL</button>' +
      '<button class="ghost" id="sell50">Sell 50%</button>' +
      '<button class="ghost" id="sell100">Sell all</button>' +
    '</div>' +

    (held > 0 ? '<div class="pos-strip">' +
      '<div><span class="tl">Holding</span><span class="tv">' + fmtTok(held) + '</span></div>' +
      '<div><span class="tl">Value</span><span class="tv">' + fmtSol(val) + ' SOL</span></div>' +
      '<div><span class="tl">Open P&amp;L</span><span class="tv ' + (pnl >= 0 ? 'up' : 'down') + '">' +
        (pnl >= 0 ? '+' : '') + fmtSol(pnl) + '</span></div></div>' : '') +

    (c.isPlayer ? '<div class="dev-tools">' +
      '<button class="ghost" id="goLive">' + (c.stream ? '🔴 Live (' + c.stream + ')' : 'Go live') + '</button>' +
      '<button class="ghost" id="shareBtn">Share</button>' +
      '<span class="hint">Streaming and comments raise momentum, which is what decides board placement.</span></div>' : '') +
  '</div>';
}

function renderTabBody(c) {
  const el = document.getElementById('tokenTabBody');
  if (!el) return;

  if (ui.tokenTab === 'trades') {
    el.innerHTML = c.trades.length
      ? '<div class="tape">' + c.trades.map(function (t) {
          if (t.kind === 'grad') {
            return '<div class="tp grad"><span class="tp-w">migration</span><span class="tp-a">LP burned</span>' +
              '<span class="tp-s">' + fmtSol(t.sol) + ' SOL</span><span class="tp-k">' + fmtTok(t.tokens) + '</span>' +
              '<span class="tp-t">' + ago(t.ts) + '</span></div>';
          }
          const dev = t.kind === 'devsell' || t.tag === 'DEV SOLD' || t.tag === 'dev';
          return '<div class="tp ' + (t.kind === 'buy' ? 'buy' : 'sell') + (dev && t.kind !== 'buy' ? ' devsell' : '') + '">' +
            '<span class="tp-w">' + (t.w === 'you' ? '<b>you</b>' : shortWallet(t.w)) +
              (t.tag === 'whale' ? ' 🐋' : '') + (dev ? ' <b>DEV</b>' : '') + '</span>' +
            '<span class="tp-a">' + (t.kind === 'buy' ? 'buy' : 'sell') + '</span>' +
            '<span class="tp-s">' + fmtSol(t.sol) + ' SOL</span>' +
            '<span class="tp-k">' + fmtTok(t.tokens) + '</span>' +
            '<span class="tp-t">' + ago(t.ts) + '</span></div>';
        }).join('') + '</div>'
      : '<div class="empty">No trades yet.</div>';
    return;
  }

  if (ui.tokenTab === 'holders') {
    const h = holderTable(c);
    if (!h.rows.length) { el.innerHTML = '<div class="empty">No holders yet — nobody has bought.</div>'; return; }
    const risk = h.top10 > 55 ? 'high' : h.top10 > 35 ? 'medium' : 'low';
    el.innerHTML =
      '<div class="risk risk-' + risk + '"><b>Top-10 concentration ' + h.top10.toFixed(1) + '%</b> — ' + risk + ' risk. ' +
        (c.dev.sold ? 'The dev has sold their entire position.' : 'Dev holds ' + h.devPct.toFixed(1) + '%.') +
        (c.bundled ? ' Several top wallets trace back to the dev — this looks bundled.' : '') + '</div>' +
      '<div class="holders">' + h.rows.slice(0, 12).map(function (r, i) {
        return '<div class="hd' + (r.you ? ' you' : '') + (r.dev ? ' dev' : '') + '">' +
          '<span class="hd-i">' + (i + 1) + '</span>' +
          '<span class="hd-w">' + (r.you ? '<b>you</b>' : shortWallet(r.w)) +
            (r.dev ? ' <em>dev</em>' : '') + (r.bundle ? ' <em class="bundle">bundled</em>' : '') + '</span>' +
          '<span class="hd-p">' + (r.tokens / h.sold * 100).toFixed(2) + '%</span>' +
          '<span class="hd-b"><i style="width:' + clamp(r.tokens / h.rows[0].tokens * 100, 2, 100).toFixed(1) + '%"></i></span>' +
        '</div>';
      }).join('') + '</div>' +
      '<p class="hint">Holder count ' + c.holderCount + '. Concentration is the first thing read on a real token page — a handful of wallets holding most of the supply can exit together.</p>';
    return;
  }

  if (ui.tokenTab === 'bubbles') { el.innerHTML = bubbleMap(c); return; }

  if (ui.tokenTab === 'comments') {
    el.innerHTML =
      '<div class="cm-box"><input id="cmIn" maxlength="90" placeholder="Say something…" autocomplete="off">' +
        '<button class="ghost" id="cmGo">Post</button></div>' +
      '<p class="hint">Comment and reaction velocity is a real ranking input — it feeds the momentum score that decides board placement, alongside holder growth and volume.</p>' +
      '<div class="comments">' + (c.comments.length ? c.comments.map(function (m) {
        return '<div class="cm' + (m.w === 'you' ? ' mine' : '') + '">' +
          '<span class="cm-w">' + (m.w === 'you' ? 'you' : shortWallet(m.w)) + '</span>' +
          '<span class="cm-x">' + esc(m.text) + '</span>' +
          '<span class="cm-l">♥ ' + m.likes + '</span>' +
          '<span class="cm-t">' + ago(m.ts) + '</span></div>';
      }).join('') : '<div class="empty">No comments yet. Be first — it moves the momentum score.</div>') + '</div>';
    return;
  }

  if (ui.tokenTab === 'creator') {
    const pct = creatorFeePct(c);
    const m = mcapUsd(c);
    const marks = [[1e4, '$10K'], [3e5, '$300K'], [2e6, '$2M'], [2e7, '$20M+']];
    el.innerHTML = '<div class="card">' +
      '<div class="fee-now"><span class="tl">Current creator fee</span><span class="tv">' + pct.toFixed(2) + '%<em> per trade</em></span></div>' +
      '<div class="fee-curve">' + marks.map(function (mk) {
        const v = mk[0];
        const p = v <= 3e5 ? 0.95 : v >= 2e7 ? 0.05
          : 0.95 + ((Math.log10(v) - Math.log10(3e5)) / (Math.log10(2e7) - Math.log10(3e5))) * (0.05 - 0.95);
        return '<div class="fc' + (m >= v * 0.6 && m < v * 6 ? ' on' : '') + '"><span>' + mk[1] + '</span><b>' + p.toFixed(2) + '%</b></div>';
      }).join('') + '</div>' +
      '<p class="hint">The fee is regressive on purpose: a creator earns the most while the coin is small, and the cut tapers as it grows. Revenue can be split across up to 10 wallets, ownership can be transferred, and a community takeover can reassign the share after launch.</p>' +
      '<div class="fee-earned"><span class="tl">Fees accrued on this coin</span>' +
        '<span class="tv">' + fmtSol(c.creatorFees) + ' SOL <em>' + fmtUsd(c.creatorFees * SIM.SOL_USD) + '</em></span></div>' +
      (c.isPlayer ? '<button class="ghost" id="claimFees">Claim to wallet</button>'
                  : '<p class="hint">You are not the creator of this coin — these fees go to ' + shortWallet(c.dev.wallet) + '.</p>') +
    '</div>';
  }
}

/* Bubble map: the community-standard rug check, drawn as a cluster graph.
   Wallets whose supply traces back to the dev are wired to it — that is bundling. */
function bubbleMap(c) {
  const h = holderTable(c);
  if (!h.rows.length) return '<div class="empty">Nothing to map yet.</div>';
  const nodes = h.rows.slice(0, 12);
  const maxT = nodes[0].tokens || 1;
  const W = 320, H = 260, cx = W / 2, cy = H / 2;

  // A dev that has sold still anchors the cluster it created. Dropping the node
  // would leave the bundled wallets floating free and contradict the verdict —
  // so the origin wallet stays on the map, drawn as an emptied anchor.
  let hasDev = false;
  for (let i = 0; i < nodes.length; i++) if (nodes[i].dev) hasDev = true;
  if (!hasDev && c.bundled) {
    nodes.unshift({ w: c.dev.wallet, tokens: 0, dev: true, bundle: false, exited: true });
  }

  const pts = nodes.map(function (n, i) {
    if (n.dev) return { n: n, x: cx, y: cy, r: n.exited ? 13 : 12 + Math.sqrt(n.tokens / maxT) * 22 };
    const ang = (i / nodes.length) * Math.PI * 2 + (n.bundle ? 0.4 : 1.9);
    const rad = n.bundle ? 52 + (i % 3) * 14 : 88 + (i % 4) * 11;
    return { n: n, x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad * 0.8, r: 8 + Math.sqrt(n.tokens / maxT) * 22 };
  });

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="bubbles" role="img" aria-label="Holder cluster map">';
  let dev = null;
  for (let i = 0; i < pts.length; i++) if (pts[i].n.dev) dev = pts[i];
  if (dev) {
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].n.bundle) svg += '<line x1="' + dev.x + '" y1="' + dev.y + '" x2="' + pts[i].x.toFixed(1) + '" y2="' + pts[i].y.toFixed(1) + '" class="edge"/>';
    }
  }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const cls = p.n.exited ? 'b-exit' : p.n.dev ? 'b-dev' : p.n.you ? 'b-you' : p.n.bundle ? 'b-bundle' : 'b-plain';
    svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + p.r.toFixed(1) + '" class="' + cls + '"/>';
    if (p.n.exited) svg += '<text x="' + p.x.toFixed(1) + '" y="' + (p.y + 4).toFixed(1) + '" class="b-lbl">sold</text>';
    else if (p.r > 14) svg += '<text x="' + p.x.toFixed(1) + '" y="' + (p.y + 4).toFixed(1) + '" class="b-lbl">' + (p.n.tokens / h.sold * 100).toFixed(0) + '%</text>';
  }
  svg += '</svg>';

  // a freshly revealed coin can be flagged bundled while the sock-puppet
  // wallets still hold nothing — say what is actually on the map
  const verdict = (c.bundled && h.bundledPct >= 1)
    ? '<b class="down">Bundled.</b> ' + h.bundledPct.toFixed(1) + '% of supply sits in wallets wired back to the dev. They can exit together.'
    : (c.bundled && h.devPct > 60)
      ? '<b class="down">Dev holds ' + h.devPct.toFixed(1) + '%.</b> Almost nothing has been distributed yet — one wallet is the entire float.'
      : h.top10 > 50
      ? '<b class="down">Concentrated.</b> The top 10 hold ' + h.top10.toFixed(1) + '%, but no cluster traces back to one source.'
      : '<b class="up">Clean spread.</b> Nothing ties back to the dev wallet, top 10 at ' + h.top10.toFixed(1) + '%.';

  return svg +
    '<div class="b-legend"><span><i class="b-dev"></i> dev</span><span><i class="b-bundle"></i> tied to dev</span>' +
      '<span><i class="b-you"></i> you</span><span><i class="b-plain"></i> independent</span></div>' +
    '<div class="verdict">' + verdict + '</div>' +
    '<p class="hint">A line means that wallet\'s supply traces back to the dev. When the top of the map is one connected cluster, that supply is effectively a single seller.</p>';
}

function renderToken() {
  const c = world.byId[ui.openId];
  if (!c) { if (ui.view === 'token') go('board'); return; }
  renderTokenHead(c);
  renderStats(c);
  renderTradePanel(c);
  renderTabBody(c);
  drawChart(c);
}

/* ══════════════════════════ 11. CHART ══════════════════════════ */

function drawChart(c) {
  const cv = document.getElementById('meme-hype-canvas');
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, pad = 22;
  const data = c.hist.slice(-160);
  ctx.clearRect(0, 0, W, H);
  if (data.length < 2) return;

  let lo = Math.min.apply(null, data), hi = Math.max.apply(null, data);
  const pos = wallet.pos[c.id];
  const entry = pos && pos.tokens > 0 ? pos.cost / pos.tokens : 0;
  if (entry) { lo = Math.min(lo, entry); hi = Math.max(hi, entry); }
  const span = (hi - lo) || hi || 1e-12;
  const yOf = function (v) { return (H - pad) - ((v - lo) / span) * (H - pad * 2); };
  const xOf = function (i) { return pad + (i / (data.length - 1)) * (W - pad * 2); };

  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
  for (let g = 0; g <= 3; g++) {
    const y = pad + (g / 3) * (H - pad * 2);
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
  }

  const up = data[data.length - 1] >= (entry || data[0]);
  const stroke = c.graduated ? '#c9a34a' : up ? '#7ad19b' : '#e0736f';

  const grad = ctx.createLinearGradient(0, pad, 0, H - pad);
  grad.addColorStop(0, up ? 'rgba(122,209,155,0.22)' : 'rgba(224,115,111,0.20)');
  grad.addColorStop(1, 'rgba(16,12,8,0.02)');
  ctx.beginPath(); ctx.moveTo(xOf(0), H - pad);
  for (let i = 0; i < data.length; i++) ctx.lineTo(xOf(i), yOf(data[i]));
  ctx.lineTo(xOf(data.length - 1), H - pad); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = xOf(i), y = yOf(data[i]);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.strokeStyle = stroke; ctx.lineWidth = 2;
  ctx.shadowBlur = 8; ctx.shadowColor = stroke; ctx.stroke(); ctx.shadowBlur = 0;

  if (entry) {
    const ey = yOf(entry);
    ctx.strokeStyle = 'rgba(233,220,192,0.32)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, ey); ctx.lineTo(W - pad, ey); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(233,220,192,0.6)'; ctx.font = '12px system-ui';
    ctx.fillText('your entry', pad + 4, ey - 6);
  }

  ctx.fillStyle = stroke;
  ctx.beginPath(); ctx.arc(xOf(data.length - 1), yOf(data[data.length - 1]), 3.5, 0, Math.PI * 2); ctx.fill();

  // the golden eye still watches, and reacts to sharp moves
  if (window.hypeEye) {
    const back = data[Math.max(0, data.length - 8)] || data[0];
    const move = Math.abs(data[data.length - 1] / back - 1);
    window.hypeEye(ctx, W, H * 0.3, _eye, clamp(move * 6, 0, 1), _mood, clamp(move * 3, 0, 0.5));
  }
}

/* Preserved from the original build: nudges the eye, returns a surprise value. */
function pulseSurprise(intensity) {
  intensity = intensity == null ? 0.75 : intensity;
  _eye.pulse = (_eye.pulse + intensity * 0.6) % 6.28;
  _mood.energy = Math.min(1, 0.35 + intensity * 0.5);
  const cv = document.getElementById('meme-hype-canvas');
  if (cv && cv.getContext && window.hypeEye) {
    window.hypeEye(cv.getContext('2d'), cv.width, cv.height / 2, _eye, intensity, _mood, 0.2);
  }
  return Math.max(0.15, typeof _eye.lastSurprise === 'number' ? _eye.lastSurprise : 0.6);
}

/* ══════════════════════════ GRADUATION — the migration moment ══════════════════════════
   Under 2% of coins clear the curve. When one does, the LP is burned and the
   liquidity is locked forever — the single most consequential event a coin can
   reach. It deserves more than a toast. Your own coin gets the full stage; a
   coin you don't own slides a banner across the top so the rarity is still felt.
   Pure presentation — the numbers shown are the same ones the sim just recorded. */

function ensureGradLayer() {
  let el = document.getElementById('gradLayer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'gradLayer';
    // tapping the backdrop (outside the card) dismisses the full stage
    el.addEventListener('click', function (ev) {
      if (ev.target === el) closeGradCelebration();
    });
    document.body.appendChild(el);
  }
  return el;
}

/* Physics confetti — gold/green/violet, gravity + drift, self-clearing.
   Visual only: particle spread is decorative, it claims no metric. */
function confettiBurst(canvas, seedHue) {
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth || window.innerWidth;
  const H = canvas.clientHeight || window.innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  const COLORS = ['#e8c76a', '#c9a34a', '#7ad19b', '#a98bff', '#ffffff'];
  const N = 150;
  const ps = [];
  for (let i = 0; i < N; i++) {
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const spd = 6 + Math.random() * 11;
    ps.push({
      x: W / 2, y: H * 0.42,
      vx: Math.cos(ang) * spd * (0.6 + Math.random()),
      vy: Math.sin(ang) * spd - Math.random() * 4,
      g: 0.22 + Math.random() * 0.12,
      s: 4 + Math.random() * 6,
      rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4,
      c: COLORS[Math.floor(Math.random() * COLORS.length)],
      life: 1
    });
  }
  const t0 = performance.now();
  function frame(t) {
    const dt = Math.min(2, (t - (frame._p || t)) / 16.7); frame._p = t;
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.life <= 0) continue;
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      p.vx *= 0.99;
      if (t - t0 > 1400) p.life -= 0.02 * dt;
      if (p.y > H + 40) p.life = 0;
      if (p.life <= 0) continue;
      alive++;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      ctx.restore();
    }
    if (alive > 0 && t - t0 < 4200) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, W, H);
  }
  requestAnimationFrame(frame);
}

let _gradTimer = null;
function closeGradCelebration() {
  const el = document.getElementById('gradLayer');
  if (el) { el.classList.remove('show'); el.innerHTML = ''; }
  if (_gradTimer) { clearTimeout(_gradTimer); _gradTimer = null; }
}

function celebrateGraduation(c) {
  const v = VENUES[c.venue];
  const mine = !!c.isPlayer;

  if (!mine) {
    // A coin you don't own: a non-blocking banner slides across the top.
    const el = ensureGradLayer();
    el.className = 'grad-banner show';
    el.innerHTML =
      '<button class="gb-inner" data-coin="' + c.id + '">' +
        '<span class="gb-flame">🎓</span>' +
        '<span class="gb-tx"><b>$' + esc(c.ticker) + ' graduated</b>' +
          '<em>' + fmtSol(c.poolSol) + ' SOL migrated to ' + v.pool + ' · LP burned 🔥</em></span>' +
        '<span class="gb-rare">rare</span>' +
      '</button>';
    if (_gradTimer) clearTimeout(_gradTimer);
    _gradTimer = setTimeout(closeGradCelebration, 5200);
    return;
  }

  // Your coin made it — full stage.
  toast('$' + c.ticker + ' graduated. LP burned — liquidity is locked forever.', 'good');
  const el = ensureGradLayer();
  el.className = 'grad-stage show';
  el.innerHTML =
    '<canvas class="grad-confetti"></canvas>' +
    '<div class="gs-card" role="dialog" aria-label="Coin graduated">' +
      '<div class="gs-rare">◆ UNDER 2% OF COINS EVER GET HERE ◆</div>' +
      '<div class="gs-av" style="--h:' + c.hue + '">' + c.avatar + '</div>' +
      '<div class="gs-tk">$' + esc(c.ticker) + '</div>' +
      '<div class="gs-head">GRADUATED</div>' +
      '<div class="gs-rows">' +
        '<div class="gs-r"><span>Migrated to</span><b>' + v.pool + '</b></div>' +
        '<div class="gs-r"><span>Seeded pool</span><b>' + fmtSol(c.poolSol) + ' SOL</b></div>' +
        '<div class="gs-r"><span>Market cap</span><b>' + fmtUsd(c.gradMcap || mcapUsd(c)) + '</b></div>' +
        (c.burned ? '<div class="gs-r"><span>Burned</span><b>' + fmtTok(c.burned) + '</b></div>' : '') +
      '</div>' +
      '<div class="gs-burn">🔥 LP tokens burned — liquidity can never be pulled</div>' +
      '<div class="gs-note">Simulated migration — no real pool, tokens or blockchain.</div>' +
      '<button class="gs-close" id="gradClose">Continue</button>' +
    '</div>';
  const cv = el.querySelector('.grad-confetti');
  if (cv) confettiBurst(cv, c.hue);
  pulseSurprise(1);
  if (navigator.vibrate) { try { navigator.vibrate([30, 40, 60]); } catch (e) {} }
  if (_gradTimer) clearTimeout(_gradTimer);
  _gradTimer = setTimeout(closeGradCelebration, 6500);
}

/* ══════════════════════════ 12. CREATE FLOW ══════════════════════════ */

let draftCoin = null;

function renderCreate() {
  const vp = document.getElementById('venuePick');
  if (vp) {
    const keys = Object.keys(VENUES);
    vp.innerHTML = keys.map(function (k) {
      const v = VENUES[k];
      return '<button class="venue' + (ui.draft.venue === v.id ? ' on' : '') + '" data-venue="' + v.id + '">' +
        '<b>' + v.name + '</b>' +
        '<span>' + (v.launchFee ? v.launchFee + ' SOL to launch' : 'free to launch') + ' · graduates at ' + v.gradSol + ' SOL</span>' +
        '<em>' + esc(v.blurb) + '</em></button>';
    }).join('');
  }

  const ap = document.getElementById('avatarPick');
  if (ap) ap.innerHTML = AVATARS.map(function (a) {
    return '<button class="av' + (ui.draft.avatar === a ? ' on' : '') + '" data-av="' + a + '">' + a + '</button>';
  }).join('');

  const v = VENUES[ui.draft.venue];
  const fee = document.getElementById('createFee');
  if (fee) fee.textContent = v.launchFee
    ? v.name + ' charges ' + v.launchFee + ' SOL to launch, graduates at ' + v.gradSol + ' SOL, and burns ' + fmtTok(v.burnAtGrad) + ' tokens at migration.'
    : v.name + ' is free to create. Your coin stays off-chain and invisible until the first buy.';

  const btn = document.getElementById('submitCreate');
  if (btn) btn.textContent = v.launchFee ? 'Create coin — ' + v.launchFee + ' SOL' : 'Create coin — free';
}

function submitCreate() {
  const nameEl = document.getElementById('cName');
  const tickEl = document.getElementById('cTicker');
  const name = ((nameEl && nameEl.value) || '').trim();
  const ticker = ((tickEl && tickEl.value) || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!name) { toast('Name is required.', 'bad'); if (nameEl) nameEl.focus(); return; }
  if (!ticker) { toast('Ticker is required — and it can never be changed.', 'bad'); if (tickEl) tickEl.focus(); return; }

  const v = VENUES[ui.draft.venue];
  if (wallet.sol < v.launchFee) { toast('Need ' + v.launchFee + ' SOL for the ' + v.name + ' launch fee.', 'bad'); return; }
  wallet.sol -= v.launchFee;

  const val = function (id) { const e = document.getElementById(id); return e ? (e.value || '').trim() : ''; };
  draftCoin = mkCoin({
    name: name, ticker: ticker, avatar: ui.draft.avatar, venue: ui.draft.venue,
    desc: val('cDesc'), twitter: val('cTw'), telegram: val('cTg'), website: val('cWeb'),
    isPlayer: true
  });
  draftCoin.dev.wallet = 'you';
  go('devbuy');
}

function renderDevBuy() {
  const c = draftCoin;
  if (!c) { if (ui.view === 'devbuy') go('board'); return; }
  const box = document.getElementById('devbuyCoin');
  if (box) box.innerHTML = '<div class="card dev-preview">' +
    '<span class="tk-av" style="--h:' + c.hue + '">' + c.avatar + '</span>' +
    '<div><b>$' + esc(c.ticker) + '</b><em>' + esc(c.name) + '</em></div></div>';
  const pp = document.getElementById('devPresets');
  if (pp) pp.innerHTML = [0, 0.5, 1, 2, 5].map(function (p) {
    return '<button class="pill" data-dev="' + p + '">' + (p === 0 ? 'none' : p) + '</button>';
  }).join('');
  updateDevQuote();
}

function updateDevQuote() {
  const c = draftCoin;
  const el = document.getElementById('devQuote');
  const inp = document.getElementById('devAmt');
  if (!c || !el) return;
  const amt = Number(inp ? inp.value : 0) || 0;
  if (amt <= 0) { el.textContent = 'No dev buy — 0% dev holding, but the curve starts completely cold.'; return; }
  const tok = quoteBuy(c, amt * (1 - 0.95 / 100));
  el.textContent = '≈ ' + fmtTok(tok) + ' tokens — ' + (tok / CURVE.TOTAL * 100).toFixed(2) +
    '% of total supply. Opening price ' + fmtPrice(price(c)) + ' SOL.';
}

function doDevBuy(amount) {
  const c = draftCoin;
  if (!c) return;
  if (amount > 0) {
    if (wallet.sol < amount) { toast('Not enough SOL.', 'bad'); return; }
    wallet.sol -= amount;
    const tokens = applyBuy(c, amount, 'you', 'dev');
    c.dev.tokens = tokens; c.dev.spent = amount;
    if (!wallet.pos[c.id]) wallet.pos[c.id] = { tokens: 0, cost: 0 };
    wallet.pos[c.id].tokens += tokens; wallet.pos[c.id].cost += amount;
    c.holderCount = 1;
  }
  c.revealed = true;
  pushFeed(c, 'new', amount, 0);
  addCoin(c);
  remember('launch', '$' + c.ticker + ' "' + c.name + '" revealed on ' + VENUES[c.venue].name +
    (amount > 0 ? ' with a ' + fmtSol(amount) + ' SOL dev buy' : ' with no dev buy'));
  if (window.legionTrack) window.legionTrack('activate');
  try{bumpMfStreak('launch');renderMfLoop();}catch(e){}
  toast('$' + c.ticker + ' is live on the curve.', 'good');
  const id = c.id;
  draftCoin = null;
  saveWallet();
  go('token', id);
}

/* ══════════════════════════ 13. PLAYER LEVERS ══════════════════════════ */

function postComment() {
  const c = world.byId[ui.openId];
  const inp = document.getElementById('cmIn');
  if (!c || !inp) return;
  const text = (inp.value || '').trim();
  if (!text) return;
  const before = computeMomentum(c);
  c.comments.unshift({ w: 'you', text: text, ts: Date.now(), likes: 0 });
  c.cVel += 3;                      // your comment genuinely moves the momentum score
  inp.value = '';
  // report the comment's own contribution, not the tick decay that follows it
  c.momentum = computeMomentum(c);
  toast('Posted. Momentum ' + before.toFixed(0) + ' → ' + c.momentum.toFixed(0) + '.');
  renderToken();
}

function goLive() {
  const c = world.byId[ui.openId];
  if (!c || !c.isPlayer) return;
  if (c.stream) { toast('Already live.'); return; }
  c.stream = 30;                    // ticks
  c.cVel += 6;
  pulseSurprise(0.85);
  remember('stream', 'Went live on $' + c.ticker);
  toast('Live. Streaming lifts momentum — holder count tells you if it converted.', 'good');
  renderToken();
}

function claimFees() {
  const c = world.byId[ui.openId];
  if (!c || !c.isPlayer || !(c.creatorFees > 0)) { toast('Nothing to claim yet.'); return; }
  const amt = c.creatorFees;
  wallet.sol += amt; wallet.fees += amt; c.creatorFees = 0;
  remember('fees', 'Claimed ' + fmtSol(amt) + ' SOL of creator fees on $' + c.ticker);
  toast('Claimed ' + fmtSol(amt) + ' SOL.', 'good');
  saveWallet();
  renderToken();
}

function shareCoin() {
  const c = world.byId[ui.openId];
  if (!c) return;
  const h = holderTable(c);
  const story =
    '$' + c.ticker + ' "' + c.name + '" — ' + fmtUsd(mcapUsd(c)) + ' mcap, ' +
      (progress(c) * 100).toFixed(0) + '% of the way to graduation.\n' +
    c.holderCount + ' holders · top 10 hold ' + h.top10.toFixed(1) + '% · ' + fmtSol(liquidity(c)) + ' SOL liquidity.\n' +
    '#MemeForge — fictional simulation, no real money, 18+';
  const done = function () { toast('Share card copied.'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(story).then(done, done);
  } else done();
  c.cVel += 4;
  remember('share', 'Shared $' + c.ticker + ' at ' + fmtUsd(mcapUsd(c)));
  if (window.legionTrack) window.legionTrack('share');
  renderToken();
}

/* ══════════════════════════ 14. PORTFOLIO + LEDGER ══════════════════════════ */

function portfolioValue() {
  let v = 0;
  for (const id in wallet.pos) {
    const c = world.byId[id];
    const p = wallet.pos[id];
    if (!c || !p || p.tokens <= 0) continue;
    v += c.graduated ? p.tokens * (c.gradPrice || price(c)) : quoteSell(c, p.tokens);
  }
  return v;
}

function renderWalletChip() {
  const el = document.getElementById('walletChip');
  if (!el) return;
  const pv = portfolioValue();
  el.innerHTML = '<span class="wc-sol">' + fmtSol(wallet.sol) + ' SOL</span>' +
    (pv > 0.0001 ? '<span class="wc-pos">+' + fmtSol(pv) + ' in bags</span>' : '<span class="wc-pos">no positions</span>');
}

function renderPositions() {
  const el = document.getElementById('positionsOut');
  if (!el) return;
  const ids = Object.keys(wallet.pos).filter(function (id) {
    return wallet.pos[id].tokens > 0 && world.byId[id];
  });
  el.innerHTML =
    (ids.length ? ids.map(function (id) {
      const c = world.byId[id], p = wallet.pos[id];
      const val = c.graduated ? p.tokens * (c.gradPrice || price(c)) : quoteSell(c, p.tokens);
      const pnl = val - p.cost;
      return '<button class="row" data-coin="' + id + '">' +
        '<span class="row-av" style="--h:' + c.hue + '">' + c.avatar + '</span>' +
        '<span class="row-mid"><span class="row-t">$' + esc(c.ticker) + '</span>' +
          '<span class="row-n">' + fmtTok(p.tokens) + ' tokens</span></span>' +
        '<span class="row-num"><span class="row-mc">' + fmtSol(val) + ' SOL</span>' +
          '<span class="row-ch ' + (pnl >= 0 ? 'up' : 'down') + '">' + (pnl >= 0 ? '+' : '') + fmtSol(pnl) + '</span></span>' +
      '</button>';
    }).join('') : '<div class="empty">No open positions.</div>') +
    '<div class="card"><div class="trade-grid">' +
      '<div><span class="tl">Cash</span><span class="tv">' + fmtSol(wallet.sol) + ' SOL</span></div>' +
      '<div><span class="tl">Bags</span><span class="tv">' + fmtSol(portfolioValue()) + ' SOL</span></div>' +
      '<div><span class="tl">Realized P&amp;L</span><span class="tv ' + (wallet.realized >= 0 ? 'up' : 'down') + '">' +
        (wallet.realized >= 0 ? '+' : '') + fmtSol(wallet.realized) + '</span></div>' +
      '<div><span class="tl">Creator fees</span><span class="tv">' + fmtSol(wallet.fees) + ' SOL</span></div>' +
    '</div></div>';
}

function remember(type, text) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { list = []; }
  list.unshift({ ts: Date.now(), type: type, text: text });
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 30))); } catch (e) {}
  try {
    if (type === 'sell' || type === 'buy' || type === 'launch') {
      bumpMfStreak(type === 'launch' ? 'launch' : 'trade');
      renderMfLoop();
    }
  } catch (e) {}
  renderLedger();
}

function renderLedger() {
  const el = document.getElementById('creations');
  if (!el) return;
  let list = [];
  try { list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { list = []; }
  el.innerHTML = list.length ? list.map(function (r) {
    return '<div class="log log-' + esc(r.type) + '"><span class="log-t">' +
      new Date(r.ts).toLocaleTimeString() + '</span> ' + esc(r.text) + '</div>';
  }).join('') : '<div class="empty">Nothing yet.</div>';
}

function saveWallet() {
  try {
    localStorage.setItem(WALLET_KEY, JSON.stringify({ sol: wallet.sol, realized: wallet.realized, fees: wallet.fees }));
  } catch (e) {}
}
function loadWallet() {
  try {
    const s = JSON.parse(localStorage.getItem(WALLET_KEY) || 'null');
    if (s && typeof s.sol === 'number' && isFinite(s.sol)) {
      wallet.sol = s.sol; wallet.realized = s.realized || 0; wallet.fees = s.fees || 0;
    }
  } catch (e) {}
  // positions are not persisted — the simulated market is regenerated each session
}

/* ══════════════════════════ 15. MASTER RENDER + EVENTS ══════════════════════════ */


/* ── 5H retention loop (local sim) ───────────────────────── */
function mfDayKey(off){const d=new Date();d.setDate(d.getDate()+(off||0));return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function bumpMfStreak(kind){
  try{
    let st=JSON.parse(localStorage.getItem('mf_streak')||'{}');
    const t0=mfDayKey(0);
    if(st.last!==t0){
      const y=mfDayKey(-1), y2=mfDayKey(-2);
      if(st.last && st.last!==y && st.last===y2 && (st.count||0)>=3){
        const ready=!st.shieldLast||((new Date(t0)-new Date(st.shieldLast))/86400000)>=7;
        if(ready){st.shieldLast=t0;st.last=y;try{legionTrack('streak_freeze',{count:st.count})}catch(e){}}
      }
      st.count=(st.last===y)?(st.count||0)+1:1; st.last=t0;
      localStorage.setItem('mf_streak',JSON.stringify(st));
      try{legionTrack('streak',{count:st.count,kind:kind||'act'})}catch(e){}
    }
    const dk='mf_day_'+t0;
    let day=JSON.parse(localStorage.getItem(dk)||'{"launches":0,"trades":0}');
    if(kind==='launch') day.launches=(day.launches||0)+1;
    if(kind==='trade') day.trades=(day.trades||0)+1;
    localStorage.setItem(dk,JSON.stringify(day));
    return st;
  }catch(e){return {count:0};}
}
function renderMfLoop(){
  try{
    let el=document.getElementById('mfLoop');
    if(!el){
      el=document.createElement('div'); el.id='mfLoop';
      el.style.cssText='margin:8px 12px;padding:10px;border:1px solid #2a2438;border-radius:12px;font-size:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#12101a';
      const host=document.querySelector('header')||document.querySelector('.top')||document.body.firstElementChild||document.body;
      host.insertAdjacentElement('afterend', el);
    }
    const st=JSON.parse(localStorage.getItem('mf_streak')||'{}');
    const day=JSON.parse(localStorage.getItem('mf_day_'+mfDayKey(0))||'{}');
    const end=new Date(); end.setHours(24,0,0,0);
    const ms=Math.max(0,end-Date.now());
    const clock=Math.floor(ms/3600000)+'h '+Math.floor((ms%3600000)/60000)+'m';
    const mine=(world&&world.coins)?world.coins.filter(function(c){return c.isPlayer;}).length:0;
    el.innerHTML='<span>🔥 '+(st.count||0)+'d</span><span>today launch '+(day.launches||0)+'</span><span>trade '+(day.trades||0)+'</span><span>my coins '+mine+'</span><span>reset '+clock+'</span>'
      +'<button type="button" id="mfShare" style="margin-left:auto;padding:6px 10px;border:0;border-radius:8px;background:#1c1826;color:#ece8f1">share board</button>'
      +'<span style="opacity:.65;font-size:11px">fictional sim · no real tokens</span>';
    const b=document.getElementById('mfShare');
    if(b) b.onclick=function(){
      const text='MemeForge sim · 🔥'+(st.count||0)+'d · launches '+(day.launches||0)+' · https://hosuman08-netizen.github.io/memeforge-sim/\nFICTIONAL ONLY';
      if(navigator.share) navigator.share({text}).catch(function(){});
      else if(navigator.clipboard) navigator.clipboard.writeText(text);
      try{legionTrack('share_peak',{})}catch(e){}
    };
  }catch(e){}
}

function render() {
  renderWalletChip();
  try{renderMfLoop();}catch(e){}
  if (ui.view === 'board') renderBoard();
  else if (ui.view === 'token') renderToken();
  else if (ui.view === 'you') { renderPositions(); renderLedger(); }
  else if (ui.view === 'create') renderCreate();
  else if (ui.view === 'devbuy') renderDevBuy();
}

function wire() {
  document.addEventListener('click', function (ev) {
    const t = ev.target && ev.target.closest
      ? ev.target.closest('[data-coin],[data-tab],[data-av],[data-venue],[data-amt],[data-dev],[data-nav],button')
      : null;
    if (!t) return;
    const d = t.dataset || {};

    if (t.id === 'gradClose') { closeGradCelebration(); return; }
    if (d.coin) { closeGradCelebration(); go('token', d.coin); return; }
    if (d.nav)  { go(d.nav); return; }

    if (d.tab) {
      const nav = t.parentElement;
      if (nav) {
        for (let i = 0; i < nav.children.length; i++) nav.children[i].classList.remove('on');
        t.classList.add('on');
        if (nav.id === 'boardTabs') ui.boardTab = d.tab; else ui.tokenTab = d.tab;
      }
      render(); return;
    }
    if (d.av)    { ui.draft.avatar = d.av; renderCreate(); return; }
    if (d.venue) { ui.draft.venue = d.venue; renderCreate(); return; }
    if (d.amt)   { ui.exec.amount = Number(d.amt); renderToken(); return; }
    if (d.dev != null && d.dev !== '') {
      const de = document.getElementById('devAmt');
      if (de) de.value = d.dev;
      updateDevQuote(); return;
    }

    switch (t.id) {
      case 'brandBtn':     go('board'); break;
      case 'walletChip':   go('you'); break;
      case 'createBtn':    go('create'); break;
      case 'submitCreate': submitCreate(); break;
      case 'devBuyGo':     doDevBuy(Number((document.getElementById('devAmt') || {}).value) || 0); break;
      case 'devSkip':      doDevBuy(0); break;
      case 'buyBtn':       submitBuy(); break;
      case 'sell50':       submitSell(0.5); break;
      case 'sell100':      submitSell(1); break;
      case 'cmGo':         postComment(); break;
      case 'goLive':       goLive(); break;
      case 'shareBtn':     shareCoin(); break;
      case 'claimFees':    claimFees(); break;
    }
  });

  document.addEventListener('change', function (ev) {
    const id = ev.target && ev.target.id;
    if (id === 'amtIn')  { ui.exec.amount = Math.max(0, Number(ev.target.value) || 0); renderToken(); }
    if (id === 'slipIn') { ui.exec.slippage = Number(ev.target.value); }
    if (id === 'prioIn') { ui.exec.priority = Number(ev.target.value); }
    if (id === 'devAmt') updateDevQuote();
  });
  document.addEventListener('input', function (ev) {
    if (ev.target && ev.target.id === 'devAmt') updateDevQuote();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && ev.target && ev.target.id === 'cmIn') { ev.preventDefault(); postComment(); }
  });
}

/* You never arrive at a launchpad at t=0. A real board is always mid-session:
   a reigning king, a few past graduates, and a long tail of coins dying quietly.
   Seeding reproduces that. It does not touch the graduation rate for anything
   that launches from here on — every coin spawned during play rolls its own fate. */
function ageCoin(c, ticks) {
  for (let k = 0; k < ticks; k++) {
    simCoinTick(c); scoreMomentum(c);
    c.hist.push(price(c));
    if (c.hist.length > 200) c.hist.shift();
  }
}

function seedBoard() {
  world.seeding = true;
  const g = function (c) { return VENUES[c.venue].gradSol; };

  // two coins that already made it — the Graduated board is never empty
  for (let i = 0; i < 2; i++) {
    const c = spawnSimCoin();
    c.fate = 'graduate'; c.peakTarget = g(c) * 1.15; c.life = 220;
    ageCoin(c, 80);
    c.createdAt = Date.now() - (240000 + Math.random() * 600000);
  }
  // three deep in the funnel — one of them will be wearing the crown
  for (let i = 0; i < 3; i++) {
    const c = spawnSimCoin();
    c.fate = 'koth'; c.peakTarget = g(c) * (0.58 + Math.random() * 0.3); c.life = 240;
    ageCoin(c, Math.floor(60 + Math.random() * 20));
    c.createdAt = Date.now() - (60000 + Math.random() * 240000);
  }
  // the long tail: mostly coins on their way to nothing
  for (let i = 0; i < 18; i++) {
    const c = spawnSimCoin();
    ageCoin(c, Math.floor(Math.random() * c.life * 0.5));
    c.createdAt = Date.now() - Math.random() * 300000;
  }
  // crown the king immediately so the hero slot is filled on first paint
  const eligible = world.coins.filter(function (c) {
    return !c.graduated && c.revealed && mcapUsd(c) >= KOTH_MCAP_USD;
  }).sort(function (a, b) { return b.momentum - a.momentum; });
  if (eligible[0]) {
    world.kingId = eligible[0].id;
    world.crownedAt = Date.now();
    eligible[0].everKoth = true;
    eligible[0].kothAt = Date.now();
  }
  world.seeding = false;
}

function init() {
  loadWallet();
  wire();
  seedBoard();
  renderLedger();
  go('board');
  if (world.timer) clearInterval(world.timer);
  world.timer = setInterval(worldTick, SIM.TICK_MS);
  if (navigator.serviceWorker) { try { navigator.serviceWorker.register('sw.js'); } catch (e) {} }
}

window.onload = init;

/* LEGION_WAVE_10_wave_stamp */ /* ship wave 10 2026-07-21T07:41:56 */
