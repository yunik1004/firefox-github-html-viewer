// GitHub HTML Preview — content script.
// On HTML blob pages, adds a "Preview" link to the file header action row,
// immediately to the left of the "Add to space" button. Clicking it fetches
// the file (using the user's session cookie for private repos), wraps the
// HTML with a <base> pointing at the raw URL so relative resources resolve,
// and opens the result in a new tab via a blob: URL — which escapes the
// github.com page CSP that would otherwise block external CDN scripts.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUTTON_ID = "ghp-preview-btn";

const BLOB_HTML_PATH_RE = /^\/[^/]+\/[^/]+\/blob\/[^/]+\/.+\.html?$/i;

// ---------------------------------------------------------------------------
// URL utilities
// ---------------------------------------------------------------------------

function isHtmlBlobPage(pathname: string = location.pathname): boolean {
  return BLOB_HTML_PATH_RE.test(pathname);
}

// Build a fetch URL from a /blob/ path. github.com/.../raw/... 302-redirects
// to a signed raw.githubusercontent.com URL whose ?token= parameter carries
// the authorization; the session cookie on the initial same-origin request
// is what unlocks private repos.
function rawUrlFromBlobPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 5 || parts[2] !== "blob") return null;
  const [owner, repo, , branch, ...rest] = parts;
  return `https://github.com/${owner}/${repo}/raw/${branch}/${rest.join("/")}`;
}

function dirHref(url: string): string {
  return url.substring(0, url.lastIndexOf("/") + 1);
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function isVisible(el: HTMLElement): boolean {
  if (el.offsetParent === null) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// The "Add to space" trigger is a Primer IconButton wrapping an
// octicon-space SVG. We use it as the right-anchor for our Preview button.
function findAddToSpaceButton(): HTMLButtonElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      'button[data-component="IconButton"]',
    ),
  );
  for (const btn of candidates) {
    if (btn.querySelector("svg.octicon-space") && isVisible(btn)) return btn;
  }
  return null;
}

// The Raw link in the same action row is a visible text LinkButton, so we
// deep-clone it to inherit Primer's hashed module classes (padding, focus
// ring, hover, dark-mode color tokens) and then rewrite the label.
function findRawTemplate(): HTMLAnchorElement | null {
  return document.querySelector<HTMLAnchorElement>(
    'a[data-testid="raw-button"]',
  );
}

// ---------------------------------------------------------------------------
// HTML rewriting
// ---------------------------------------------------------------------------

function injectBaseHref(html: string, baseHref: string): string {
  const tag = `<base href="${baseHref}">`;
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([\s>])/i, `<head$1${tag}`);
  }
  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${tag}</head>`);
  }
  return tag + html;
}

// ---------------------------------------------------------------------------
// Click handler — fetch + blob + new tab
// ---------------------------------------------------------------------------

async function openPreviewInNewTab(): Promise<void> {
  const rawUrl = rawUrlFromBlobPath(location.pathname);
  if (!rawUrl) return;

  const response = await fetch(rawUrl, { credentials: "same-origin" });
  if (!response.ok) {
    window.alert(
      `Failed to load preview: ${response.status} ${response.statusText}`,
    );
    return;
  }
  const html = await response.text();
  const enriched = injectBaseHref(html, dirHref(rawUrl));
  const blob = new Blob([enriched], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  // The blob URL lives until the github.com tab unloads; that's a small
  // bounded leak per click and avoids stranding the just-opened new tab
  // if the user refreshes it.
  window.open(url, "_blank");
}

// ---------------------------------------------------------------------------
// Button injection / teardown
// ---------------------------------------------------------------------------

function createPreviewButton(template: HTMLAnchorElement): HTMLElement {
  const el = template.cloneNode(true) as HTMLAnchorElement;
  el.id = BUTTON_ID;
  el.removeAttribute("data-testid");
  el.removeAttribute("data-discover");
  el.setAttribute("href", "#");
  el.setAttribute("role", "button");

  // Primer LinkButtons use a [data-text] inner element to reserve width.
  const textNode = el.querySelector<HTMLElement>("[data-text]");
  if (textNode) {
    textNode.setAttribute("data-text", "Preview");
    textNode.textContent = "Preview";
  } else {
    el.textContent = "Preview";
  }

  el.addEventListener("click", (event) => {
    event.preventDefault();
    void openPreviewInNewTab();
  });
  return el;
}

function teardown(): void {
  document.getElementById(BUTTON_ID)?.remove();
}

function setup(): void {
  if (!isHtmlBlobPage()) {
    teardown();
    return;
  }
  if (document.getElementById(BUTTON_ID)) return;

  const anchor = findAddToSpaceButton();
  const template = findRawTemplate();
  if (!anchor?.parentNode || !template) return;

  const button = createPreviewButton(template);
  anchor.parentNode.insertBefore(button, anchor);
}

// ---------------------------------------------------------------------------
// Navigation watcher (turbo / pjax + history API + popstate)
// ---------------------------------------------------------------------------

let lastPath = location.pathname;

function handleNavigation(): void {
  if (location.pathname === lastPath) return;
  lastPath = location.pathname;
  teardown();
  setup();
}

function patchHistory(method: "pushState" | "replaceState"): void {
  const original = history[method];
  history[method] = function (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    original.call(history, data, unused, url);
    queueMicrotask(handleNavigation);
  };
}

new MutationObserver(setup).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
patchHistory("pushState");
patchHistory("replaceState");
window.addEventListener("popstate", handleNavigation);

setup();
