<script lang="ts">
	import { live } from '$lib/client/live.svelte';
	import type { SlotEntry } from '$lib/plugins/types';
	import SlotContent from '$lib/components/wh/plugins/SlotContent.svelte';

	let { entry }: { entry: SlotEntry } = $props();
</script>

{#snippet pluginSection(entry: SlotEntry)}
	<section class="rounded-xl border p-4" aria-label={entry.title} data-slot="task.section">
		<h2 class="mb-3 text-sm font-medium">{entry.title}</h2>
		<SlotContent {entry} now={live.now} />
	</section>
{/snippet}

{@render pluginSection(entry)}
