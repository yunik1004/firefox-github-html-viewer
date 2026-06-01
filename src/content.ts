// GitHub HTML Preview — content script.
// Injects a Preview button next to Code/Blame on github.com blob pages
// for *.html files, and toggles the code view with a sandboxed iframe
// rendering the file.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUTTON_ID = "ghp-preview-btn";
const FRAME_ID = "ghp-preview-frame";
const BUTTON_CLASS = "ghp-preview-btn";
const FRAME_CLASS = "ghp-preview-frame";
const FALLBACK_BUTTON_CLASS = "Button Button--secondary Button--small";

const BLOB_HTML_PATH_RE = /^\/[^/]+\/[^/]+\/blob\/[^/]+\/.+\.html?$/i;

// ---------------------------------------------------------------------------
// URL utilities
// ---------------------------------------------------------------------------

function isHtmlBlobPage(pathname: string = location.pathname): boolean {
  return BLOB_HTML_PATH_RE.test(pathname);
}

// Build a fetch URL from a /blob/ path. Uses github.com/.../raw/... rather
// than raw.githubusercontent.com directly so that private repos work: the
// browser's session cookie authenticates the github.com request, which then
// 302-redirects to a short-lived signed raw.githubusercontent.com URL.
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
// GitHub DOM selectors
// ---------------------------------------------------------------------------

// The Preview button is inserted right after this anchor. Blame is preferred
// so Preview sits at the right end of the Code | Blame segmented group.
function findInsertionAnchor(): HTMLAnchorElement | null {
  return (
    document.querySelector<HTMLAnchorElement>(
      'a[data-testid="blob-blame-button"]',
    ) ??
    document.querySelector<HTMLAnchorElement>(
      'a[data-testid="blob-code-button"]',
    )
  );
}

function findBlobContentContainer(): HTMLElement | null {
  const selectors = [
    '[data-testid="blob-viewer-file-content"]',
    ".react-blob-view-content",
    '[itemprop="text"]',
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el instanceof HTMLElement) return el;
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTML rewriting
// ---------------------------------------------------------------------------

// Inject a <base href="..."> into the fetched HTML so that relative resources
// (e.g. <img src="logo.png">) resolve against the raw file's directory.
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

function errorPage(status: number, statusText: string): string {
  return (
    `<!doctype html><meta charset="utf-8">` +
    `<body style="font-family:system-ui;padding:1rem;color:#cf222e">` +
    `Failed to load preview: ${status} ${statusText}</body>`
  );
}

// ---------------------------------------------------------------------------
// Preview state + toggle
// ---------------------------------------------------------------------------

interface PreviewState {
  button: HTMLButtonElement;
  container: HTMLElement;
  frame: HTMLIFrameElement;
  originalDisplay: string;
}

let preview: PreviewState | null = null;

async function showPreview(button: HTMLButtonElement): Promise<void> {
  if (preview) return;

  const container = findBlobContentContainer();
  if (!container?.parentNode) return;

  const rawUrl = rawUrlFromBlobPath(location.pathname);
  if (!rawUrl) return;

  const frame = document.createElement("iframe");
  frame.id = FRAME_ID;
  frame.className = FRAME_CLASS;
  frame.setAttribute("sandbox", "allow-scripts");

  const state: PreviewState = {
    button,
    container,
    frame,
    originalDisplay: container.style.display,
  };
  container.style.display = "none";
  container.parentNode.insertBefore(frame, container);
  preview = state;

  button.setAttribute("aria-pressed", "true");
  button.textContent = "Code";

  const response = await fetch(rawUrl, { credentials: "include" });
  // The user may have toggled off or navigated away while the fetch was
  // pending. Bail out silently if our frame is no longer the active one.
  if (preview !== state) return;

  if (!response.ok) {
    frame.srcdoc = errorPage(response.status, response.statusText);
    return;
  }
  const html = await response.text();
  if (preview !== state) return;
  frame.srcdoc = injectBaseHref(html, dirHref(rawUrl));
}

function hidePreview(): void {
  if (!preview) return;
  const { button, container, frame, originalDisplay } = preview;
  frame.remove();
  container.style.display = originalDisplay;
  button.setAttribute("aria-pressed", "false");
  button.textContent = "Preview";
  preview = null;
}

function togglePreview(event: Event): void {
  const button = event.currentTarget as HTMLButtonElement;
  if (preview) hidePreview();
  else void showPreview(button);
}

// ---------------------------------------------------------------------------
// Button injection / teardown
// ---------------------------------------------------------------------------

function createPreviewButton(template: HTMLElement): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.type = "button";
  btn.textContent = "Preview";
  btn.setAttribute("aria-pressed", "false");
  btn.className = template.className || FALLBACK_BUTTON_CLASS;
  btn.classList.add(BUTTON_CLASS);
  btn.addEventListener("click", togglePreview);
  return btn;
}

function teardown(): void {
  if (preview) hidePreview();
  document.getElementById(BUTTON_ID)?.remove();
}

function setup(): void {
  if (!isHtmlBlobPage()) {
    teardown();
    return;
  }
  if (document.getElementById(BUTTON_ID)) return;

  const anchor = findInsertionAnchor();
  if (!anchor?.parentNode) return;

  const button = createPreviewButton(anchor);
  anchor.parentNode.insertBefore(button, anchor.nextSibling);
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
