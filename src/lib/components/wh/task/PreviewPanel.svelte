<script lang="ts">
	import LivePreview from '$lib/components/wh/LivePreview.svelte';
	import PreviewHelper from '$lib/components/wh/PreviewHelper.svelte';
	import type { Pointer } from '$lib/previewhelper';
	import type { TaskSummary } from '$lib/types';

	let {
		task,
		shown,
		onfullscreen
	}: {
		task: TaskSummary;
		/** Whether the preview is on screen here: its tab is open and it is not full screen. */
		shown: boolean;
		onfullscreen: () => void;
	} = $props();

	// The preview helper's Point, shared with the page beside it.
	let pointing = $state(false);
	let pointed = $state<{ pointer: Pointer; at: { x: number; y: number } } | null>(null);
</script>

{#snippet previewPanel(task: TaskSummary)}
	<!-- The worker's reported preview, embedded, beside a helper to talk it through before any
	     feedback goes to the worker (work that has landed has no worker to send it to). -->
	{#if task.preview}
		<section aria-labelledby="live-preview">
			<h2 id="live-preview" class="sr-only">Live preview</h2>
			{#if shown}
				{@const talk = task.status !== 'landed'}
				<!-- Side by side on a wide screen; below it, under the page (Full screen puts them side by side). -->
				<div class="grid gap-4 {talk ? '2xl:grid-cols-[minmax(0,1fr)_24rem]' : ''}">
					<LivePreview
						taskId={task.id}
						pointing={talk && pointing}
						pin={pointed?.at ?? null}
						onpoint={(p, at) => {
							pointed = { pointer: p, at };
							pointing = false;
						}}
						{onfullscreen}
					/>
					{#if talk}
						<div class="flex h-[34rem] flex-col 2xl:mt-[1.875rem] 2xl:h-[70vh] 2xl:min-h-80">
							<PreviewHelper {task} url={task.preview.url} bind:pointing bind:attached={pointed} />
						</div>
					{/if}
				</div>
			{/if}
		</section>
	{/if}
{/snippet}

{@render previewPanel(task)}
