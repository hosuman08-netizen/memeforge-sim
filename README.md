# MemeForge

A small, self-contained web toy: forge a meme into a coin, record a hype voice,
and watch it climb a live bonding curve. Join timed "drop" windows for a hype
boost and share your coin's run.

**Fictional simulation only.** No real money, tokens, blockchain, or investment
is involved. 18+.

## Run

Open `index.html` in a browser, or serve the folder statically:

```
python3 -m http.server 8000
```

Then visit http://localhost:8000/. Client-only; all state lives in the browser
(localStorage). No backend, no network calls.

## Files

- `index.html` — layout and controls
- `style.css` — theme
- `script.js` — coin identity, bonding-curve launch, drops, hype, share
- `hype-eye.js` — decorative golden hype-eye canvas effect
- `sw.js` / `manifest.json` — offline shell (PWA)
