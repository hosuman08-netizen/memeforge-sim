// hype-eye.js — the living golden eye that reacts to hype surprise.
// Purely decorative canvas art: a soft golden eye that opens/contracts and
// glows when the hype meter jumps unexpectedly. No external state, no network.
// Usage: window.hypeEye(ctx, width, centerY, state, amplitude, mood, spike=0)
//   state = { pulse:Number } (mutated in place so motion carries between frames)
//   mood  = { energy:Number 0..1 }

(function () {
  'use strict';

  function calcSurprise(state, amplitude, mood, spike) {
    if (!state || !mood) return 0;
    const expected = (mood.energy || 0.5) * 0.008 * (amplitude + 0.5);
    const actualDelta = Math.abs((state.pulse || 0) % 1 - (state._prevPulse || 0));
    state._prevPulse = state.pulse || 0;
    let raw = Math.abs(actualDelta - expected) + spike * 0.4;
    let s = Math.min(1, raw * 1.618);
    // variable reaction so the eye never looks mechanical
    s = Math.min(1, s * (0.6 + Math.random() * 1.4));
    return s;
  }

  function drawGoldenEye(ctx, width, centerY, surprise, state) {
    const gx = width * 0.618;                 // golden point of the canvas
    const gy = centerY + (state.pulse || 0) * 3;
    const eyeSize = 8 + surprise * 14;
    const alpha = 0.12 + surprise * 0.18;

    // soft multi-glaze eye (no hard edges)
    for (let g = 0; g < 5; g++) {
      const s = eyeSize * (1 + g * 0.18);
      const a = alpha * (1 - g * 0.18);
      ctx.strokeStyle = `hsla(42, 65%, 78%, ${a})`;
      ctx.lineWidth = 1.2 - g * 0.15;
      ctx.shadowBlur = 6 + surprise * 4;
      ctx.shadowColor = `hsla(42, 80%, 85%, 0.3)`;
      ctx.beginPath();
      ctx.ellipse(gx, gy, s * 1.1, s * 0.55, (state.pulse || 0) * 0.3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // iris — surprise opens / contracts it
    const irisR = eyeSize * 0.45 * (0.7 + surprise * 0.6);
    ctx.strokeStyle = `rgba(197,164,110, ${0.35 + surprise * 0.25})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(gx, gy, irisR, 0, Math.PI * 2);
    ctx.stroke();

    // pupil — the "seeing" point
    const pupilR = irisR * (0.35 + surprise * 0.25);
    ctx.fillStyle = `rgba(42, 32, 18, ${0.6 + surprise * 0.3})`;
    ctx.beginPath();
    ctx.arc(gx + (surprise - 0.5) * 1.5, gy, pupilR, 0, Math.PI * 2);
    ctx.fill();

    // high surprise: violet rune rings + a spark line
    if (surprise > 0.35) {
      ctx.strokeStyle = `rgba(167, 139, 250, ${0.4 + (surprise - 0.35) * 0.8})`;
      ctx.lineWidth = 1.1;
      for (let r = 0; r < 3; r++) {
        ctx.beginPath();
        ctx.arc(gx, gy, irisR * (1.15 + r * 0.22), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = `rgba(167,139,250,${0.25 + surprise * 0.3})`;
      ctx.beginPath();
      ctx.moveTo(gx - 18, gy - 9);
      ctx.lineTo(gx + 18 + surprise * 6, gy + 4);
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
  }

  // Main hook, called from the draw loop.
  window.hypeEye = function (ctx, width, centerY, state, amplitude, mood, spike = 0) {
    if (!ctx || !state || !mood) return;
    const surprise = calcSurprise(state, amplitude, mood, spike);
    drawGoldenEye(ctx, width, centerY, surprise, state);

    // surprise nudges the pulse so the motion evolves frame to frame
    if (surprise > 0.05) {
      const nudge = surprise * 0.003 * (0.8 + (mood.energy || 0.5)) + spike * 0.0018;
      state.pulse = (state.pulse || 0) + nudge;
      if (state.pulse > 6.28) state.pulse -= 6.28;
      state.lastSurprise = surprise;
    }
  };
})();
