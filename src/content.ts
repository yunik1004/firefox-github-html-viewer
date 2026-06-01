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

// GitHub renders mobile and desktop layout variants of the file header
// side-by-side in the DOM and hides the inactive one via CSS, so we filter
// to visible candidates first.
function isVisible(el: HTMLElement): boolean {
  if (el.offsetParent === null) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// Find the Blame button that lives inside the Primer SegmentedControl
// (Code | Blame toggle) on a blob page. Used both as the insertion anchor
// and as a style template for the Preview button.
function findInsertionPoint(): HTMLButtonElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  )
    .filter((el) => el.textContent?.trim() === "Blame")
    .filter(isVisible);

  for (const blame of candidates) {
    if (blame.closest("ul[class*='SegmentedControl']")) return blame;
  }
  return candidates[0] ?? null;
}

function findBlobContentContainer(): HTMLElement | null {
  const selectors = [
    "[data-hpc]", // current GitHub viewer (react-code-file-contents)
    ".react-code-lines",
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
  prevActive: HTMLElement | null;
}

let preview: PreviewState | null = null;

// Apply Primer SegmentedControl's active-segment markers to a button:
//   aria-current="true"|"false" on the button,
//   --separator-color CSS var on the button (transparent when active),
//   data-selected on the parent <li> when active.
function setSegmentActive(button: HTMLElement, active: boolean): void {
  button.setAttribute("aria-current", active ? "true" : "false");
  button.style.setProperty(
    "--separator-color",
    active ? "transparent" : "var(--borderColor-default)",
  );
  const li = button.parentElement;
  if (!li) return;
  if (active) li.setAttribute("data-selected", "");
  else li.removeAttribute("data-selected");
}

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

  // The currently-selected segment (Code on /blob/, Blame on /blame/).
  // We park its active state on the Preview tab while we render.
  const ul = button.closest("ul[class*='SegmentedControl']");
  const prevActive =
    (ul?.querySelector<HTMLElement>('button[aria-current="true"]') ?? null);

  const state: PreviewState = {
    button,
    container,
    frame,
    originalDisplay: container.style.display,
    prevActive: prevActive !== button ? prevActive : null,
  };
  container.style.display = "none";
  container.parentNode.insertBefore(frame, container);
  preview = state;

  if (state.prevActive) setSegmentActive(state.prevActive, false);
  setSegmentActive(button, true);

  // credentials: "same-origin" (the default) sends the github.com session
  // cookie on the initial same-origin request to /raw/, which is enough for
  // private repo auth — github.com then 302-redirects to a signed
  // raw.githubusercontent.com URL whose ?token= query parameter carries the
  // authorization. Using "include" here would also try to send credentials
  // on the cross-origin step, which Firefox blocks when the response uses
  // Access-Control-Allow-Origin: *.
  const response = await fetch(rawUrl, { credentials: "same-origin" });
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
  const { button, container, frame, originalDisplay, prevActive } = preview;
  frame.remove();
  container.style.display = originalDisplay;
  setSegmentActive(button, false);
  if (prevActive) setSegmentActive(prevActive, true);
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
  // Deep-clone the existing segment button so we inherit Primer's nested
  // <span>/<div> wrappers, hashed CSS module classes, hover/active styles,
  // and the data-text width-reserving trick. Then rewrite the label.
  if (template instanceof HTMLButtonElement) {
    const btn = template.cloneNode(true) as HTMLButtonElement;
    btn.id = BUTTON_ID;
    btn.removeAttribute("aria-pressed");

    const textEl = btn.querySelector<HTMLElement>("[data-text]");
    if (textEl) {
      textEl.setAttribute("data-text", "Preview");
      textEl.textContent = "Preview";
    } else {
      btn.textContent = "Preview";
    }

    // Always start in the inactive segment state.
    setSegmentActive(btn, false);
    btn.addEventListener("click", togglePreview);
    return btn;
  }

  // Fallback path: no Primer template available, build a plain button.
  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.type = "button";
  btn.textContent = "Preview";
  btn.className = FALLBACK_BUTTON_CLASS;
  btn.classList.add(BUTTON_CLASS);
  setSegmentActive(btn, false);
  btn.addEventListener("click", togglePreview);
  return btn;
}

const WRAPPER_ATTR = "data-ghp-wrapper";

function teardown(): void {
  if (preview) hidePreview();
  document.getElementById(BUTTON_ID)?.remove();
  document.querySelector(`[${WRAPPER_ATTR}]`)?.remove();
}

function setup(): void {
  if (!isHtmlBlobPage()) {
    teardown();
    return;
  }
  if (document.getElementById(BUTTON_ID)) return;

  const insertionPoint = findInsertionPoint();
  if (!insertionPoint) return;

  const button = createPreviewButton(insertionPoint);

  // If Blame sits in a Primer SegmentedControl LI, add Preview as a new LI
  // sibling so the segmented look (Code | Blame | Preview) is preserved.
  const li = insertionPoint.parentElement;
  const ul = li?.parentElement;
  if (li?.tagName === "LI" && ul?.tagName === "UL") {
    const wrapper = document.createElement("li");
    wrapper.className = li.className;
    wrapper.setAttribute(WRAPPER_ATTR, "1");
    wrapper.appendChild(button);
    ul.appendChild(wrapper);

    // When the user clicks Code or Blame while Preview is active, treat it
    // as "leave preview" so the segmented control stays mutually exclusive.
    // Blame additionally navigates away; the nav watcher tears down then.
    if (!ul.hasAttribute("data-ghp-listening")) {
      ul.setAttribute("data-ghp-listening", "1");
      ul.addEventListener("click", (event) => {
        if (!preview) return;
        const target = event.target;
        if (target instanceof Element && target.closest(`#${BUTTON_ID}`)) {
          return;
        }
        hidePreview();
      });
    }
    return;
  }

  // Fallback: insert as a direct sibling right after the anchor element.
  insertionPoint.parentNode?.insertBefore(button, insertionPoint.nextSibling);
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
