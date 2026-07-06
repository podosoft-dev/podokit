<script lang="ts">
  import { page } from "$app/state";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import SidebarUserMenu from "./sidebar-user-menu.svelte";
  import LayoutDashboardIcon from "@lucide/svelte/icons/layout-dashboard";
  import UsersIcon from "@lucide/svelte/icons/users";
  import MonitorSmartphoneIcon from "@lucide/svelte/icons/monitor-smartphone";
  import UserCogIcon from "@lucide/svelte/icons/user-cog";
  import { getI18n } from "$lib/i18n";
  import type { SessionUser } from "../../app.d.ts";
  import type { Messages } from "$lib/i18n/messages";
  import type { Component } from "svelte";

  let { user }: { user: SessionUser } = $props();
  const i18n = getI18n();

  type NavItem = { href: string; key: keyof Messages["nav"]; icon: Component; adminOnly?: boolean };
  const items: NavItem[] = [
    { href: "/dashboard", key: "overview", icon: LayoutDashboardIcon },
    { href: "/dashboard/users", key: "users", icon: UsersIcon, adminOnly: true },
    { href: "/dashboard/sessions", key: "sessions", icon: MonitorSmartphoneIcon },
    { href: "/dashboard/account", key: "account", icon: UserCogIcon },
  ];
  const visible = $derived(items.filter((item) => !item.adminOnly || user.role === "admin"));
</script>

<Sidebar.Root collapsible="icon">
  <Sidebar.Header>
    <div
      data-testid="sidebar-brand"
      class="flex items-center gap-2 overflow-hidden px-2 py-1 font-semibold whitespace-nowrap group-data-[collapsible=icon]:hidden"
    >
      {i18n.t.common.appName}
    </div>
  </Sidebar.Header>
  <Sidebar.Content>
    <Sidebar.Group>
      <Sidebar.Menu>
        {#each visible as item (item.href)}
          <Sidebar.MenuItem>
            <Sidebar.MenuButton isActive={page.url.pathname === item.href} tooltipContent={i18n.t.nav[item.key]}>
              {#snippet child({ props })}
                <a href={item.href} {...props}>
                  <item.icon />
                  <span>{i18n.t.nav[item.key]}</span>
                </a>
              {/snippet}
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
        {/each}
      </Sidebar.Menu>
    </Sidebar.Group>
  </Sidebar.Content>
  <Sidebar.Footer>
    <SidebarUserMenu {user} />
  </Sidebar.Footer>
</Sidebar.Root>
