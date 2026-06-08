// Menu overlay tabs and level catalog relocation. Extracted from main.js.
import { Logger } from './logger.js';
import { initLevelCatalog } from './levelCatalog.js';

export function wireMenuTabs(game) {
  if (game._menuTabsWired) return;
  const tabs = document.querySelectorAll('#menu-tabs .menu-tab');
  if (!tabs || tabs.length === 0) return;
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const id = tab.getAttribute('data-tab');
      activateMenuTab(id);
    });
  });
  const storyBtn = document.getElementById('story-mode-btn');
  if (storyBtn) {
    storyBtn.addEventListener('click', () => {
      if (game.story && typeof game.story.startStory === 'function') {
        if (!game._checkAndPromptForReset('Story Mode')) return;
        game.story.startStory();
      } else {
        Logger.warn('Story engine not available.');
      }
    });
  }
  const invadersBtn = document.getElementById('space-invaders-btn');
  if (invadersBtn) {
    invadersBtn.addEventListener('click', () => {
      if (game.spaceInvadersMode) {
        game.spaceInvadersMode.start();
      } else {
        Logger.warn('Space Invaders mode not available.');
      }
    });
  }
  game._menuTabsWired = true;
}

export function activateMenuTab(id) {
  const tabs = document.querySelectorAll('#menu-tabs .menu-tab');
  const panels = document.querySelectorAll('#menu-tab-panels .menu-tab-panel');
  tabs.forEach((t) => {
    t.classList.toggle('active', t.getAttribute('data-tab') === id);
  });
  panels.forEach((p) => {
    p.classList.toggle('active', p.getAttribute('data-panel') === id);
  });
}

// The level catalog (initLevelCatalog) appends a .level-catalog-section
// into the overlay content. We relocate it into the Library tab panel
// so it lives under the right tab.
export function relocateLevelCatalog() {
  const tryMove = (attemptsLeft) => {
    const mount = document.getElementById('menu-level-catalog-mount');
    if (!mount) return;
    const all = document.querySelectorAll('#overlay-content .level-catalog-section');
    let movedAny = false;
    all.forEach((section) => {
      if (mount.contains(section)) return;
      if (!movedAny) {
        while (mount.firstChild) mount.removeChild(mount.firstChild);
      }
      mount.appendChild(section);
      movedAny = true;
    });
    if (attemptsLeft > 0) {
      setTimeout(() => tryMove(attemptsLeft - 1), 80);
    }
  };
  tryMove(30);
}

export function showAndRefreshMenuCatalog() {
  initLevelCatalog();
  relocateLevelCatalog();
}
