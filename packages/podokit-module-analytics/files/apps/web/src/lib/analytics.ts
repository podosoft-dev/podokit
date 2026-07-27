export type AnalyticsConsent = "granted" | "denied" | "unset";
export type AnalyticsEventValue = string | number | boolean;
export type AnalyticsEventParams = Record<string, AnalyticsEventValue>;

export type AnalyticsAppConfig = {
  excludedPathPrefixes: readonly string[];
  mapPath: (pathname: string) => string | null;
};

type EventSender = (
  name: string,
  params: AnalyticsEventParams | undefined
) => void;

const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const FORBIDDEN_PARAMETER =
  /(?:^|_)(?:email|e_mail|phone|name|user_id|password|secret|token)(?:_|$)/;
let sender: EventSender | null = null;
let consentOpener: (() => void) | null = null;

/** Send a provider-neutral application goal. The runtime drops calls while
 * analytics is disabled or unavailable. */
export function trackAnalyticsEvent(
  name: string,
  params?: AnalyticsEventParams
): void {
  if (!NAME.test(name)) {
    throw new TypeError(
      "Analytics event names must start with a letter and contain at most 40 lowercase letters, digits, or underscores."
    );
  }
  const entries = Object.entries(params ?? {});
  if (entries.length > 25) {
    throw new TypeError("Analytics events support at most 25 parameters.");
  }
  const clean: AnalyticsEventParams = {};
  for (const [key, value] of entries) {
    if (!NAME.test(key) || FORBIDDEN_PARAMETER.test(key)) {
      throw new TypeError(`Analytics parameter is not allowed: ${key}`);
    }
    clean[key] = typeof value === "string" ? value.slice(0, 100) : value;
  }
  sender?.(name, Object.keys(clean).length ? clean : undefined);
}

/** Reopen the managed consent UI from an application-owned privacy link. */
export function openAnalyticsConsentSettings(): void {
  consentOpener?.();
}

export function registerAnalyticsRuntime(
  nextSender: EventSender | null,
  nextConsentOpener: (() => void) | null
): void {
  sender = nextSender;
  consentOpener = nextConsentOpener;
}
