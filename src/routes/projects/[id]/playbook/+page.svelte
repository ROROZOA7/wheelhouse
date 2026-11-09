<script lang="ts">
	import { page } from '$app/state';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { slotKey } from '$lib/plugins/keys';
	import ProjectBanner from '$lib/components/wh/harbour/ProjectBanner.svelte';
	import PlaybookView from '$lib/components/wh/playbook/PlaybookView.svelte';

	let { data } = $props();

	const id = $derived(page.params.id!);
	const project = $derived(currentFleet()?.projects.find((p) => p.id === id));
	const name = $derived(project?.name ?? id);
	const tasks = $derived((currentFleet()?.tasks ?? []).filter((t) => t.projectId === id));
	const tabs = $derived(
		slots
			.entries(slotKey.project(id), data.slots, data.slotsAt)
			.filter((e) => e.slot === 'project.tab')
	);
	$effect(() => {
		void live.revision;
		slots.refresh(slotKey.project(id), data.slotsAt);
	});
	const pb = $derived(data.playbooks);
</script>

<svelte:head><title>{name} playbook · Wheelhouse</title></svelte:head>

<main class="px-4 pt-6 pb-24 sm:px-6 lg:px-10">
	<ProjectBanner
		{id}
		project={project ?? null}
		{tasks}
		{tabs}
		repo={data.repo}
		current="playbook"
		now={live.now}
	/>

	<div class="surface mt-6 px-5 py-6 sm:px-8 sm:py-8">
		<div class="max-w-3xl">
			<div class="flex flex-wrap items-baseline justify-between gap-2">
				<h1 class="text-2xl font-semibold tracking-tight">Playbook</h1>
				<a href="/playbooks" class="text-sm text-sea hover:underline">All playbooks</a>
			</div>
			<p class="mt-2 leading-relaxed text-muted-foreground">
				How Firstmate’s workers on this project are asked to work: the skills, banned tools and
				verify commands from the pack bound to it. Firstmate owns the playbook; this page only shows
				it.
			</p>
			<div class="mt-8">
				{#if !pb.source.available}
					<p class="text-muted-foreground">{pb.source.reason}</p>
				{:else if pb.resolve && !pb.resolve.ok}
					<p class="text-muted-foreground">{pb.resolve.reason}</p>
				{:else if pb.resolve?.ok}
					<PlaybookView r={pb.resolve.value} fixture={pb.source.source === 'fixture'} />
				{/if}
			</div>
		</div>
	</div>
</main>
