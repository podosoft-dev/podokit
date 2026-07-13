<script lang="ts">
  // Admin Appearance settings: pick a theme preset, an accent color, a corner
  // radius, and (advanced) per-token overrides. Applies live across the app on
  // save; the two preview panels show light + dark with the pending values.
  import * as Card from "$lib/components/ui/card";
  import * as Select from "$lib/components/ui/select";
  import { Button } from "$lib/components/ui/button";
  import { Label } from "$lib/components/ui/label";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { toast } from "svelte-sonner";
  import { api } from "$lib/api";
  import { getI18n } from "$lib/i18n";
  import { site, type SiteSettings } from "$lib/site.svelte";
  import { themePresets, THEME_TOKEN_KEYS, findPreset, type ThemeTokens, type ThemePreset } from "$lib/site/themes";
  import {
    applyTheme,
    buildVarString,
    effectiveTokens,
    parseOverrides,
    type ThemeConfig,
    type ThemeOverrides,
    type ThemeMode,
  } from "$lib/site/apply-theme";

  const i18n = getI18n();
  const t = $derived(i18n.t.general);
  const MODES: ThemeMode[] = ["light", "dark"];

  const s = $derived(site.value);
  let preset = $state("default");
  let brandColor = $state("");
  let radius = $state(""); // "" = inherit app default
  let radiusNum = $state(0.5); // slider position (display)
  let overrides = $state<ThemeOverrides>({ light: {}, dark: {} });
  let advancedOpen = $state(false);
  let previewMode = $state<ThemeMode>("light"); // which mode the preview shows
  let seeded = $state(false);
  $effect(() => {
    if (seeded) return;
    preset = s.themePreset || "default";
    brandColor = s.brandColor ?? "";
    radius = s.themeRadius ?? "";
    radiusNum = radius ? Number(radius) : 0.5;
    const parsed = parseOverrides(s.themeOverrides);
    overrides = { light: { ...(parsed?.light ?? {}) }, dark: { ...(parsed?.dark ?? {}) } };
    seeded = true;
  });

  const config = $derived<ThemeConfig>({
    preset,
    brandColor: brandColor || null,
    radius: radius || null,
    overrides,
  });
  const lightVars = $derived(buildVarString(effectiveTokens(config, "light"), config.brandColor, config.radius));
  const darkVars = $derived(buildVarString(effectiveTokens(config, "dark"), config.brandColor, config.radius));
  const selectedPreset = $derived(findPreset(preset));

  function tokenValue(mode: ThemeMode, key: keyof ThemeTokens): string {
    return overrides[mode]?.[key] ?? findPreset(preset)?.[mode]?.[key] ?? "#808080";
  }
  function setToken(mode: ThemeMode, key: keyof ThemeTokens, value: string): void {
    overrides = { ...overrides, [mode]: { ...(overrides[mode] ?? {}), [key]: value } };
  }
  function selectPreset(key: string): void {
    preset = key;
    overrides = { light: {}, dark: {} }; // switching preset clears per-token tweaks
  }
  function onRadius(v: number): void {
    radiusNum = v;
    radius = String(v);
  }

  let saving = $state(false);
  function cleanOverrides(): ThemeOverrides {
    const pick = (o?: Partial<ThemeTokens>): Partial<ThemeTokens> | undefined => {
      if (!o) return undefined;
      const entries = Object.entries(o).filter(([, v]) => Boolean(v));
      return entries.length ? (Object.fromEntries(entries) as Partial<ThemeTokens>) : undefined;
    };
    const out: ThemeOverrides = {};
    const l = pick(overrides.light);
    if (l) out.light = l;
    const d = pick(overrides.dark);
    if (d) out.dark = d;
    return out;
  }
  async function save(): Promise<void> {
    saving = true;
    try {
      const ov = cleanOverrides();
      const payload: Record<string, string> = {
        themePreset: preset === "default" ? "" : preset,
        brandColor,
        themeRadius: radius,
        themeOverrides: ov.light || ov.dark ? JSON.stringify(ov) : "",
      };
      await api.put("/site/settings", payload);
      site.patch(payload as Partial<SiteSettings>);
      applyTheme(config); // live across the whole app
      toast.success(t.saved);
    } catch {
      toast.error(t.saveError);
    } finally {
      saving = false;
    }
  }

  // Reset every theme setting and persist — the app reverts to its app.css defaults.
  async function restoreDefaults(): Promise<void> {
    preset = "default";
    brandColor = "";
    radius = "";
    radiusNum = 0.5;
    overrides = { light: {}, dark: {} };
    await save();
  }
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>{t.appearanceTitle}</Card.Title>
    <Card.Description>{t.appearanceDesc}</Card.Description>
  </Card.Header>
  <Card.Content class="flex flex-col gap-5">
    <!-- Preset (shadcn Select) -->
    <div class="flex flex-col gap-1.5">
      <Label for="theme-preset">{t.themePreset}</Label>
      <Select.Root type="single" bind:value={preset} onValueChange={(v) => v && selectPreset(v)}>
        <Select.Trigger id="theme-preset" class="w-full max-w-xs">
          <span class="flex items-center gap-2 truncate">
            {@render presetSwatch(selectedPreset)}
            <span class="truncate">{selectedPreset?.label ?? preset}</span>
          </span>
        </Select.Trigger>
        <Select.Content>
          {#each themePresets as p (p.key)}
            <Select.Item value={p.key} label={p.label}>
              {@render presetSwatch(p)}
              <span class="truncate">{p.label}</span>
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>

    <!-- Accent color (brandColor) -->
    <div class="flex flex-col gap-1.5">
      <Label for="accent-color">{t.accentColor}</Label>
      <div class="flex items-center gap-2">
        <input
          id="accent-color"
          type="color"
          value={brandColor || "#6d28d9"}
          oninput={(e) => (brandColor = e.currentTarget.value)}
          class="border-border size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
        />
        <input
          type="text"
          bind:value={brandColor}
          placeholder="#6d28d9"
          class="border-input bg-background w-32 rounded-md border px-2 py-1 font-mono text-sm"
        />
        {#if brandColor}
          <Button variant="ghost" size="sm" onclick={() => (brandColor = "")}>×</Button>
        {/if}
      </div>
      <p class="text-muted-foreground text-xs">{t.accentColorHint}</p>
    </div>

    <!-- Radius -->
    <div class="flex flex-col gap-1.5">
      <Label for="theme-radius">{t.radius}: {radiusNum}rem</Label>
      <input
        id="theme-radius"
        type="range"
        min="0"
        max="1.5"
        step="0.025"
        value={radiusNum}
        oninput={(e) => onRadius(Number(e.currentTarget.value))}
        class="w-full max-w-xs"
      />
    </div>

    <!-- Preview — toggle light/dark (pending values, no global change) -->
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <Label>{t.preview}</Label>
        <div class="border-border flex overflow-hidden rounded-md border">
          <button
            type="button"
            onclick={() => (previewMode = "light")}
            class="px-3 py-1 text-xs {previewMode === 'light' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}"
          >{t.previewLight}</button>
          <button
            type="button"
            onclick={() => (previewMode = "dark")}
            class="px-3 py-1 text-xs {previewMode === 'dark' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}"
          >{t.previewDark}</button>
        </div>
      </div>
      {@render previewPanel(previewMode === "light" ? lightVars : darkVars, previewMode === "dark")}
    </div>

    <!-- Advanced per-token overrides -->
    <Collapsible.Root bind:open={advancedOpen}>
      <Collapsible.Trigger
        class="text-muted-foreground hover:text-foreground w-fit text-sm font-medium underline-offset-2 hover:underline"
      >
        {advancedOpen ? t.advancedHide : t.advanced}
      </Collapsible.Trigger>
      <Collapsible.Content class="flex flex-col gap-4 pt-3">
        {#each MODES as mode (mode)}
          <div class="flex flex-col gap-2">
            <p class="text-muted-foreground font-mono text-[10px] uppercase tracking-widest">
              {mode === "light" ? t.previewLight : t.previewDark}
            </p>
            <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {#each THEME_TOKEN_KEYS as key (key)}
                <label class="flex items-center gap-1.5 text-xs">
                  <input
                    type="color"
                    value={tokenValue(mode, key)}
                    oninput={(e) => setToken(mode, key, e.currentTarget.value)}
                    class="border-border size-6 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
                  />
                  <span class="text-muted-foreground truncate">{t.themeTokens[key]}</span>
                </label>
              {/each}
            </div>
          </div>
        {/each}
        <Button variant="outline" size="sm" class="w-fit" onclick={() => (overrides = { light: {}, dark: {} })}>
          {t.resetTheme}
        </Button>
      </Collapsible.Content>
    </Collapsible.Root>

    <div class="flex flex-wrap items-center gap-2">
      <Button onclick={save} disabled={saving}>{saving ? t.saving : t.saveTheme}</Button>
      <Button variant="outline" onclick={restoreDefaults} disabled={saving}>{t.restoreDefaults}</Button>
    </div>
  </Card.Content>
</Card.Root>

{#snippet presetSwatch(p: ThemePreset | undefined)}
  <span class="flex shrink-0 gap-0.5" aria-hidden="true">
    {#if p?.light}
      <span class="size-3.5 rounded-full border border-black/10" style="background:{p.light.background}"></span>
      <span class="size-3.5 rounded-full border border-black/10" style="background:{p.light.primary}"></span>
    {:else}
      <span class="bg-background border-border size-3.5 rounded-full border"></span>
      <span class="bg-primary size-3.5 rounded-full"></span>
    {/if}
  </span>
{/snippet}

{#snippet previewPanel(vars: string, dark: boolean)}
  <div class="border-border overflow-hidden rounded-md border">
    <div class="bg-background text-foreground flex flex-col gap-2 p-3 {dark ? 'dark' : ''}" style={vars}>
      <div class="bg-card border-border flex flex-col gap-1 rounded-md border p-2.5">
        <p class="text-sm font-medium">{t.previewHeading}</p>
        <p class="text-muted-foreground text-xs">{t.previewBody}</p>
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="bg-primary text-primary-foreground rounded px-2 py-1 text-xs">{t.previewPrimary}</span>
        <span class="border-border rounded border px-2 py-1 text-xs">{t.previewOutline}</span>
        <span class="bg-secondary text-secondary-foreground rounded px-2 py-1 text-xs">{t.previewBadge}</span>
      </div>
    </div>
  </div>
{/snippet}
