<script lang="ts">
	/**
	 * A feedback list the captain sent from a task's Preview tab, in the chat:
	 * the captain's own card, addressed to Firstmate, with each line and the
	 * part of the page it points at, whether Firstmate has it, and its reply
	 * (lib/chat/batches.ts).
	 */
	import { CircleCheck, CircleX, LoaderCircle, MonitorPlay } from '@lucide/svelte';
	import type { ChatBatch } from '$lib/chat/batches';

	let { batch, project = null }: { batch: ChatBatch; project?: string | null } = $props();

	const time = (at: string) =>
		new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	const settled = $derived(batch.status.startsWith('Firstmate has it'));
	const waiting = $derived(!batch.failed && !settled && batch.status !== 'Sent to Firstmate');
</script>

<article
	class="msg msg-captain"
	aria-label="Your preview feedback, {time(batch.at)}"
	data-feedback-batch
>
	<span class="captain-avatar">C</span>
	<div class="min-w-0 flex-1">
		<header class="msg-head">
			<span class="msg-name">You</span><time datetime={batch.at}>{time(batch.at)}</time>
		</header>
		<div
			class="w-full max-w-[34rem] rounded-lg border border-l-[3px] border-l-sea bg-card px-4 py-3 text-left"
		>
			<header class="flex flex-wrap items-center gap-x-2 gap-y-1">
				<span
					class="flex items-center gap-1 rounded bg-sea/10 px-1.5 text-xs leading-[1.15rem] font-medium text-sea"
					><MonitorPlay class="size-3" aria-hidden="true" />To Firstmate · preview feedback</span
				>
				{#if project}
					<span
						class="rounded-sm border px-1.5 text-[0.95rem] leading-[1.15rem] font-semibold tracking-[0.08em] text-muted-foreground [font-variant-caps:all-small-caps]"
						>{project}</span
					>
				{/if}
			</header>
			<a
				href="/tasks/{encodeURIComponent(batch.batch.taskId)}?tab=preview"
				class="mt-1.5 block text-sm font-medium hover:underline">{batch.batch.title}</a
			>
			<ol class="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-snug">
				{#each batch.batch.items as it, i (i)}
					<li>
						{it.text}
						{#if it.points}<span class="mt-0.5 block text-xs text-muted-foreground"
								>Points at {it.points}</span
							>{/if}
					</li>
				{/each}
			</ol>
			<p
				class="mt-2.5 flex items-center gap-1.5 text-xs {batch.failed
					? 'text-danger'
					: 'text-muted-foreground'}"
				role="status"
			>
				{#if batch.failed}<CircleX
						class="size-3.5"
						aria-hidden="true"
					/>{:else if waiting}<LoaderCircle
						class="size-3 animate-spin"
						aria-hidden="true"
					/>{:else}<CircleCheck
						class="size-3.5 text-success"
						aria-hidden="true"
					/>{/if}{batch.status}
			</p>
			{#if batch.reply}
				<p class="mt-2 rounded-md bg-muted px-3 py-2 text-sm leading-relaxed whitespace-pre-line">
					<span class="font-medium">Firstmate:</span>
					{batch.reply}
				</p>
			{/if}
		</div>
	</div>
</article>
