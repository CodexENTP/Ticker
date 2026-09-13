# Codex Analytics Market Scanner v4.1.1 — Resilient UI Patch

This package is a full replacement for the previous v4 repository files.

## What this patch fixes
- Restores the Codex dark navy / bronze visual shell and dotted background.
- Constrains the CA and CODEX header artwork so images cannot expand to intrinsic size.
- Crops the stray bronze edge artifact from the CA artwork.
- Adds a complete inline CSS fallback inside `index.html` while retaining `styles.css` as the normal stylesheet. If GitHub Pages serves a stale/missing stylesheet, the page remains fully styled.
- Uses explicit `./` asset paths and cache-busting version parameters.
- Keeps the v4 scanner logic: four scan modes, quiz builder, saved profiles, API-budget tracking/caching, Gap-Fill Reversal, Early Golden Cross, RSI/MACD analysis, subscores, near matches, watchlist, history and CSV export.

## Deploy
1. Delete/replace the old app files in the repository root.
2. Upload **all** files from this package to that same root.
3. Commit the changes.
4. Confirm GitHub Settings → Pages is still publishing from `main` and `/(root)`.
5. After GitHub finishes deploying, open the site and perform one hard refresh (`Ctrl+F5` on Windows).

Do not upload only `index.html`; the JS and image assets in this package belong together.

## API note
Business Quant must accept the API key at its own endpoint before the scanner can retrieve live data. The UI will still load correctly without a working API key.
