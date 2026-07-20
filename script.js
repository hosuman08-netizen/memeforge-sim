// MemeForge — forge a meme into a coin, ride its bonding curve.
// Fictional simulation only. No real money, tokens, or blockchain.
const HISTORY_KEY = 'memeforge.history';
let hype = 50;

// Decorative eye state — gives the golden hype eye real motion to react to.
const _eye = { pulse: 0.5 };
const _mood = { energy: 0.5 };

// Nudge the eye and return a surprise value (0..1) that drives hype gains.
function pulseSurprise(intensity = 0.75) {
  _eye.pulse = (_eye.pulse + intensity * 0.6) % 6.28;
  _mood.energy = Math.min(1, 0.35 + intensity * 0.5);
  const c = document.getElementById('meme-hype-canvas');
  if (c && window.hypeEye) {
    const ctx = c.getContext('2d');
    window.hypeEye(ctx, c.width, c.height / 2, _eye, intensity, _mood, 0.2);
  }
  const s = (typeof _eye.lastSurprise === 'number') ? _eye.lastSurprise : 0.6;
  return Math.max(0.15, s); // floor so hype always visibly moves
}

function updateFomo() {
  const el = document.getElementById('fomo');
  el.textContent = 'Meme Drop windows: Dawn / Eclipse active • limited slots';
}

function recordMemeVoice() {
  const out = document.getElementById('voiceOut');
  const s = pulseSurprise(0.75);
  const gain = Math.round(s * 30);
  hype = Math.min(100, hype + gain);
  out.innerHTML = `<div class="card">Hype voice recorded. Hype +${gain} (surprise ${s.toFixed(2)})</div>`;
  drawMemeHype(s);
  recordToHistory('voice', `Hype voice recorded (resonance ${s.toFixed(2)})`);
}

// ---- The live coin the user is forging. Real identity, real curve state. ----
let coin = null;          // { name, ticker, reserve, sold, holders, trades, launched, peakPrice }
let curveTimer = null;

// ---- The player's wallet + the live market that trades against them. ----
// Fictional balances only. Starting cash = one meme's worth of buy pressure.
const START_CASH = 2.5;                    // fictional reserve units to trade with
let wallet = null;   // { cash, bag, costBasis }  (bag = tokens held, costBasis = reserve spent)
let market = null;   // { timer, momentum, ticks, tone } — autonomous apes/whales/dumpers
const BUY_SIZE = 0.35;                      // reserve spent per "Ape in"

// Constant-product bonding curve (Uniswap-style x*y=k), the memecoin launch primitive.
// price = reserve / (SUPPLY_TOTAL - tokensSold). Every buy pulls tokens out → price climbs.
const SUPPLY_TOTAL = 1_000_000_000;      // 1B fixed supply (fictional)
const VIRTUAL_RESERVE = 3;               // virtual reserve seed → smooth early curve
const K = VIRTUAL_RESERVE * SUPPLY_TOTAL; // x*y=k invariant

function makeCoin(name, ticker) {
  return {
    name, ticker,
    reserve: VIRTUAL_RESERVE,   // reserve in the curve
    sold: 0,                    // tokens bought out of the curve
    holders: 0,
    trades: 0,
    launched: Date.now(),
    peakPrice: 0
  };
}
// Price = current cost of the next token = reserve / remaining supply.
function coinPrice(c) { return c.reserve / (SUPPLY_TOTAL - c.sold); }
function coinMcap(c)  { return coinPrice(c) * SUPPLY_TOTAL; }

// Execute one buy of `amt` into the curve. Returns tokens received (curve math).
function curveBuy(c, amt) {
  const remaining = SUPPLY_TOTAL - c.sold;
  const newReserve = c.reserve + amt;
  const newRemaining = K / newReserve;   // x*y=k: tokens the buyer receives
  const tokensOut = Math.max(0, remaining - newRemaining);
  c.reserve = newReserve;
  c.sold += tokensOut;
  c.trades += 1;
  const p = coinPrice(c);
  if (p > c.peakPrice) c.peakPrice = p;
  return tokensOut;
}

// Execute one SELL of `tokens` back into the curve. Returns reserve returned.
// Selling puts tokens back into the pool → remaining supply grows → price falls.
// This is the other half of a real bonding curve; buys alone can never crash.
function curveSell(c, tokens) {
  if (tokens <= 0) return 0;
  const remaining = SUPPLY_TOTAL - c.sold;
  const newRemaining = remaining + tokens;      // tokens flow back in
  const newReserve = K / newRemaining;          // x*y=k: reserve the seller gets out
  const reserveOut = Math.max(0, c.reserve - newReserve);
  c.reserve = newReserve;
  c.sold = Math.max(0, c.sold - tokens);
  c.trades += 1;
  return reserveOut;
}

function fmtEth(n)  { return n < 0.001 ? n.toExponential(2) : n.toFixed(4); }
function fmtUsd(n)  {
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}
const DISPLAY_RATE = 3400; // fictional reserve→USD display rate

function launchMeme() {
  const nameEl = document.getElementById('coinName');
  const tickEl = document.getElementById('coinTicker');
  const name = (nameEl.value || '').trim();
  let ticker = (tickEl.value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!name) { alert('Name your coin first — speak it into being.'); nameEl.focus(); return; }
  if (!ticker) ticker = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase() || 'MEME';
  if (curveTimer) { clearInterval(curveTimer); curveTimer = null; }
  if (market && market.timer) { clearInterval(market.timer); market.timer = null; }
  const tsec = document.getElementById('trade'); if (tsec) tsec.hidden = true;

  coin = makeCoin(name, ticker);
  const fee = Math.floor(10 * (1 + (100 - hype) / 100));
  recordToHistory('launch', `$${ticker} "${name}" launched on curve • hype ${hype | 0} • launch fee ${fee}`);
  runLaunchCurve();
}

// The launch: hype becomes buy pressure that walks the coin up its curve, tick by tick.
function runLaunchCurve() {
  const out = document.getElementById('launchOut');
  let tick = 0;
  const total = 42;                         // ~4.2s of live launch
  const openPrice = coinPrice(coin);
  // Higher hype → bigger + more frequent buys walking up the curve.
  const pressure = 0.15 + (hype / 100) * 0.85;

  curveTimer = setInterval(() => {
    tick++;
    // variable buy flow: some ticks are whales, most are small — real market texture
    const whale = Math.random() < 0.12 * pressure;
    const amt = (whale ? 0.4 + Math.random() * 0.8 : 0.01 + Math.random() * 0.12) * pressure;
    const tokens = curveBuy(coin, amt);
    if (tokens > 0 && Math.random() < 0.6 + pressure * 0.3) coin.holders++;

    const price = coinPrice(coin);
    const mcap = coinMcap(coin);
    const mult = price / openPrice;
    // feed the curve into the hero canvas as the live hype bar
    hype = Math.min(100, 20 + Math.log10(1 + mult) * 55);
    drawCurve(openPrice, price, tick / total, whale);

    out.innerHTML =
      `<div class="card curve-live">` +
        `<div class="curve-row"><b>$${coin.ticker}</b> <span class="curve-mult">${mult.toFixed(2)}×</span></div>` +
        `<div class="drop-meta">price ${fmtEth(price)} · mcap ${fmtUsd(mcap * DISPLAY_RATE)} · ${coin.holders} holders · ${coin.trades} trades` +
        `${whale ? ' · <span class="whale">🐋 whale buy</span>' : ''}</div>` +
      `</div>`;

    if (tick >= total) {
      clearInterval(curveTimer); curveTimer = null;
      const finalMcap = coinMcap(coin);
      const finalMult = coinPrice(coin) / openPrice;
      coin.launched = Date.now();
      recordToHistory('curve', `$${coin.ticker} closed launch at ${finalMult.toFixed(2)}× · mcap ${fmtUsd(finalMcap * DISPLAY_RATE)}`);
      out.innerHTML =
        `<div class="card curve-live done">` +
          `<div class="curve-row"><b>$${coin.ticker}</b> launched · <span class="curve-mult">${finalMult.toFixed(2)}×</span></div>` +
          `<div class="drop-meta">final mcap ${fmtUsd(finalMcap * DISPLAY_RATE)} · ${coin.holders} holders · now live. Trade your bag below.</div>` +
        `</div>`;
      openTrading();
    }
  }, 100);
  hype = Math.max(20, hype - 8);
}

// ---- LIVE TRADING: the coin keeps moving; the user rides or gets rekt. ----
// A running market of apes, whales and paper-hands buys and sells against the
// same curve the user trades on. Buys lift price, sells crash it — real depth.
function openTrading() {
  wallet = { cash: START_CASH, bag: 0, costBasis: 0 };
  market = { momentum: 0.6, ticks: 0, tone: 'warming up' };
  resetLive();
  const sec = document.getElementById('trade');
  if (sec) sec.hidden = false;
  renderTrade('Coin is live. Ape in before the next green candle — or wait for a dip.');
  drawLive(false);
  if (market.timer) clearInterval(market.timer);
  market.timer = setInterval(marketTick, 600);
}

// One autonomous market beat: momentum drifts, then apes buy or paper-hands dump.
function marketTick() {
  if (!coin || !market) return;
  market.ticks++;
  // momentum is a mean-reverting random walk → pumps and dumps both happen
  market.momentum += (Math.random() - 0.5) * 0.5;
  market.momentum = Math.max(-1, Math.min(1, market.momentum * 0.9));
  const m = market.momentum;

  let event = '';
  if (Math.random() < 0.10) {
    // whale event — big one-sided move, the moment that makes or breaks a bag
    if (m >= 0) { curveBuy(coin, 0.5 + Math.random() * 1.0); coin.holders++; event = '🐋 whale bought'; market.tone = 'pumping'; }
    else        { curveSell(coin, (SUPPLY_TOTAL - coin.sold) * (0.06 + Math.random() * 0.10)); event = '🩸 whale dumped'; market.tone = 'dumping'; }
  } else if (m > 0.1) {
    curveBuy(coin, 0.02 + Math.random() * 0.10 * m);
    if (Math.random() < 0.5) coin.holders++;
    market.tone = 'climbing';
  } else if (m < -0.1) {
    curveSell(coin, (SUPPLY_TOTAL - coin.sold) * (0.01 + Math.random() * 0.05 * -m));
    market.tone = 'paper-handing';
  } else {
    market.tone = 'chopping sideways';
  }
  renderTrade(event);
  drawLive(event.includes('🐋') || event.includes('🩸'));
}

// Live price ribbon: a rolling, auto-scaled chart of the REAL price, with the
// user's average entry drawn as a line so profit/loss is visible at a glance.
const _liveP = [];
function drawLive(spike) {
  const c = document.getElementById('meme-hype-canvas');
  if (!c || !coin) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height, pad = 18;
  _liveP.push(coinPrice(coin));
  if (_liveP.length > 160) _liveP.shift();

  // break-even reference line, drawn only while holding a bag
  const refs = (wallet && wallet.bag > 0 && wallet.costBasis > 0)
    ? [priceForBasis()] : [];

  let lo = Math.min(..._liveP), hi = Math.max(..._liveP, ...refs.filter(Boolean));
  if (refs[0]) lo = Math.min(lo, refs[0]);
  const span = (hi - lo) || hi || 1e-9;
  const yOf = v => (H - pad) - ((v - lo) / span) * (H - pad * 2);
  const n = _liveP.length;
  const xOf = i => pad + (i / Math.max(1, n - 1)) * (W - pad * 2);

  ctx.clearRect(0, 0, W, H);

  // entry reference line (where the user broke even)
  if (refs[0]) {
    const ey = yOf(refs[0]);
    ctx.strokeStyle = 'rgba(233,220,192,0.28)';
    ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, ey); ctx.lineTo(W - pad, ey); ctx.stroke();
    ctx.setLineDash([]);
  }

  // trend colour: green if last price above entry (or rising), red if below/falling
  const up = _liveP[n - 1] >= (refs[0] || _liveP[0]);
  const stroke = up ? '#7ad19b' : '#e0736f';

  // area fill
  const grad = ctx.createLinearGradient(0, pad, 0, H - pad);
  grad.addColorStop(0, up ? 'rgba(122,209,155,0.25)' : 'rgba(224,115,111,0.22)');
  grad.addColorStop(1, 'rgba(16,12,8,0.02)');
  ctx.beginPath(); ctx.moveTo(pad, H - pad);
  for (let i = 0; i < n; i++) ctx.lineTo(xOf(i), yOf(_liveP[i]));
  ctx.lineTo(xOf(n - 1), H - pad); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // line
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const x = xOf(i), y = yOf(_liveP[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.strokeStyle = stroke; ctx.lineWidth = 2;
  ctx.shadowBlur = spike ? 12 : 6; ctx.shadowColor = stroke;
  ctx.stroke(); ctx.shadowBlur = 0;

  // leading dot
  ctx.fillStyle = stroke;
  ctx.beginPath(); ctx.arc(xOf(n - 1), yOf(_liveP[n - 1]), spike ? 5 : 3, 0, Math.PI * 2); ctx.fill();
}

// Reset the live chart window when a new coin's trading opens.
function resetLive() { _liveP.length = 0; }

// Price at which the user's holdings break even (cost basis per remaining supply).
function priceForBasis() {
  if (!wallet || wallet.bag <= 0) return 0;
  // reserve that yields the user's cost basis on sell → break-even price
  const remaining = SUPPLY_TOTAL - coin.sold;
  const targetReserve = coin.reserve - wallet.costBasis;
  return targetReserve > 0 ? targetReserve / remaining : coinPrice(coin) * 0.5;
}

function bagValue() { return wallet.bag > 0 ? curveQuoteSell(coin, wallet.bag) : 0; }
// What the user would get if they sold `tokens` right now (peek, no state change).
function curveQuoteSell(c, tokens) {
  const remaining = SUPPLY_TOTAL - c.sold;
  const newReserve = K / (remaining + tokens);
  return Math.max(0, c.reserve - newReserve);
}

function tradeBuy() {
  if (!coin || !wallet) return;
  if (wallet.cash < 0.01) { flashTrade('Out of cash. Sell your bag to recycle it.'); return; }
  const spend = Math.min(BUY_SIZE, wallet.cash);
  const tokens = curveBuy(coin, spend);
  coin.holders = Math.max(coin.holders, 1);
  wallet.cash -= spend;
  wallet.bag += tokens;
  wallet.costBasis += spend;
  renderTrade('Aped in. Your buy pushed the price up — now the market decides.');
  drawLive(true);
}

function tradeSell() {
  if (!coin || !wallet) return;
  if (wallet.bag <= 0) { flashTrade('Empty bag. Ape in first.'); return; }
  const got = curveSell(coin, wallet.bag);
  const pnl = got - wallet.costBasis;
  wallet.cash += got;
  const sold = wallet.bag;
  wallet.bag = 0; wallet.costBasis = 0;
  const sign = pnl >= 0 ? '+' : '';
  recordToHistory('sell', `Sold $${coin.ticker} bag for ${fmtEth(got)} · P&L ${sign}${fmtEth(pnl)}`);
  renderTrade(`${pnl >= 0 ? '🟢 Secured the bag' : '🔴 Sold at a loss'}: ${sign}${fmtEth(pnl)} reserve. Sells drag the curve down.`);
  drawLive(true);
}

let _tradeFlash = '';
function flashTrade(msg) { _tradeFlash = msg; renderTrade(); setTimeout(() => { _tradeFlash = ''; }, 1600); }

function renderTrade(note) {
  const el = document.getElementById('tradePanel');
  if (!el || !coin || !wallet) return;
  const price = coinPrice(coin);
  const val = bagValue();
  const equity = wallet.cash + val;
  const pnlOpen = wallet.bag > 0 ? val - wallet.costBasis : 0;
  const pnlSign = pnlOpen >= 0 ? '+' : '';
  const toneClass = /pump|climb|whale bought/.test(market ? market.tone : '') ? 'up'
                  : /dump|paper|🩸/.test(market ? market.tone : '') ? 'down' : '';
  const line = note || _tradeFlash || '';
  el.innerHTML =
    `<div class="card trade-card">` +
      `<div class="trade-top"><b>$${coin.ticker}</b> <span class="trade-price">${fmtEth(price)}</span> ` +
        `<span class="trade-tone ${toneClass}">${market ? market.tone : ''}</span></div>` +
      `<div class="trade-grid">` +
        `<div><span class="tl">Cash</span><span class="tv">${fmtEth(wallet.cash)}</span></div>` +
        `<div><span class="tl">Bag value</span><span class="tv">${fmtEth(val)}</span></div>` +
        `<div><span class="tl">Open P&L</span><span class="tv ${pnlOpen >= 0 ? 'up' : 'down'}">${wallet.bag > 0 ? pnlSign + fmtEth(pnlOpen) : '—'}</span></div>` +
        `<div><span class="tl">Equity</span><span class="tv">${fmtEth(equity)}</span></div>` +
      `</div>` +
      (line ? `<div class="trade-note">${line}</div>` : '') +
    `</div>`;
}

// Real drop inventory — displayed slot counts are read from THIS state (code == display).
const DROP_KEY = 'memeforge.drops';
const DROPS = (() => {
  const def = {
    dawn:    { label: 'Dawn Drop',    icon: '\u{1F305}', slots: 9, cap: 9,  boost: 1.0 },
    eclipse: { label: 'Eclipse Drop', icon: '\u{1F311}', slots: 2, cap: 2,  boost: 1.4 }
  };
  try {
    const saved = JSON.parse(localStorage.getItem(DROP_KEY) || 'null');
    if (saved && saved.dawn && saved.eclipse) return saved;
  } catch (e) {}
  return def;
})();
function saveDrops() {
  try { localStorage.setItem(DROP_KEY, JSON.stringify(DROPS)); } catch (e) {}
}

function showDrops() {
  const el = document.getElementById('dropList');
  el.innerHTML = Object.keys(DROPS).map(win => {
    const d = DROPS[win];
    const full = d.slots <= 0;
    const odd = (100 / d.cap).toFixed(1); // honest: 1 winning slot out of cap
    return `<div class="card drop${full ? ' full' : ''}">
      <span class="drop-name">${d.icon} ${d.label}</span>
      <span class="drop-meta">${d.slots}/${d.cap} slots · x${d.boost} · ${odd}% per slot</span>
      <button ${full ? 'disabled' : ''} onclick="joinDrop('${win}')">${full ? 'Full' : 'Join + Voice'}</button>
    </div>`;
  }).join('');
}

function joinDrop(win) {
  if ((DROPS[win] ? DROPS[win].slots : 0) <= 0) { alert('Drop full. No slots left.'); return; }
  DROPS[win].slots -= 1;
  saveDrops();
  const s = pulseSurprise(0.8);
  const boost = win === 'eclipse' ? 1.4 : 1;
  hype = Math.min(100, hype + Math.round(s * 25 * boost));
  recordToHistory('drop', `Joined ${DROPS[win].label} • hype boost x${boost}`);
  drawMemeHype(s);
  showDrops();
  alert(`Joined ${DROPS[win].label}. ${DROPS[win].slots} slots left.`);
}

function drawMemeHype(s = 0.7) {
  const c = document.getElementById('meme-hype-canvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  // Track
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(20, H / 2 - 9, W - 40, 18);
  // Hype fill — accent gradient, the one bold moment
  const fillW = ((hype / 100) * (W - 40));
  const grad = ctx.createLinearGradient(20, 0, 20 + (W - 40), 0);
  grad.addColorStop(0, '#7c5cff');
  grad.addColorStop(1, '#c9a34a');
  ctx.fillStyle = grad;
  ctx.fillRect(20, H / 2 - 9, fillW, 18);
  // Golden surprise eye renders over the bar
  if (window.hypeEye) {
    window.hypeEye(ctx, W, H / 2, _eye, s, _mood, 0.15);
  }
}

// Live bonding-curve chart: plots the price path (log-scaled) climbing as buys fill in.
const _curvePts = [];
function drawCurve(open, price, progress, whale) {
  const c = document.getElementById('meme-hype-canvas');
  if (!c || !coin) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  const pad = 18;
  if (progress <= 0.03) _curvePts.length = 0;
  _curvePts.push(Math.log10(price / open + 0.0001) + 0.001);
  if (_curvePts.length > 240) _curvePts.shift();

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(pad, H - pad, W - pad * 2, 1.5);

  const maxV = Math.max(0.05, ..._curvePts);
  const n = _curvePts.length;
  // area fill under the curve
  const grad = ctx.createLinearGradient(0, pad, 0, H - pad);
  grad.addColorStop(0, 'rgba(201,163,74,0.35)');
  grad.addColorStop(1, 'rgba(124,92,255,0.02)');
  ctx.beginPath();
  ctx.moveTo(pad, H - pad);
  for (let i = 0; i < n; i++) {
    const x = pad + (i / Math.max(1, n - 1)) * (W - pad * 2);
    const y = (H - pad) - (_curvePts[i] / maxV) * (H - pad * 2);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(pad + (W - pad * 2), H - pad);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // the curve line itself
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = pad + (i / Math.max(1, n - 1)) * (W - pad * 2);
    const y = (H - pad) - (_curvePts[i] / maxV) * (H - pad * 2);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#c9a34a';
  ctx.lineWidth = 2;
  ctx.shadowBlur = 8; ctx.shadowColor = 'rgba(201,163,74,0.5)';
  ctx.stroke();
  ctx.shadowBlur = 0;

  // leading dot (current price)
  const lx = pad + (W - pad * 2);
  const ly = (H - pad) - (_curvePts[n - 1] / maxV) * (H - pad * 2);
  ctx.fillStyle = whale ? '#7c5cff' : '#e9dcc0';
  ctx.beginPath();
  ctx.arc(lx, ly, whale ? 5 : 3, 0, Math.PI * 2);
  ctx.fill();

  // golden surprise eye still watches, driven by launch momentum
  if (window.hypeEye) {
    const s = Math.min(1, (price / open - 1) * 0.15 + (whale ? 0.4 : 0.1));
    window.hypeEye(ctx, W, H * 0.42, _eye, s, _mood, whale ? 0.3 : 0.1);
  }
}

function recordToHistory(type, text) {
  let list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  list.unshift({ ts: Date.now(), type, text, power: hype | 0 });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 15)));
  showCreations();
}

function showCreations() {
  const el = document.getElementById('creations');
  const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  el.innerHTML = list.map((r, i) =>
    `<div class="card" onclick="boostEntry(${i})">${new Date(r.ts).toLocaleTimeString()} ${r.text} · Hype ${r.power}</div>`
  ).join('');
}

function boostEntry(i) {
  let list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  if (list[i]) {
    list[i].power += 12;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    drawMemeHype(0.95);
    showCreations();
  }
}

// Virality: share the user's ACTUAL coin — name, ticker, real curve result seed more buys.
function shareMemeFate() {
  if (!coin || !coin.trades) { alert('Launch a coin first, then share its run.'); return; }
  const mcap = fmtUsd(coinMcap(coin) * DISPLAY_RATE);
  const story =
    `$${coin.ticker} "${coin.name}" is live on the bonding curve.\n` +
    `mcap ${mcap} · ${coin.holders} holders · ${coin.trades} trades. Ape in before the curve steepens.\n` +
    `#MemeForge #${coin.ticker} · fictional, 18+`;

  const done = () => alert(`Copied $${coin.ticker} share card. Each share seeds new curve buys.`);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(story).then(done).catch(done);
  } else { done(); }

  // Sharing feeds buy pressure back into the live curve (referral seed → more holders).
  if (!curveTimer) {
    const seed = 0.05 + Math.random() * 0.15;
    curveBuy(coin, seed);
    coin.holders += 1 + Math.floor(Math.random() * 3);
    drawCurve(coinPrice(coin) / 1.02, coinPrice(coin), 0.99, true);
  }

  recordToHistory('share', `Shared $${coin.ticker} · ${mcap} · seeded curve`);
}

function init() {
  updateFomo(); showDrops(); showCreations(); drawMemeHype(0.6);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
}
window.onload = init;
