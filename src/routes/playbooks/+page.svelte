<script lang="ts">
	import { ago } from '$lib/format';
	import { live } from '$lib/client/live.svelte';
	import { shortDigest } from '$lib/playbooks';
	import InsightsNav from '$lib/components/wh/insights/InsightsNav.svelte';
	import { ShieldAlert } from '@lucide/svelte';

	let { data } = $props();
	const pb = $derived(data.playbooks);
	const RISK: Record<string, string> = {
		'shell-hooks': 'Runs shell hooks',
		'network-mcp': 'MCP server with network access',
		'shell-scripts': 'Ships shell scripts'
	};
</script>

<svelte:head><title>Playbooks · Wheelhouse</title></svelte:head>

<main class="px-4 pt-6 pb-24 sm:px-6 lg:px-10">
	<div class="surface px-5 py-6 sm:px-8 sm:py-8">
		<InsightsNav />
		<div class="mt-6 max-w-3xl">
			<h1 class="text-2xl">Playbooks</h1>
			<p class="mt-2 leading-relaxed text-muted-foreground">
				The skill packs installed in Firstmate, and the projects each is bound to. Firstmate owns
				them; installing or changing one goes through Firstmate.
			</p>

			{#if !pb.source.available}
				<p class="mt-8 text-muted-foreground">{pb.source.reason}</p>
			{:else}
				{#if pb.source.source === 'fixture'}
					<p class="mt-6 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning" data-fixture>
						Sample data: this Firstmate has no <code class="font-mono text-xs">fm-pack.sh</code> yet.
					</p>
				{/if}
				{#if pb.list && !pb.list.ok}
					<p class="mt-8 text-muted-foreground">{pb.list.reason}</p>
				{:else if pb.list?.ok && !pb.list.value.packs.length}
					<p class="mt-8 text-muted-foreground">No playbooks are installed.</p>
				{:else if pb.list?.ok}
					<ul class="mt-8 space-y-4">
						{#each pb.list.value.packs as p (p.digest)}
							<li class="rounded-xl border p-4" data-pack={p.name}>
								<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
									<span class="text-lg font-medium">{p.name}</span>
									<span class="text-sm text-muted-foreground">version {p.version}</span>
									<code class="font-mono text-xs text-muted-foreground" title={p.digest}
										>{shortDigest(p.digest)}</code
									>
									{#if p.update}<span class="text-xs text-sea">Update available</span>{/if}
								</div>
								<p class="mt-1 text-sm text-muted-foreground">
									{p.contents.skills} skills · {p.contents.hooks} hooks · {p.contents.mcp} MCP servers{p.installed_at
										? ` · installed ${ago(p.installed_at, live.now)}`
										: ''}
								</p>
								{#if p.source}
									<p class="mt-1 font-mono text-xs break-all text-muted-foreground">
										{p.source.repo}{p.source.path ? `/${p.source.path}` : ''} @ {p.source.commit.slice(
											0,
											12
										)}
									</p>
								{/if}
								{#if p.risk.length}
									<ul class="mt-2 flex flex-wrap gap-2">
										{#each p.risk as k (k)}
											<li
												class="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning"
											>
												<ShieldAlert class="size-3" aria-hidden="true" />{RISK[k] ?? k}
											</li>
										{/each}
									</ul>
								{/if}
								<p class="mt-3 text-sm">
									{#if p.bound_projects.length}
										Used by
										{#each p.bound_projects as b, i (b.project)}{i ? ', ' : ''}<a
												href="/projects/{encodeURIComponent(b.project)}/playbook"
												class="text-sea hover:underline">{b.project}</a
											>{#if b.digest !== p.digest}<span class="text-xs text-warning">
													(older version)</span
												>{/if}{/each}
									{:else}
										<span class="text-muted-foreground">Not bound to any project.</span>
									{/if}
								</p>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</div>
	</div>
</main>
