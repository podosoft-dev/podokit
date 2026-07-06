<script lang="ts">
  import * as Card from "$lib/components/ui/card";
  import { getI18n, fmt } from "$lib/i18n";
  import type { SessionUser } from "../../../app.d.ts";

  let { data }: { data: { user: SessionUser } } = $props();
  const i18n = getI18n();
</script>

<div class="flex flex-col gap-6">
  <div>
    <h1 class="text-2xl font-semibold">{i18n.t.dashboard.title}</h1>
    <p class="text-muted-foreground text-sm">{fmt(i18n.t.dashboard.welcome, { name: data.user.name })}</p>
  </div>
  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    <Card.Root>
      <Card.Header><Card.Title>{i18n.t.dashboard.yourRole}</Card.Title></Card.Header>
      <Card.Content class="text-2xl font-semibold capitalize">{data.user.role ?? "user"}</Card.Content>
    </Card.Root>
    <Card.Root>
      <Card.Header><Card.Title>{i18n.t.dashboard.signedInAs}</Card.Title></Card.Header>
      <Card.Content class="text-muted-foreground truncate text-sm">{data.user.email}</Card.Content>
    </Card.Root>
  </div>
</div>
