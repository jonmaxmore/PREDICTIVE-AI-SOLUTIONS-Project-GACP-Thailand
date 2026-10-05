/**
 * A full page load to `url`.
 *
 * Used where the app must leave the current page and start clean, for example
 * after ending a session. It is one function so tests can see where the app sent
 * the user: jsdom cannot perform a navigation, and its `window.location` cannot
 * be replaced or spied on.
 */
export function hardNavigate(url: string): void {
    window.location.href = url;
}
