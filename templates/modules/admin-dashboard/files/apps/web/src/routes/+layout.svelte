<script lang="ts">
  import "../app.css";
  import { ModeWatcher } from "mode-watcher";
  import { setI18nContext } from "$lib/i18n";
  import { messages, resolveLocale } from "$lib/i18n/messages";

  let { children, data } = $props();
  const locale = $derived(resolveLocale(data.locale));
  setI18nContext({
    get t() {
      return messages[locale];
    },
    get locale() {
      return locale;
    },
  });
</script>

<ModeWatcher />
{@render children()}
