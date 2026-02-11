# 🌿 Your Focus Creature

A homegrown Kiki.Computer for Windows. A snarky little monster that lives on
your screen and makes sure you actually work.

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Run in dev mode
npm start

# 3. Build a distributable .exe (when you're ready to share)
npm run build
```

---

## Adding Your Creature Art 🎨

The app is ready for your sprites. Just drop them in `src/assets/sprites/` and
swap the placeholder emoji in the HTML.

**Sprites to draw:**

| File | When it shows |
|------|--------------|
| `idle.png` | Launcher screen, waiting |
| `focused.png` | Active focus session, all good |
| `judging.png` | When you poke it / get a snark message |
| `celebrating.png` | Session complete! |
| `sleeping.png` | (optional) between sessions |
| `tray-icon.ico` | 16×16 Windows tray icon |
| `tray-icon.png` | 16×16 fallback |

**Tips:**
- Pixel art works great — use `image-rendering: pixelated` (already in the CSS)
- 64×64px or 128×128px is a good size
- PNG with transparency
- For the tray icon, `.ico` format with 16×16 and 32×32 sizes

**To swap in your art**, replace the emoji placeholder divs in the HTML:

```html
<!-- In launcher.html and overlay.html, change this: -->
<div class="sprite-placeholder">👾</div>

<!-- To this: -->
<img class="sprite-img" src="../assets/sprites/idle.png" />
```

---

## Customizing the Colors

Edit the `:root` CSS variables in either HTML file:

```css
:root {
  --bg: #1a1a2e;        /* main background */
  --surface: #16213e;   /* input fields */
  --accent: #e94560;    /* highlight color */
  --accent2: #0f3460;   /* secondary surfaces */
  --text: #eaeaea;
  --muted: #888;
}
```

---

## Customizing the Snark

Edit the `SNARK` object in `src/main/main.js`:

```js
const SNARK = {
  distracted: [
    "Hey. HEY. That's not what you said you'd be doing.",
    // add more lines here
  ],
  starting: [ ... ],
  finished: [ ... ],
  idle: [ ... ],
}
```

Use `%TASK%` to insert the current task name, `%MINUTES%` for session length.

---

## Hard Mode (site blocking)

Hard mode edits `C:\Windows\System32\drivers\etc\hosts` to redirect blocked
sites to `127.0.0.1`. This requires the app to run with admin privileges.

**First time setup:** Right-click the app → "Run as administrator"

The app cleans up after itself — sites are unblocked when the session ends or
the app closes.

---

## Project Structure

```
src/
  main/
    main.js       ← Electron main process, all logic lives here
    preload.js    ← Bridge between main and renderer (security layer)
  renderer/
    launcher.html ← The task setup window
    overlay.html  ← The creature overlay during a session
  assets/
    sprites/      ← Your art goes here
```
