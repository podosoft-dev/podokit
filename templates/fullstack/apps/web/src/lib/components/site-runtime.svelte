<script lang="ts">
  // Modules can replace this managed component with global site behavior while
  // the surrounding route layout remains application-owned.
  import { ModeWatcher } from "mode-watcher";
</script>

<!-- `.light` on <html> in light mode lets component libraries that follow a `.dark`
     or `.light` class, and fall back to the OS setting otherwise, match the theme. -->
<ModeWatcher lightClassNames={["light"]} />
