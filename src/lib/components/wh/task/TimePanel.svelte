<script lang="ts">
	import { live } from '$lib/client/live.svelte';
	import { clock } from '$lib/format';
	import TimeBar from '$lib/components/wh/insights/TimeBar.svelte';
	import TimeLegend from '$lib/components/wh/insights/TimeLegend.svelte';
	import { CONFIDENCE, duration, etaLine, PHASE_LABEL } from '$lib/insights';
	import type { TaskDetail, TaskSummary } from '$lib/types';
	import { Scale, Timer } from '@lucide/svelte';

	let { task, detail }: { task: TaskSummary; detail: TaskDetail } = $props();
	const e = $derived(task.eta ?? null);
	const t = $derived(detail.time);
</script>

<section class="space-y-6" aria-label="Work time">
	{#if e && !e.openEnded}
		{@const l = etaLine(e)}
		<div class="rounded-xl border bg-card p-5">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<p class="flex items-center gap-2 text-sm text-muted-foreground">
						<Timer class="size-4" aria-hidden="true" />Until it is ready for your review
					</p>
					<p
						class="mt-1 text-2xl font-semibold tracking-tight {l.tone === 'warning'
							? 'text-warning'
							: ''}"
					>
						{l.text}
					</p>
					{#if e.minutes !== null && !e.overdue}
						<p class="mt-0.5 text-sm text-muted-foreground">
							Usually {e.low}–{e.high} min, so around {clock(
								new Date(live.now + e.minutes * 60_000).toISOString()
							)}
						</p>
					{:else if e.overdue}
						<p class="mt-0.5 text-sm text-muted-foreground">
							Similar work had reached your review by this point.
						</p>
					{/if}
				</div>
				{#if e.confidence !== 'none' && !e.overdue}
					<span class="rounded-full bg-muted px-2.5 py-1 text-xs font-medium"
						>{CONFIDENCE[e.confidence]}</span
					>
				{/if}
			</div>
			{#if e.ahead.length}
				<ol class="mt-5 space-y-2 border-t pt-4">
					{#each e.ahead as x (x.phase)}
						<li class="flex items-baseline justify-between gap-4 text-sm">
							<span class={x.current ? 'font-medium' : 'text-muted-foreground'}
								>{PHASE_LABEL[x.phase]}{#if x.current}<span
										class="font-normal text-muted-foreground"
										>{` · now, ${duration(x.spent)} in`}</span
									>{/if}</span
							>
							<span class="text-muted-foreground tabular-nums"
								>{x.usual !== null ? `usually ${duration(x.usual)}` : 'no history yet'}</span
							>
						</li>
					{/each}
				</ol>
			{/if}
			<p class="mt-4 text-xs text-muted-foreground">
				Based on {e.basis} similar {e.scope === 'project'
					? 'tasks in this project'
					: 'tasks across projects'}. A guide, not a promise: it counts work time only, not time
				waiting on you.
			</p>
		</div>
	{/if}

	{#if t && t.total > 0}
		<div>
			<div class="flex flex-wrap items-baseline justify-between gap-2">
				<h2 class="section-label flex-1">Where its time went</h2>
				<p class="text-sm text-muted-foreground">
					{duration(t.total)}{t.ongoing ? ' so far' : ''}{t.readyAfter !== null
						? ` · ready for you after ${duration(t.readyAfter)}`
						: ''}
				</p>
			</div>
			<div class="mt-3"><TimeBar seconds={t.seconds} height="h-3" label="This task" /></div>
			<div class="mt-3"><TimeLegend seconds={t.seconds} /></div>
			{#if t.reviewSteps.length}
				<details class="mt-4 rounded-lg border px-4 py-3 text-sm">
					<summary class="cursor-pointer text-muted-foreground hover:text-foreground"
						>Inside the latest automated review</summary
					>
					<ul class="mt-3 space-y-1.5">
						{#each t.reviewSteps as r (r.step)}
							<li class="flex justify-between gap-4">
								<span>{r.label}</span><span class="text-muted-foreground tabular-nums"
									>{duration(r.seconds)}</span
								>
							</li>
						{/each}
					</ul>
				</details>
			{/if}
		</div>
	{/if}

	{#if detail.decided.length}
		<div>
			<h2 class="section-label">Decided for you on this task</h2>
			<ul class="mt-3 divide-y rounded-lg border">
				{#each detail.decided as d (d.id)}
					<li>
						<a href="/decisions#{d.id}" class="flex gap-3 px-4 py-3 hover:bg-accent/40">
							<Scale class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							<span class="min-w-0 text-sm">
								<span class="font-medium">{d.verdict}</span>
								<span class="text-muted-foreground"> · {d.calls[0].question}</span>
							</span>
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</section>
