<script lang="ts">
	import { onMount } from 'svelte';
	import { live } from '$lib/client/live.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { slotKey } from '$lib/plugins/keys';
	import type { Block } from '$lib/plugins/types';
	import BarePanel from './BarePanel.svelte';
	import Blocks from './Blocks.svelte';

	/**
	 * Plugins' actions beside a task's live preview (the preview.actions slot),
	 * each a small inline item in the row it is drawn in: a preview's toolbar,
	 * a chat preview card's footer, the full-screen header. The task's entries
	 * are loaded in the browser and refreshed as the fleet changes; only this
	 * slot's are drawn.
	 * Each item sits above what follows the row, and nothing around it clips,
	 * so an element can open a small popover or panel below it. Core only
	 * draws them; it never changes the preview itself.
	 */
	let { taskId }: { taskId: string } = $props();

	const key = $derived(slotKey.task(taskId));
	const entries = $derived(
		slots.entries(key, undefined, 0).filter((e) => e.slot === 'preview.actions')
	);

	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});
	$effect(() => {
		void live.revision;
		slots.refresh(key, 0);
	});
</script>

{#if mounted}
	{#each entries as e (e.key)}
		<span
			class="relative z-20 inline-flex shrink-0 items-center gap-1"
			data-slot="preview.actions"
			data-preview-action={e.key}
		>
			{#if !e.content.available}
				<span class="text-muted-foreground" title="Not available. {e.content.reason}"
					>{e.title} not available</span
				>
			{:else if 'blocks' in e.render}
				<Blocks blocks={e.content.value as Block[]} />
			{:else}
				<BarePanel entry={e} />
			{/if}
		</span>
	{/each}
{/if}
