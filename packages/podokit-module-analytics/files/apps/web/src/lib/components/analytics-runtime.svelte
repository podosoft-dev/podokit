<script lang="ts">
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import CookieIcon from "@lucide/svelte/icons/cookie";
  import { Button } from "$lib/components/ui/button";
  import * as Card from "$lib/components/ui/card";
  import {
    registerAnalyticsRuntime,
    type AnalyticsConsent,
    type AnalyticsEventParams,
  } from "$lib/analytics";
  import { analyticsAppConfig } from "$lib/analytics.config";
  import type { AnalyticsPublicConfig } from "$lib/analytics/types";
  import { getI18n } from "$lib/i18n";

  const CONSENT_KEY = "podokit.analytics.consent.v1";
  const SCRIPT_ID = "podokit-google-analytics";
  const i18n = getI18n();

  type Gtag = (...args: unknown[]) => void;
  type AnalyticsWindow = Window & {
    dataLayer?: unknown[][];
    gtag?: Gtag;
  };

  let config = $state<AnalyticsPublicConfig | null>(null);
  let consent = $state<AnalyticsConsent>("unset");
  let showConsent = $state(false);
  let ready = $state(false);
  let lastPath = "";

  function analyticsWindow(): AnalyticsWindow {
    return window as AnalyticsWindow;
  }

  function gtag(...args: unknown[]): void {
    const target = analyticsWindow();
    target.dataLayer ??= [];
    target.dataLayer.push(args);
  }

  function excluded(pathname: string): boolean {
    return analyticsAppConfig.excludedPathPrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
  }

  function sendEvent(
    name: string,
    params: AnalyticsEventParams | undefined,
  ): void {
    if (!ready) return;
    gtag("event", name, params ?? {});
  }

  function storeConsent(next: Exclude<AnalyticsConsent, "unset">): void {
    consent = next;
    localStorage.setItem(CONSENT_KEY, next);
    gtag("consent", "update", {
      analytics_storage: next,
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    showConsent = false;
  }

  function openConsent(): void {
    showConsent = true;
  }

  function initialize(measurementId: string): void {
    const target = analyticsWindow();
    target.dataLayer ??= [];
    target.gtag = gtag;
    const stored = localStorage.getItem(CONSENT_KEY);
    consent = stored === "granted" || stored === "denied" ? stored : "unset";
    gtag("consent", "default", {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      wait_for_update: 500,
    });
    if (consent !== "unset") {
      gtag("consent", "update", {
        analytics_storage: consent,
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
    }
    gtag("set", "ads_data_redaction", true);
    gtag("config", measurementId, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });

    showConsent = consent === "unset";

    if (!document.getElementById(SCRIPT_ID)) {
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
      document.head.append(script);
    }
    ready = true;
    registerAnalyticsRuntime(sendEvent, openConsent);
  }

  onMount(() => {
    let cancelled = false;
    registerAnalyticsRuntime(null, openConsent);
    void fetch("/api/analytics/config")
      .then(async (response): Promise<AnalyticsPublicConfig | null> => {
        if (!response.ok) return null;
        return response.json() as Promise<AnalyticsPublicConfig>;
      })
      .then((loaded) => {
        if (cancelled) return;
        config = loaded;
        if (loaded?.enabled && loaded.measurementId) {
          initialize(loaded.measurementId);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      registerAnalyticsRuntime(null, null);
    };
  });

  $effect(() => {
    const pathname = page.url.pathname;
    if (!ready || !config?.measurementId || excluded(pathname)) return;
    const mapped = analyticsAppConfig.mapPath(pathname);
    if (!mapped || mapped === lastPath) return;
    const location = `${window.location.origin}${mapped}`;
    const referrer = lastPath
      ? `${window.location.origin}${lastPath}`
      : undefined;
    gtag("event", "page_view", {
      page_location: location,
      page_path: mapped,
      page_title: document.title,
      ...(referrer ? { page_referrer: referrer } : {}),
    });
    lastPath = mapped;
  });
</script>

{#if ready && showConsent}
  <div
    class="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl"
    data-testid="analytics-consent"
  >
    <Card.Root class="shadow-lg">
      <Card.Header>
        <Card.Title>{i18n.t.analytics.consent.title}</Card.Title>
        <Card.Description>
          {i18n.t.analytics.consent.description}
        </Card.Description>
      </Card.Header>
      <Card.Footer class="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onclick={() => storeConsent("denied")}>
          {i18n.t.analytics.consent.continueWithoutCookies}
        </Button>
        <Button onclick={() => storeConsent("granted")}>
          {i18n.t.analytics.consent.allow}
        </Button>
      </Card.Footer>
    </Card.Root>
  </div>
{:else if ready}
  <Button
    variant="outline"
    size="icon"
    class="fixed bottom-3 left-3 z-40 rounded-full shadow-sm"
    aria-label={i18n.t.analytics.consent.settings}
    title={i18n.t.analytics.consent.settings}
    onclick={openConsent}
  >
    <CookieIcon class="size-4" />
  </Button>
{/if}
