<script lang="ts">
	import { live } from '$lib/client/live.svelte';
	import { ago } from '$lib/format';
	import type { TaskShot } from '$lib/taskpage';
	import type { TaskEvidence } from '$lib/types';
	import { ImageOff } from '@lucide/svelte';
	import { source } from './snippets.svelte';

	let {
		shots,
		ev,
		onshot
	}: {
		shots: TaskShot[];
		ev: TaskEvidence | null;
		/** Enlarge the screenshot at this index. */
		onshot: (index: number) => void;
	} = $props();
</script>

{#snippet screenshotsPanel()}
	{#if shots.length}
		<div class="flex flex-wrap gap-4">
			{#each shots as s, i (s.url)}
				<button
					type="button"
					class="w-48 shrink-0 cursor-zoom-in text-left"
					onclick={() => onshot(i)}
					aria-label="Enlarge {s.name}"
				>
					<img
						src={s.url}
						alt={s.name}
						loading="lazy"
						class="aspect-[16/10] w-full rounded-lg border object-cover object-top"
					/>
					<p class="mt-1.5 truncate text-xs text-muted-foreground">
						{s.name}{s.modifiedAt ? ` · ${ago(s.modifiedAt, live.now)}` : ''}
					</p>
				</button>
			{/each}
		</div>
		{#if ev}{@render source(ev.screenshots)}{/if}
	{:else}
		<div
			class="grid min-h-60 place-items-center rounded-xl border border-dashed bg-muted/30 p-6 text-center text-muted-foreground"
		>
			<div>
				<ImageOff class="mx-auto size-6" aria-hidden="true" />
				<p class="mt-2 text-sm font-medium">No screenshots saved</p>
				<p class="mt-1 text-xs">
					{ev && !ev.screenshots.available
						? ev.screenshots.reason
						: 'The worker has not saved any screenshots for this task.'}
				</p>
			</div>
		</div>
	{/if}
{/snippet}

{@render screenshotsPanel()}
