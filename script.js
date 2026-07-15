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

function launchMeme() {
  const fee = Math.floor(10 * (1 + (100-hype)/100));
  const name = 'MemeSoul' + (Date.now()%1000);
  recordToCodex('launch', `${name} launched. Hype ${hype|0} fee ${fee} (p10)`);
  hype = Math.max(20, hype - 15);
  drawMemeHype(0.9);
  alert(`Launched on Base. p10 skimmed. Export to p17 ready.`);
  exportToP17(name);
}

function exportToP17(name) {
  // mock p17 asset add
  const p17Codex = JSON.parse(localStorage.getItem('walletCodex') || '[]');
  p17Codex.unshift({ts:Date.now(), type:'p18-meme', text: name, power: hype|0, level:2});
  localStorage.setItem('walletCodex', JSON.stringify(p17Codex));
  recordToCodex('export', `Exported ${name} to p17`);
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

// Virality: Meme Fate Share (recommended action)
function shareMemeFate() {
  const story = 'MY Meme Soul launched in Eclipse. Hype relic exported to p17 + p20 Codex. Fictional.';
  navigator.clipboard.writeText(story + ' #MemeDrop #DestinyDuo').then(()=> alert('Shared! p10 bonus + cross seed.'));
  // seed p20/p21 and p17
  const f = JSON.parse(localStorage.getItem('fateCodex')||'[]');
  f.unshift({ts:Date.now(), type:'p18-meme-fate', text:story, score:75});
  localStorage.setItem('fateCodex', JSON.stringify(f));
  const w = JSON.parse(localStorage.getItem('walletCodex')||'[]');
  w.unshift({ts:Date.now(), type:'p18-export', text:'Meme as fortune asset', power:40});
  localStorage.setItem('walletCodex', JSON.stringify(w));
}

function init() {
  updateFomo(); showDrops(); showCreations(); drawMemeHype(0.6);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
}
window.onload=init;