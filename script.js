// p18 MemeForge on Base - p6 voice + FOMO drops + p17 export + relics
const CODEX_KEY = 'memeCodex';
let hype = 50;

// Persistent lung state so the p6 Surprise Eye has real breath to react to.
// getP6LungSurprise() reads 'p6_lungFragment'; we own it here so surprise is genuine.
const _lung = (() => {
  try { return JSON.parse(localStorage.getItem('p6_lungFragment') || '{}'); }
  catch (e) { return {}; }
})();
if (typeof _lung.breath !== 'number') _lung.breath = 0.5;
const _spore = { wound: 0.5 };

// Compute a real surprise (0..1) by breathing the lung and asking the p6 eye engine.
// The eye renders itself into the canvas with the correct 6-arg signature.
function pulseSurprise(intensity = 0.75) {
  _lung.breath = (_lung.breath + intensity * 0.6) % 6.28;
  _spore.wound = Math.min(1, 0.35 + intensity * 0.5);
  const c = document.getElementById('meme-hype-canvas');
  if (c && window.p6LungSurpriseEye) {
    const ctx = c.getContext('2d');
    // draws the golden eye AND mutates _lung.breath / _lung.lastSurprise
    window.p6LungSurpriseEye(ctx, c.width, c.height / 2, _lung, intensity, _spore, 0.2);
  }
  try { localStorage.setItem('p6_lungFragment', JSON.stringify(_lung)); } catch (e) {}
  const s = (typeof _lung.lastSurprise === 'number') ? _lung.lastSurprise
          : (window.getP6LungSurprise ? window.getP6LungSurprise() : 0.6);
  return Math.max(0.15, s); // floor so hype always visibly moves
}

function updateFomo() {
  const el = document.getElementById('fomo');
  el.textContent = 'Meme Drop windows: Dawn/Eclipse/Midnight active • limited slots';
}

function recordMemeVoice() {
  const out = document.getElementById('voiceOut');
  const s = pulseSurprise(0.75);
  const gain = Math.round(s * 30);
  hype = Math.min(100, hype + gain);
  out.innerHTML = `<div class="card">Voice recorded. Hype +${gain} (surprise ${s.toFixed(2)})</div>`;
  drawMemeHype(s);
  recordToCodex('voice', `Soul birthed (resonance ${s.toFixed(2)})`);
}

// ---- The live coin the user is forging. Real identity, real curve state. ----
let coin = null;          // { name, ticker, supply, reserve, price, mcap, holders, launched }
let curveTimer = null;

// Constant-product bonding curve (Uniswap-style x*y=k), the real memecoin launch primitive.
// price = reserve / (SUPPLY_TOTAL - tokensSold). Every buy pulls tokens out → price climbs the curve.
const SUPPLY_TOTAL = 1_000_000_000;      // 1B fixed supply
const VIRTUAL_RESERVE = 3;               // virtual ETH seed → smooth early curve
const K = VIRTUAL_RESERVE * SUPPLY_TOTAL; // x*y=k invariant

function makeCoin(name, ticker) {
  return {
    name, ticker,
    reserve: VIRTUAL_RESERVE,   // ETH in the curve
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

// Execute one real buy of `eth` into the curve. Returns tokens received (curve math).
function curveBuy(c, eth) {
  const remaining = SUPPLY_TOTAL - c.sold;
  const newReserve = c.reserve + eth;
  // x*y=k: tokens the buyer receives so the invariant holds
  const newRemaining = K / newReserve;
  const tokensOut = Math.max(0, remaining - newRemaining);
  c.reserve = newReserve;
  c.sold += tokensOut;
  c.trades += 1;
  const p = coinPrice(c);
  if (p > c.peakPrice) c.peakPrice = p;
  return tokensOut;
}

function fmtEth(n)  { return n < 0.001 ? n.toExponential(2) : n.toFixed(4); }
function fmtUsd(n)  {
  if (n >= 1e6) return '$' + (n/1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n/1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}
const ETH_USD = 3400; // fictional display rate

function launchMeme() {
  const nameEl = document.getElementById('coinName');
  const tickEl = document.getElementById('coinTicker');
  const name = (nameEl.value || '').trim();
  let ticker = (tickEl.value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!name) { alert('Name your coin first — speak it into being.'); nameEl.focus(); return; }
  if (!ticker) ticker = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase() || 'MEME';
  if (curveTimer) { clearInterval(curveTimer); curveTimer = null; }

  coin = makeCoin(name, ticker);
  const fee = Math.floor(10 * (1 + (100 - hype) / 100));
  recordToCodex('launch', `$${ticker} "${name}" launched on curve • hype ${hype|0} • p10 fee ${fee}`);
  runLaunchCurve();
}

// The real launch: hype becomes buy pressure that walks the coin up its bonding curve, tick by tick.
function runLaunchCurve() {
  const out = document.getElementById('launchOut');
  let tick = 0;
  const total = 42;                         // ~4.2s of live launch
  const openPrice = coinPrice(coin);
  // Higher hype → bigger + more frequent buys walking up the curve.
  const pressure = 0.15 + (hype / 100) * 0.85;

  curveTimer = setInterval(() => {
    tick++;
    // variable-ratio buy flow: some ticks are whales, most are small — real market texture
    const whale = Math.random() < 0.12 * pressure;
    const eth = (whale ? 0.4 + Math.random() * 0.8 : 0.01 + Math.random() * 0.12) * pressure;
    const tokens = curveBuy(coin, eth);
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
        `<div class="drop-meta">price ${fmtEth(price)} ETH · mcap ${fmtUsd(mcap * ETH_USD)} · ${coin.holders} holders · ${coin.trades} trades` +
        `${whale ? ' · <span class="whale">🐋 whale buy</span>' : ''}</div>` +
      `</div>`;

    if (tick >= total) {
      clearInterval(curveTimer); curveTimer = null;
      const finalMcap = coinMcap(coin);
      const finalMult = coinPrice(coin) / openPrice;
      coin.launched = Date.now();
      recordToCodex('curve', `$${coin.ticker} closed launch at ${finalMult.toFixed(2)}× · mcap ${fmtUsd(finalMcap * ETH_USD)}`);
      exportToP17(coin);
      out.innerHTML =
        `<div class="card curve-live done">` +
          `<div class="curve-row"><b>$${coin.ticker}</b> launched · <span class="curve-mult">${finalMult.toFixed(2)}×</span></div>` +
          `<div class="drop-meta">final mcap ${fmtUsd(finalMcap * ETH_USD)} · ${coin.holders} holders · exported to p17. Share it to seed more buys.</div>` +
        `</div>`;
    }
  }, 100);
  hype = Math.max(20, hype - 8);
}

function exportToP17(c) {
  const p17Codex = JSON.parse(localStorage.getItem('walletCodex') || '[]');
  p17Codex.unshift({
    ts: Date.now(), type: 'p18-meme', text: `$${c.ticker} ${c.name}`,
    power: Math.round(coinMcap(c) * ETH_USD / 1000), level: 2,
    ticker: c.ticker, mcap: coinMcap(c) * ETH_USD, holders: c.holders
  });
  localStorage.setItem('walletCodex', JSON.stringify(p17Codex));
  recordToCodex('export', `Exported $${c.ticker} to p17 wallet`);
}

// Real drop inventory — displayed slot counts are read from THIS state (code==display shield).
const DROP_KEY = 'memeDrops';
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
  recordToCodex('drop', `Joined ${DROPS[win].label} • hype boost x${boost}`);
  drawMemeHype(s);
  showDrops();
  alert(`Joined ${DROPS[win].label}. ${DROPS[win].slots} slots left.`);
}

function drawMemeHype(s=0.7) {
  const c = document.getElementById('meme-hype-canvas');
  if(!c) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0,0,W,H);
  // Track
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(20, H/2 - 9, W - 40, 18);
  // Hype fill — accent gradient, the one bold moment
  const fillW = ((hype/100) * (W - 40));
  const grad = ctx.createLinearGradient(20, 0, 20 + (W-40), 0);
  grad.addColorStop(0, '#7c5cff');
  grad.addColorStop(1, '#c9a34a');
  ctx.fillStyle = grad;
  ctx.fillRect(20, H/2 - 9, fillW, 18);
  // Golden p6 surprise eye — correct 6-arg signature, renders for real over the bar
  if (window.p6LungSurpriseEye) {
    window.p6LungSurpriseEye(ctx, W, H/2, _lung, s, _spore, 0.15);
  }
}

// Live bonding-curve chart: plots the real price path (log-scaled) climbing as buys fill in.
const _curvePts = [];
function drawCurve(open, price, progress, whale) {
  const c = document.getElementById('meme-hype-canvas');
  if (!c || !coin) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  const pad = 18;
  if (progress <= 0.03) _curvePts.length = 0;
  // store multiple (log) so early + late are both visible
  _curvePts.push(Math.log10(price / open + 0.0001) + 0.001);
  if (_curvePts.length > 240) _curvePts.shift();

  ctx.clearRect(0, 0, W, H);
  // baseline track
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

  // golden p6 surprise eye still watches, driven by the launch momentum
  if (window.p6LungSurpriseEye) {
    const s = Math.min(1, (price / open - 1) * 0.15 + (whale ? 0.4 : 0.1));
    window.p6LungSurpriseEye(ctx, W, H * 0.42, _lung, s, _spore, whale ? 0.3 : 0.1);
  }
}

function recordToCodex(type, text) {
  let codex = JSON.parse(localStorage.getItem(CODEX_KEY)||'[]');
  codex.unshift({ts:Date.now(), type, text, relicLevel: (type==='voice'?2:1), power: hype|0 });
  localStorage.setItem(CODEX_KEY, JSON.stringify(codex.slice(0,15)));
  showCreations();
}

function showCreations() {
  const el = document.getElementById('creations');
  const codex = JSON.parse(localStorage.getItem(CODEX_KEY)||'[]');
  el.innerHTML = codex.map((r,i)=>`<div class="card" onclick="reObserve(${i})">${new Date(r.ts).toLocaleTimeString()} ${r.text} Lv${r.relicLevel} P${r.power}</div>`).join('');
}

function reObserve(i) {
  let codex = JSON.parse(localStorage.getItem(CODEX_KEY)||'[]');
  if (codex[i]) { codex[i].power +=12; localStorage.setItem(CODEX_KEY,JSON.stringify(codex)); drawMemeHype(0.95); showCreations(); }
}

// Virality: share the user's ACTUAL coin — name, ticker, real curve result seed more buys.
function shareMemeFate() {
  if (!coin || !coin.trades) { alert('Launch a coin first, then share its run.'); return; }
  const mcap = fmtUsd(coinMcap(coin) * ETH_USD);
  const story =
    `$${coin.ticker} "${coin.name}" is live on the bonding curve.\n` +
    `mcap ${mcap} · ${coin.holders} holders · ${coin.trades} trades. Ape in before the curve steepens.\n` +
    `#MemeForge #${coin.ticker} · fictional, 18+`;

  const done = () => alert(`Copied $${coin.ticker} share card. Each share seeds new curve buys.`);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(story).then(done).catch(done);
  } else { done(); }

  // Sharing feeds real buy pressure back into the live curve (referral seed → more holders).
  if (!curveTimer) {
    const seed = 0.05 + Math.random() * 0.15;
    curveBuy(coin, seed);
    coin.holders += 1 + Math.floor(Math.random() * 3);
    drawCurve(coinPrice(coin) / 1.02, coinPrice(coin), 0.99, true);
  }

  const f = JSON.parse(localStorage.getItem('fateCodex') || '[]');
  f.unshift({ ts: Date.now(), type: 'p18-meme-fate', text: `$${coin.ticker} ${mcap}`, score: Math.min(100, coin.holders + coin.trades) });
  localStorage.setItem('fateCodex', JSON.stringify(f.slice(0, 30)));
  recordToCodex('share', `Shared $${coin.ticker} · ${mcap} · seeded curve`);
}

function init() {
  updateFomo(); showDrops(); showCreations(); drawMemeHype(0.6);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
}
window.onload=init;