<script lang="ts">
	import { clock } from '$lib/format';
	import { duration } from '$lib/insights';
	import { failed as failedEvent, type HowItWorked, type WorkEventKind } from '$lib/howitworked';
	import { Bot, CircleAlert, FilePen, Plug, Sparkles, SquareTerminal } from '@lucide/svelte';
	import type { Component } from 'svelte';

	/**
	 * How the worker worked, from its own session: the skills it used, its MCP calls,
	 * commands, edits and subagents, in order, with a summary above. Only names, counts and
	 * first lines are shown, never what a tool returned. Read when the tab opens.
	 */
	let { taskId, shown }: { taskId: string; shown: boolean } = $props();

	let data = $state<{ id: string; value: HowItWorked } | null>(null);
	let failedFor = $state<string | null>(null);
	const failed = $derived(failedFor === taskId ? 'Could not read how this worker worked.' : null);
	const how = $derived(data?.id === taskId ? data.value : null);

	$effect(() => {
		if (!shown || data?.id === taskId) return;
		const want = taskId;
		// A new read starts clean: an earlier failure must not hide what this one finds.
		failedFor = null;
		fetch(`/api/tasks/${encodeURIComponent(want)}/how`)
			.then(async (r) => (r.ok ? ((await r.json()) as HowItWorked) : Promise.reject(r.status)))
			.then((v) => {
				if (want !== taskId) return;
				data = { id: want, value: v };
				failedFor = null;
			})
			.catch(() => {
				if (want === taskId) failedFor = want;
			});
	});

	const ICON: Record<WorkEventKind, Component> = {
		skill: Sparkles,
		mcp: Plug,
		bash: SquareTerminal,
		edit: FilePen,
		agent: Bot
	};
	const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
</script>

<section class="max-w-3xl space-y-6" aria-label="How it worked">
	{#if failed}
		<p class="text-sm text-muted-foreground">{failed}</p>
	{:else if !how}
		<p class="text-sm text-muted-foreground">Reading the worker’s session…</p>
	{:else if !how.available}
		<p class="text-sm text-muted-foreground" data-how-unavailable>{how.reason}</p>
	{:else}
		{@const s = how.summary}
		<div class="rounded-xl border p-4" data-how-summary>
			<dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
				<div>
					<dt class="text-xs text-muted-foreground">Skills used</dt>
					<dd>{Object.keys(s.skills).length}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">MCP calls</dt>
					<dd>{Object.values(s.mcp).reduce((a, m) => a + m.calls, 0)}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">Commands</dt>
					<dd>
						{s.bash.runs}{#if s.bash.failed}<span class="text-danger">
								· {s.bash.failed} failed</span
							>{/if}
					</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">Editing-tool calls</dt>
					<dd>{s.edits} to {s.files} {s.files === 1 ? 'file' : 'files'}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">Subagents</dt>
					<dd>{s.agents}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">Tokens</dt>
					<dd>{k(s.tokens.input)} in · {k(s.tokens.output)} out</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">Sessions</dt>
					<dd>{s.sessions}</dd>
				</div>
			</dl>
			{#if how.git?.available}
				<p class="mt-3 text-sm">
					Changed in git: {how.git.value.total}
					{how.git.value.total === 1 ? 'file' : 'files'}
					<span class="text-xs text-muted-foreground">against {how.git.value.base}</span>
				</p>
				{#if how.git.value.files.length}
					<ul class="mt-1 text-xs text-muted-foreground" aria-label="Git changed files">
						{#each how.git.value.files.slice(0, 20) as file, i (i)}
							<li><code>{file.path}</code></li>
						{/each}
					</ul>
					{#if how.git.value.total > 20}<p class="text-xs text-muted-foreground">
							Showing the first 20 files.
						</p>{/if}
				{/if}
				{#if how.git.value.total !== s.files}<p class="text-xs text-muted-foreground">
						Git changes differ from editing-tool counts. Commands such as Bash or Python can change
						files without an editing-tool call.
					</p>{/if}
			{:else if how.git}<p class="mt-3 text-xs text-muted-foreground">
					Git changes unavailable: {how.git.reason}
				</p>{/if}
			{#if Object.keys(s.skills).length}
				<p class="mt-3 text-sm">
					{#each Object.entries(s.skills) as [name, n], i (name)}{i ? ', ' : ''}<code
							class="font-mono text-xs">{name}</code
						>{n > 1 ? ` ×${n}` : ''}{/each}
				</p>
			{/if}
			<p class="mt-3 text-xs text-muted-foreground">
				From the worker’s Claude Code session, matched by {how.matchedBy}. Names and first lines
				only.
			</p>
		</div>

		{#if how.driftReasons?.length}<p class="text-sm text-warning" data-drift>
				Playbook changed since dispatch: {how.driftReasons.join(', ')}.
			</p>{/if}
		{#if how.conformance}
			{@const c = how.conformance}
			<div class="rounded-xl border p-4" data-conformance>
				<h3 class="text-sm font-medium">
					Against its playbook <span class="font-normal text-muted-foreground">({c.pack})</span>
				</h3>
				<ul class="mt-2 space-y-1 text-sm">
					{#if c.unused.length}
						<li class="text-warning" data-unused>
							Given, never used: {#each c.unused as n, i (n)}{i ? ', ' : ''}<code
									class="font-mono text-xs">{n}</code
								>{/each}
						</li>
					{:else}
						<li class="text-success">Used every skill its playbook gave it.</li>
					{/if}
					{#if c.outside.length}
						<li data-outside>
							Used, not in its playbook: {#each c.outside as n, i (n)}{i ? ', ' : ''}<code
									class="font-mono text-xs">{n}</code
								>{/each}
						</li>
					{/if}
					{#if c.mcpOutside?.length}
						<li data-mcp-outside>
							MCP servers called, not in its playbook: {c.mcpOutside.join(', ')}
						</li>
					{/if}
				</ul>
				<p class="mt-2 text-xs text-muted-foreground">{c.basis}</p>
			</div>
		{/if}

		<div>
			<h3 class="section-label">Timeline</h3>
			{#if how.dropped}
				<p class="mt-1 text-xs text-muted-foreground">
					The {how.dropped} earliest steps are left out; the latest {how.events.length} are shown.
				</p>
			{/if}
			<ol class="mt-3 space-y-1.5 text-sm" data-how-timeline>
				{#each how.events as e, i (i)}
					{@const Icon = ICON[e.kind]}
					<li
						class="grid grid-cols-[4.5rem_1rem_minmax(0,1fr)] items-baseline gap-2"
						data-kind={e.kind}
					>
						<time class="tabular text-xs text-muted-foreground" datetime={e.at ?? undefined}
							>{e.at ? clock(e.at) : ''}</time
						>
						<Icon
							class="size-3.5 self-center {failedEvent(e)
								? 'text-danger'
								: 'text-muted-foreground'}"
							aria-hidden="true"
						/>
						<span class="min-w-0 truncate" title={e.line ?? e.name}>
							<span class="font-medium">{e.name}</span>
							{#if e.line}<span class="font-mono text-xs text-muted-foreground">
									{e.line}</span
								>{/if}
							{#if failedEvent(e)}<span class="text-xs text-danger">
									· {e.exit !== null && e.exit !== 0 ? `exit ${e.exit}` : 'failed'}</span
								>{/if}
							{#if e.durationMs !== null && e.durationMs >= 1000}<span
									class="text-xs text-muted-foreground"
								>
									· {duration(e.durationMs / 1000)}</span
								>{/if}
						</span>
					</li>
				{/each}
			</ol>
			{#if !how.events.length}
				<p class="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
					<CircleAlert class="size-4" aria-hidden="true" />The session used no tools worth listing.
				</p>
			{/if}
		</div>
	{/if}
</section>
