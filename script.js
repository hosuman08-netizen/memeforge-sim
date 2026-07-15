// p18 MemeForge on Base - p6 voice + FOMO drops + p17 export + relics
const CODEX_KEY = 'memeCodex';
let hype = 50;

function updateFomo() {
  const el = document.getElementById('fomo');
  el.textContent = 'Meme Drop windows: Dawn/Eclipse/Midnight active • limited slots';
}

function recordMemeVoice() {
  const out = document.getElementById('voiceOut');
  const s = window.getP6LungSurprise ? window.getP6LungSurprise(0.75) : 0.82;
  hype = Math.min(100, hype + s * 30);
  out.innerHTML = `<div class="card">Voice recorded. Hype +${(s*30|0)} (surprise ${s.toFixed(2)})</div>`;
  drawMemeHype(s);
  if (s > 0.85) recordToCodex('voice', `Soul birthed with high resonance`);
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

function showDrops() {
  const el = document.getElementById('dropList');
  el.innerHTML = `
    <div class="card">🌅 Dawn Drop (9 slots) <button onclick="joinDrop('dawn')">Join + Voice</button></div>
    <div class="card">🌑 Eclipse (2 slots) <button onclick="joinDrop('eclipse')">Join (high FOMO)</button></div>
  `;
}

function joinDrop(win) {
  const s = window.getP6LungSurprise ? window.getP6LungSurprise(0.8) : 0.7;
  const boost = win==='eclipse' ? 1.4 : 1;
  hype = Math.min(100, hype + s*25*boost);
  recordToCodex('drop', `Joined ${win} • hype boost`);
  drawMemeHype(s);
  alert('Joined. Voice power added. Time limited.');
}

function drawMemeHype(s=0.7) {
  const c = document.getElementById('meme-hype-canvas');
  if(!c) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  ctx.fillStyle = `hsla(280,70%,65%,${s})`;
  ctx.fillRect(20,20, (hype/100)*240 , 50);
  if (window.p6LungSurpriseEye) window.p6LungSurpriseEye(s);
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