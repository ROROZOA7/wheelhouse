<script lang="ts">
	import { currentHealth } from '$lib/client/live.svelte';
	import { clock } from '$lib/format';
	import { plainStatus } from '$lib/plain';
	import OutputInspector from '$lib/components/wh/OutputInspector.svelte';
	import RawDetails from '$lib/components/wh/RawDetails.svelte';
	import type { TaskDetail, TaskSummary, TimelineEntry } from '$lib/types';
	import { source, unavailable } from './snippets.svelte';

	let {
		task,
		detail,
		sampling
	}: {
		task: TaskSummary;
		detail: TaskDetail;
		/** Whether the Log tab is open, so the worker's output is sampled. */
		sampling: boolean;
	} = $props();

	// Without Firstmate's fleet ledger there is no history; say how to turn it on.
	const historyOff = $derived(currentHealth()?.ledger.available === false);

	// Ledger entries other than status lines, in plain words (PR links become their number).
	const entryText = (e: TimelineEntry) => {
		const n = /\/pull\/(\d+)/.exec(e.text)?.[1];
		if (e.kind === 'pr-ready') return `Pull request${n ? ` #${n}` : ''} ready`;
		if (e.kind === 'merged') return n ? `Merged pull request #${n}` : e.text;
		return e.text;
	};
</script>

{#snippet logPanel(task: TaskSummary, detail: TaskDetail)}
	<section class="max-w-3xl space-y-4" aria-labelledby="ships-log">
		<div class="rounded-xl border">
			<div class="flex flex-wrap items-baseline gap-x-2 px-4 py-3 text-sm">
				<h2
					id="ships-log"
					class="font-display text-[1.2rem] font-medium tracking-[0.1em] text-muted-foreground [font-variant-caps:all-small-caps]"
				>
					Ship’s log
				</h2>
				<span class="text-muted-foreground"
					>what the crew reported, oldest first (history, not current state)</span
				>
			</div>
			<div class="border-t p-4">
				{#if detail.timeline.available}
					<ol class="space-y-2 text-sm">
						{#each detail.timeline.value as e, i (i)}
							{@const plain = e.kind === 'status' ? plainStatus(e.state, e.text) : null}
							<li class="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
								<time class="tabular text-xs text-muted-foreground" datetime={e.at} title={e.at}
									>{clock(e.at)}</time
								>
								<div class="min-w-0 break-words">
									{#if plain}
										<p>{plain}</p>
										<RawDetails raw={e.state ? `${e.state}: ${e.text.trim()}` : e.text} {plain} />
									{:else}
										<p>{entryText(e)}</p>
									{/if}
								</div>
							</li>
						{/each}
					</ol>
					{@render source(detail.timeline)}
				{:else}
					{@render unavailable(detail.timeline)}
					{#if historyOff}
						<p class="mt-1.5 text-sm" data-history-off>
							History is off: enable <code class="font-mono text-xs">config/fleet-ledger</code> in Firstmate
							to keep it.
						</p>
					{/if}
				{/if}
			</div>
		</div>
		<OutputInspector {task} live={sampling} />
		{#if detail.gaps.length}
			<div class="rounded-xl border border-dashed p-4 text-sm">
				<p class="font-medium">Not available yet</p>
				<ul class="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
					{#each detail.gaps as g (g)}<li>{g}</li>{/each}
				</ul>
			</div>
		{/if}
	</section>
{/snippet}

{@render logPanel(task, detail)}
