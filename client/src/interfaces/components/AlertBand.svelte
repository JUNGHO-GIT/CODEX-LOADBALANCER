<script lang="ts">
  import { Server } from "lucide-svelte";

  export let message: string;
</script>

<section class="alert-band">
  <Server size={18} />
  <span>{message}</span>
</section>
