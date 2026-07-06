<script lang="ts">
  import { page } from "$app/state";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import SidebarUserMenu from "./sidebar-user-menu.svelte";
  import LayoutDashboardIcon from "@lucide/svelte/icons/layout-dashboard";
  import UsersIcon from "@lucide/svelte/icons/users";
  import MonitorSmartphoneIcon from "@lucide/svelte/icons/monitor-smartphone";
  import UserCogIcon from "@lucide/svelte/icons/user-cog";
  import type { SessionUser } from "../../app.d.ts";
  import type { Component } from "svelte";

  let { user }: { user: SessionUser } = $props();

  type NavItem = { href: string; label: string; icon: Component; adminOnly?: boolean };
  const items: NavItem[] = [
    { href: "/dashboard", label: "Overview", icon: LayoutDashboardIcon },
    { href: "/dashboard/users", label: "Users", icon: UsersIcon, adminOnly: true },
    { href: "/dashboard/sessions", label: "Sessions", icon: MonitorSmartphoneIcon },
    { href: "/dashboard/account", label: "Account", icon: UserCogIcon },
  ];
  const visible = $derived(items.filter((item) => !item.adminOnly || user.role === "admin"));
</script>

<Sidebar.Root collapsible="icon">
  <Sidebar.Header>
    <div class="flex items-center gap-2 px-2 py-1 font-semibold">Admin</div>
  </Sidebar.Header>
  <Sidebar.Content>
    <Sidebar.Group>
      <Sidebar.Menu>
        {#each visible as item (item.href)}
          <Sidebar.MenuItem>
            <Sidebar.MenuButton isActive={page.url.pathname === item.href} tooltipContent={item.label}>
              {#snippet child({ props })}
                <a href={item.href} {...props}>
                  <item.icon />
                  <span>{item.label}</span>
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
