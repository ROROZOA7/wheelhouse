<script lang="ts">
	import {
		codeOf,
		DELIVERY_LABEL,
		deliveryFor,
		HARNESSES,
		matrixRows,
		ORIGIN_LABEL,
		PHASE_LABEL,
		skillsByPhase,
		shortDigest,
		type Delivery,
		type PackResolve
	} from '$lib/playbooks';
	import { CircleAlert, Lock, Ban } from '@lucide/svelte';

	/**
	 * One project's playbook as Firstmate resolves it, read-only: the pack it is bound to, each
	 * item with where it came from, how each worker harness receives it, and the project
	 * settings the captain owns (never set by a pack).
	 */
	let { r, fixture = false }: { r: PackResolve; fixture?: boolean } = $props();

	const rows = $derived(matrixRows(r));
	const tone: Record<Delivery, string> = {
		enforced: 'text-success',
		advisory: 'text-foreground',
		unsupported: 'text-muted-foreground'
	};
	const ps = $derived(r.project_settings);
</script>

{#if fixture}
	<p class="mb-6 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning" data-fixture>
		Sample data: this Firstmate has no <code class="font-mono text-xs">fm-pack.sh</code> yet, so Wheelhouse
		is showing a development fixture, not your real playbooks.
	</p>
{/if}

{#if !r.binding}
	<p class="text-muted-foreground" data-unbound>
		No playbook is bound to this project. Its workers get whatever their global and project
		configuration gives them, as before.
	</p>
{:else}
	<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-binding>
		<span class="text-lg font-medium">{r.binding.pack}</span>
		<span class="text-sm text-muted-foreground">version {r.binding.version}</span>
		<code class="font-mono text-xs text-muted-foreground" title={r.binding.digest}
			>{shortDigest(r.binding.digest)}</code
		>
	</div>

	{#if !r.readiness.ok || r.readiness.refusals.length || r.readiness.missing.length}
		<div class="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm" data-readiness="refused">
			<p class="flex items-center gap-2 font-medium text-danger">
				<CircleAlert class="size-4" aria-hidden="true" />Firstmate will not start workers with this
				playbook
			</p>
			<ul class="mt-1 list-disc pl-5 text-muted-foreground">
				{#each r.readiness.refusals as x, i (i)}<li>{codeOf(x)}</li>{/each}
				{#each r.readiness.missing as m (m)}<li>Missing skill: {m}</li>{/each}
			</ul>
		</div>
	{/if}
	{#if r.readiness.warnings.length}
		<ul class="mt-3 list-disc pl-5 text-sm text-warning" data-readiness="warnings">
			{#each r.readiness.warnings as w, i (i)}<li>{codeOf(w)}</li>{/each}
		</ul>
	{/if}

	<section class="mt-8" aria-labelledby="pb-skills">
		<h2 id="pb-skills" class="text-sm font-medium">Skills</h2>
		{#each skillsByPhase(r) as g (g.phase)}
			<h3 class="mt-4 text-xs font-medium text-muted-foreground" data-phase={g.phase}>
				{PHASE_LABEL[g.phase]}
			</h3>
			<ul class="mt-1.5 divide-y rounded-lg border">
				{#each g.skills as s (s.name)}
					<li
						class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-sm"
						data-skill={s.name}
						data-skill-phase={g.phase}
						data-state={s.state}
					>
						<code
							class="font-mono {s.state === 'disabled' ? 'text-muted-foreground line-through' : ''}"
							>{s.name}</code
						>
						{#if g.phase === 'task' && s.kinds?.length}
							<span class="text-xs text-muted-foreground">{s.kinds.join(', ')}</span>
						{/if}
						{#if s.conditional}
							<span class="text-xs {s.conditional.holds ? 'text-muted-foreground' : 'text-warning'}"
								>when {s.conditional.when}{s.conditional.holds ? '' : ' (not met)'}</span
							>
						{/if}
						<span class="ml-auto text-xs text-muted-foreground"
							>{s.state === 'disabled' ? 'Turned off by ' : ''}{ORIGIN_LABEL[s.origin]}</span
						>
					</li>
				{/each}
			</ul>
		{/each}
	</section>

	{#if r.banned.length}
		<section class="mt-8" aria-labelledby="pb-banned">
			<h2 id="pb-banned" class="text-sm font-medium">Not allowed</h2>
			<ul class="mt-3 flex flex-wrap gap-2">
				{#each r.banned as b (b.id)}
					<li class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
						<Ban class="size-3" aria-hidden="true" />{b.id}
						<span class="text-muted-foreground">{b.kind === 'skill' ? 'skill' : 'tool'}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="mt-8" aria-labelledby="pb-verify">
		<h2 id="pb-verify" class="text-sm font-medium">Verify commands</h2>
		{#if r.verify_commands.length}
			<ul class="mt-3 divide-y rounded-lg border">
				{#each r.verify_commands as v (v.id)}
					<li class="flex items-baseline gap-3 px-3 py-2 text-sm">
						<code class="font-mono text-xs">{v.cmd}</code>
						<span class="ml-auto text-xs text-muted-foreground">{ORIGIN_LABEL[v.origin]}</span>
					</li>
				{/each}
			</ul>
			<p class="mt-1.5 text-xs text-muted-foreground">
				Run by the worker before it is done; the validation pipeline stays the only gate.
			</p>
		{:else}
			<p class="mt-2 text-sm text-muted-foreground">None.</p>
		{/if}
	</section>

	<section class="mt-8" aria-labelledby="pb-delivery">
		<h2 id="pb-delivery" class="text-sm font-medium">How each worker gets it</h2>
		<p class="mt-1 text-xs text-muted-foreground">
			Enforced: the harness is launched with it. Advisory: it is in the worker’s brief, and the
			worker is asked to follow it. Unsupported: that harness cannot receive it.
		</p>
		<div class="mt-3 overflow-x-auto rounded-lg border">
			<table class="w-full text-sm" data-matrix>
				<thead class="text-left text-xs text-muted-foreground">
					<tr>
						<th class="px-3 py-2 font-medium">Item</th>
						{#each HARNESSES as h (h)}<th class="px-3 py-2 font-medium capitalize">{h}</th>{/each}
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each rows as row, i (i)}
						<tr class={row.state === 'disabled' ? 'text-muted-foreground' : ''}>
							<td class="px-3 py-1.5"
								><span class="text-xs text-muted-foreground">{row.kind}</span>
								<code class="ml-1 font-mono text-xs">{row.label}</code></td
							>
							{#each HARNESSES as h (h)}
								{@const d = deliveryFor(row.delivery, h)}
								<td class="px-3 py-1.5 text-xs {d ? tone[d] : 'text-muted-foreground'}"
									>{d ? DELIVERY_LABEL[d] : '—'}</td
								>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	{#if r.ignored.length}
		<section class="mt-8" aria-labelledby="pb-ignored">
			<h2 id="pb-ignored" class="text-sm font-medium">Ignored</h2>
			<ul class="mt-3 space-y-1 text-sm">
				{#each r.ignored as x, i (i)}
					<li data-ignored>
						<span class="text-muted-foreground line-through">{x.item}</span>
						<span class="text-xs text-muted-foreground">: {x.reason}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if r.model_hint?.value}
		<p class="mt-8 text-sm">
			Model hint: <code class="font-mono text-xs">{r.model_hint.value}</code>
			<span class="text-xs text-muted-foreground"
				>(a hint only: dispatch profiles choose the model)</span
			>
		</p>
	{/if}
{/if}

{#if ps}
	<section
		class="mt-10 rounded-xl border border-dashed p-4"
		aria-labelledby="pb-settings"
		data-project-settings
	>
		<h2 id="pb-settings" class="flex items-center gap-2 text-sm font-medium">
			<Lock class="size-4 text-muted-foreground" aria-hidden="true" />Project settings
		</h2>
		<p class="mt-1 text-xs text-muted-foreground">
			Yours, kept in Firstmate. A playbook never sets these; change them by asking Firstmate.
		</p>
		<dl class="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
			<div>
				<dt class="text-xs text-muted-foreground">Delivery</dt>
				<dd>{ps.mode ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-xs text-muted-foreground">Merge authority</dt>
				<dd>{ps.yolo ? `yolo ${ps.yolo === true ? '' : ps.yolo}`.trim() : 'You merge'}</dd>
			</div>
			<div>
				<dt class="text-xs text-muted-foreground">Forge</dt>
				<dd>{ps.forge ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-xs text-muted-foreground">Branches</dt>
				<dd><code class="font-mono text-xs">{ps.branch_prefix ?? '—'}</code></dd>
			</div>
			<div>
				<dt class="text-xs text-muted-foreground">Merge policy</dt>
				<dd>{ps.merge_policy ? 'Set' : 'Default'}</dd>
			</div>
			{#if ps.sandbox_floor}
				<div>
					<dt class="text-xs text-muted-foreground">Sandbox floor</dt>
					<dd>{ps.sandbox_floor}</dd>
				</div>
			{/if}
		</dl>
	</section>
{/if}
