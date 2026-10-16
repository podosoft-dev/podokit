---
"@podosoft/podokit": minor
---

Let `sidebar-user-menu.svelte` render outside the admin sidebar. Inside a `Sidebar.Provider` it stays the sidebar menu item; elsewhere it renders the shell-independent `AccountMenu` identity block with the same account and sign-out actions instead of failing on the missing sidebar state.
