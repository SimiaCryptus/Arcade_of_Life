# The Arcade of Life — Developer Notes

## Overview

"The Arcade of Life" is a Conway's Game-of-Life missile-defense game housed at
`games/aol/`. Players draw defensive cellular patterns on the bottom half of
the grid, which evolve alongside incoming enemy gliders/missiles spawned from
the top. The project is a static, client-side single-page app (no build step
required for basic hosting) served via `index.html`, `style.css`, and an
ES-module entrypoint at `src/main.js`.

## Entry Points

- `games/aol/index.html` — Markup for the game shell: canvas, draw toolbar,
  in-game hamburger menu, settings overlay (tabbed), pattern editor, pattern
  zoo, level designer, story mode dialogue, and the epilepsy/photosensitivity
  warning gate shown on first load.
- `games/aol/style.css` — All game styling. Organized roughly by feature
  section (time control widget, hamburger/game menu, draw tools, pattern
  editor, settings tabs, level designer, story mode, perk overlay, etc).
- `src/main.js` — Bootstraps the game (loaded as an ES module).
- `src/marked.min.js` — Bundled markdown renderer used for the in-game guide
  and how-to-play panels (rendered from markdown into `#guide-body` /
  `#help-body`).
- `../../js/games-aol-index.js` — Shared site-level wiring for this game page
  (loaded relative to the repo root, outside the `games/aol/` folder).

## Site Integration

- The game page now includes a **Home** link back to the site root (`/`),
  available from the in-game hamburger menu (`#gm-home`). This lets players
  navigate back to the arcade's landing page without using browser back
  navigation, which is especially useful when the game is launched as an
  installed PWA (no browser chrome/back button available) or in fullscreen
  mode.
  - Implementation: an anchor (`<a href="/">`) styled as a `.gm-item` so it
    matches the rest of the hamburger dropdown, placed after a `.gm-divider`
    beneath the destructive actions (Restart/Exit) to keep it visually
    separate.
  - Because `#game-menu-dropdown` items are otherwise `<button>` elements,
    any JS that iterates `.gm-item` elements and expects only buttons should
    be aware an `<a>` tag is now included; click-outside/dismiss handling
    keyed off `.gm-item` class selectors continues to work unaffected since
    the anchor also carries that class.

## PWA Considerations

- The page defines manifest link, apple touch icons, and various icon sizes
  for install-ability.
- `#pwa-install-banner`, `#pwa-update-banner`, and `#pwa-version-banner` are
  injected/controlled via site-level JS (not shown in this file) and are
  styled in `style.css`.
- When running in standalone/installed mode (`@media (display-mode:
standalone)`), the GitHub footer link is hidden and safe-area insets are
  applied — the new Home menu link is unaffected by this rule and remains
  available via the hamburger menu in all display modes.

## Settings Overlay

Tabbed interface (`#settings-tabs` / `.settings-tab-panel`) covering:
Gameplay, Enemies, Drawing, Aging Matrix, Abilities, Display, Advanced, and
Profiles (save/load/import/export as JSON). Each tab is independently
scrollable within `#settings-list`.

## Follow-up / TODO

- Consider adding a matching "Home" entry to the main menu overlay
  (`#overlay`) library/help tabs for consistency, not just the in-game
  hamburger menu.
- Verify that `games-aol-index.js` (site wiring script) does not need
  updates to handle the new anchor-based menu item (e.g., if it explicitly
  binds `addEventListener('click', …)` only to `<button>` tags matched via
  `querySelectorAll('button.gm-item')`, the selector should be broadened to
  `.gm-item` so the Home link's default anchor navigation isn't
  double-handled or blocked).
