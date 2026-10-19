import type { ConsoleMessage, Page, Request, Response } from "@playwright/test";

/** How long a page that threw an uncaught error may still take to hydrate. */
export const PAGE_ERROR_GRACE_MS = 5_000;
const HYDRATED = 'html[data-hydrated="true"]';
const LISTED = 8;

/** What a page shows when the wait for hydration gives up on it. */
export interface PageSnapshot {
  url: string;
  /** The HTTP status of the document, or 0 when the browser does not report it. */
  status: number;
  title: string;
  text: string;
}

/** Uncaught errors, console errors, and failed requests seen while a page loads. */
export interface PageTrouble {
  pageErrors: string[];
  consoleErrors: string[];
  failedRequests: string[];
}

interface Watch {
  trouble: PageTrouble;
  /** Settles PAGE_ERROR_GRACE_MS after the first uncaught page error. */
  pageErrorExpired: Promise<null>;
  stop(): void;
}

// Runs in the page. A loaded document without SvelteKit's bootstrap script never
// hydrates: it is the static error page (src/error.html), which the server sends
// or which the client renders after hydration fails.
function settled(): "hydrated" | "static" | false {
  if (document.documentElement.dataset.hydrated === "true") return "hydrated";
  if (document.readyState !== "complete") return false;
  const app = Array.from(document.scripts).some((script) => !script.src && script.text.includes("__sveltekit_"));
  return app ? false : "static";
}

// Runs in the page, so it must not refer to anything outside its own body.
function snapshot(): PageSnapshot {
  const [navigation] = performance.getEntriesByType("navigation") as Array<
    PerformanceEntry & { responseStatus?: number }
  >;
  const text = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
  return { url: location.href, status: navigation?.responseStatus ?? 0, title: document.title, text: text.slice(0, 200) };
}

function watch(page: Page): Watch {
  const trouble: PageTrouble = { pageErrors: [], consoleErrors: [], failedRequests: [] };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expire = (): void => undefined;
  const pageErrorExpired = new Promise<null>((resolve) => {
    expire = () => resolve(null);
  });
  const onPageError = (error: Error): void => {
    trouble.pageErrors.push(error.message);
    timer ??= setTimeout(expire, PAGE_ERROR_GRACE_MS);
  };
  const onConsole = (message: ConsoleMessage): void => {
    if (message.type() === "error") trouble.consoleErrors.push(message.text());
  };
  const onRequestFailed = (request: Request): void => {
    trouble.failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`);
  };
  const onResponse = (response: Response): void => {
    const type = response.request().resourceType();
    const lowest = type === "document" || type === "script" || type === "stylesheet" ? 400 : 500;
    if (response.status() >= lowest) {
      trouble.failedRequests.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  };
  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  page.on("requestfailed", onRequestFailed);
  page.on("response", onResponse);
  return {
    trouble,
    pageErrorExpired,
    stop: () => {
      clearTimeout(timer);
      page.off("pageerror", onPageError);
      page.off("console", onConsole);
      page.off("requestfailed", onRequestFailed);
      page.off("response", onResponse);
    },
  };
}

/**
 * What a static error page means: with an error status the server sent it, and
 * after an uncaught page error the client rendered it because hydration failed.
 * A document with neither may still turn into the app, so the wait goes on.
 */
export function verdict(page: PageSnapshot, trouble: PageTrouble): "error-page" | "page-error" | "wait" {
  if (page.status >= 400) return "error-page";
  return trouble.pageErrors.length > 0 ? "page-error" : "wait";
}

function listed(title: string, entries: string[]): string[] {
  if (entries.length === 0) return [];
  const more = entries.length > LISTED ? [`  ... and ${entries.length - LISTED} more`] : [];
  return [`${title}:`, ...entries.slice(0, LISTED).map((entry) => `  ${entry}`), ...more];
}

/** The message for a page that will not hydrate, with what it shows and what went wrong. */
export function hydrationFailure(
  reason: "error-page" | "page-error",
  page: PageSnapshot | null,
  trouble: PageTrouble,
): string {
  const lead =
    reason === "error-page"
      ? "The server sent SvelteKit's static error page (src/error.html), which never hydrates. It does so " +
        "when a server hook or the root layout fails; the web server log has the cause."
      : `The page threw an uncaught error and had not hydrated ${PAGE_ERROR_GRACE_MS / 1000} s later. When ` +
        "hydration fails and the root error page cannot load either, SvelteKit renders src/error.html in the " +
        "browser, and the server, which answered the page, has no error of its own: the cause is in the " +
        "browser, below, in the dev server output, and in this test's trace.";
  const shown = page
    ? `${page.url} (status ${page.status || "unknown"}) shows "${page.title}": ${page.text || "(no text)"}`
    : "The page could not be read.";
  return [
    lead,
    shown,
    ...listed("Page errors", trouble.pageErrors),
    ...listed("Console errors", trouble.consoleErrors),
    ...listed("Failed requests", trouble.failedRequests),
  ].join("\n");
}

async function waitForHydration(page: Page, { trouble, pageErrorExpired }: Watch): Promise<void> {
  const settling = page.waitForFunction(settled, undefined, { polling: 100 }).then((handle) => handle.jsonValue());
  // The wait that loses the race goes on until the page closes, then rejects.
  settling.catch(() => undefined);
  const outcome = await Promise.race([settling, pageErrorExpired]);
  if (outcome === "hydrated") return;
  if (outcome === "static") {
    // A navigation in progress replaces the document and takes the snapshot with it.
    const shown = await page.evaluate(snapshot).catch(() => null);
    const reason = shown ? verdict(shown, trouble) : "wait";
    if (reason !== "wait") throw new Error(hydrationFailure(reason, shown, trouble));
    const marker = page.locator(HYDRATED).waitFor();
    marker.catch(() => undefined);
    if ((await Promise.race([marker.then(() => "hydrated" as const), pageErrorExpired])) === "hydrated") return;
  }
  if ((await page.locator(HYDRATED).count()) > 0) return;
  const shown = await page.evaluate(snapshot).catch(() => null);
  throw new Error(hydrationFailure("page-error", shown, trouble));
}

/**
 * Waits until SvelteKit has attached the current document's event handlers. The
 * root layout adds this marker from onMount, so no fixed timing assumption is
 * needed even while the development server compiles a route for the first time.
 * Call it after `page.reload()` too: the reloaded document is visible, and
 * clickable, before its handlers exist, so an early click does nothing.
 *
 * A page that cannot hydrate fails right away instead of at the test timeout:
 * SvelteKit's static error page, or a page that throws an uncaught error and has
 * not hydrated PAGE_ERROR_GRACE_MS later. The error names what the page shows
 * and the page errors, console errors, and failed requests seen since the call.
 */
export async function hydrated(page: Page): Promise<void> {
  const watching = watch(page);
  try {
    await waitForHydration(page, watching);
  } finally {
    watching.stop();
  }
}

/** Opens `path` and waits for hydration before a test drives the page. */
export async function ready(page: Page, path: string): Promise<void> {
  const watching = watch(page);
  try {
    await page.goto(path);
    await waitForHydration(page, watching);
  } finally {
    watching.stop();
  }
}
