import { Logger } from './logger.js';

function fetchMarkdown(url) {
    return fetch(new URL(url, document.baseURI))
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to load guide: ${response.status} ${response.statusText}`);
            }
            return response.text();
        })
        .catch(error => {
            Logger.error('Error loading guide markdown:', error);
            return 'Failed to load guide content.';
        });
}

/**
 * Renders the Console Hacking Guide as an in-game overlay.
 * While shown, the game is paused (speed forced to 0) and restored on close.
 */
export class GuidePanel {
    /**
     * @param {object} opts
     * @param {string}   opts.overlayId   - id of the overlay element
     * @param {string}   opts.bodyId      - id of the scrollable body element
     * @param {string}   opts.closeId     - id of the close button
     * @param {string}   opts.markdownUrl - URL of the markdown file to load
     * @param {Function} [opts.onOpen]
     * @param {Function} [opts.onClose]
     */
    constructor({
        overlayId = 'guide-overlay',
        bodyId = 'guide-body',
        closeId = 'guide-close-button',
        markdownUrl = '/console_guide.md',
        onOpen,
        onClose,
    } = {}) {
        this.overlay = document.getElementById(overlayId);
        this.body = document.getElementById(bodyId);
        this.closeButton = document.getElementById(closeId);
        this._markdownPromise = fetchMarkdown(markdownUrl);
        this.onOpen = onOpen;
        this.onClose = onClose;
        this._rendered = false;
        this._visible = false;

        if (this.closeButton) {
            this.closeButton.addEventListener('click', () => this.hide());
        }
        // Click outside content closes it too.
        if (this.overlay) {
            this.overlay.addEventListener('click', (e) => {
                if (e.target === this.overlay) this.hide();
            });
        }
        // ESC closes.
        window.addEventListener('keydown', (e) => {
            if (!this._visible) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                this.hide();
            }
        });
    }

    async _render() {
        if (this._rendered) return;
        if (!this.body) return;
        // Show a loading indicator while the markdown is being fetched.
        this.body.textContent = 'Loading...';
        let guideMarkdown;
        try {
            guideMarkdown = await this._markdownPromise;
        } catch (e) {
            Logger.error('GuidePanel: failed to load markdown.', e);
            guideMarkdown = 'Failed to load guide content.';
        }
        try {
            // marked is loaded via index.html as UMD; it attaches to window.
            const marked = (typeof window !== 'undefined') ? window.marked : null;
            if (marked && typeof marked.parse === 'function') {
                this.body.innerHTML = marked.parse(guideMarkdown);
            } else if (marked && typeof marked === 'function') {
                this.body.innerHTML = marked(guideMarkdown);
            } else {
                // Fallback: render as preformatted text if marked isn't available.
                Logger.warn('GuidePanel: marked.js not found; rendering as plain text.');
                const pre = document.createElement('pre');
                pre.textContent = guideMarkdown;
                this.body.innerHTML = '';
                this.body.appendChild(pre);
            }
            this._rendered = true;
        } catch (e) {
            Logger.error('GuidePanel: failed to render markdown.', e);
            const pre = document.createElement('pre');
            pre.textContent = guideMarkdown;
            this.body.innerHTML = '';
            this.body.appendChild(pre);
            this._rendered = true;
        }
    }

    isVisible() {
        return this._visible;
    }

    show() {
        if (!this.overlay) return;
        this._render();
        this.overlay.classList.remove('hidden');
        this.overlay.removeAttribute('aria-hidden');
        this._visible = true;
        if (this.body) this.body.scrollTop = 0;
        if (this.onOpen) this.onOpen();
    }

    hide() {
        if (!this.overlay) return;
        this.overlay.classList.add('hidden');
        this.overlay.setAttribute('aria-hidden', 'true');
        this._visible = false;
        if (this.onClose) this.onClose();
    }

    toggle() {
        if (this._visible) this.hide();
        else this.show();
    }
}