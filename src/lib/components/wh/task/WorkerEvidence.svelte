<script lang="ts">
	import type { WorkerEvidence } from '$lib/worker-evidence';
	let { value }: { value: WorkerEvidence | null | undefined } = $props();
</script>

{#if value}
	<section aria-label="Worker evidence" class="my-3 rounded-md border p-3 text-sm">
		<h3 class="font-medium">Worker evidence</h3>
		<p class="text-xs text-muted-foreground">
			Source: data/&lt;task&gt;/evidence.json · {value.source}
		</p>
		{#if !value.ok}
			<p class="mt-2 font-medium text-destructive">Evidence does not follow fm-evidence.v1</p>
			<ul class="list-disc pl-5">
				{#each value.problems as p, i (i)}<li>{p.code}: {p.detail}</li>{/each}
			</ul>
			{#each value.decisions.filter((d) => d.open) as d, i (i)}
				<p class="mt-2">
					<strong>Open human gate</strong> (unvalidated record) · {d.choice}: {d.why}
				</p>
			{/each}
		{/if}
		{#if value.warnings.length}
			<ul class="mt-2 text-muted-foreground">
				{#each value.warnings as p, i (i)}<li>Warning: {p.detail}</li>{/each}
			</ul>
		{/if}
		{#if value.ok}
			{#if value.commands.length}
				<h4 class="mt-2 font-medium">Verify commands</h4>
				<ul>
					{#each value.commands as c, i (i)}<li>
							<code>{c.cmd}</code> · {c.exit === null
								? `Not run: ${c.skipped_reason}`
								: c.exit === 0
									? 'Passed (exit 0)'
									: `Failed (exit ${c.exit})`}
						</li>{/each}
				</ul>
			{/if}
			{#if value.decisions.length}
				<h4 class="mt-2 font-medium">Recorded decisions</h4>
				<ul>
					{#each value.decisions as d, i (i)}<li class="mt-1">
							<strong>{d.open ? 'Open human gate' : 'Settled decision'}</strong> · {d.rung} · {d.choice}:
							{d.why}
						</li>{/each}
				</ul>
			{/if}
		{/if}
	</section>
{/if}
