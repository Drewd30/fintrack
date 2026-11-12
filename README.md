# FinTrack

A private personal finance tracker. Plain HTML, CSS and JavaScript. No libraries, no backend.
Data is stored only on your device in IndexedDB.

## Deploy to GitHub Pages
1. Create a repository and upload every file in this folder to the repository root (keep the `icons` folder).
2. Repository **Settings → Pages → Build and deployment**: Source "Deploy from a branch", branch `main`, folder `/ (root)`.
3. Open `https://<your-username>.github.io/<repo-name>/` in **iPhone Safari**.
4. Tap **Share → Add to Home Screen**. Open the app from the Home Screen icon and enter your data there.
   (Safari and the installed app keep separate storage.)

All paths are relative, so no base-path configuration is needed.
When you publish a new version, change `V` in `sw.js` (for example to `fintrack-v2`).

## Back up
Settings → Export backup (JSON). Do this regularly. Losing the phone or clearing Safari data erases everything otherwise.

## Tests
`node test.js` runs the financial-logic tests (no install needed, Node 22+).

## Files
`core.js` money and accounting rules (pure, tested) · `app.js` storage and UI · `style.css` · `sw.js` offline cache · `manifest.webmanifest`
