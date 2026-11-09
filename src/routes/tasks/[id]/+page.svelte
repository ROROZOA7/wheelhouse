<script lang="ts">
	import WorkerEvidence from '$lib/components/wh/task/WorkerEvidence.svelte';
	import { page } from '$app/state';
	import ResizableRail from '$lib/components/wh/ResizableRail.svelte';
	import { replaceState } from '$app/navigation';
	import { currentFleet, live } from '$lib/client/live.svelte';
	import { slots } from '$lib/client/slots.svelte';
	import { slotKey } from '$lib/plugins/keys';
	import { placeTaskSections } from '$lib/plugins/placement';
	import { consoleInImage } from '$lib/card';
	import ConsoleWindow from '$lib/components/wh/ConsoleWindow.svelte';
	import DiffDialog from '$lib/components/wh/DiffDialog.svelte';
	import Lightbox from '$lib/components/wh/Lightbox.svelte';
	import PreviewStudio from '$lib/components/wh/PreviewStudio.svelte';
	import { harbourHref } from '$lib/nav';
	import ChecksReport from '$lib/components/wh/buildlog/ChecksReport.svelte';
	import ConversationPanel from '$lib/components/wh/buildlog/ConversationPanel.svelte';
	import DocsPanel from '$lib/components/wh/buildlog/DocsPanel.svelte';
	import TaskOverview from '$lib/components/wh/task/TaskOverview.svelte';
	import StagesPanel from '$lib/components/wh/task/StagesPanel.svelte';
	import PreviewPanel from '$lib/components/wh/task/PreviewPanel.svelte';
	import ScreenshotsPanel from '$lib/components/wh/task/ScreenshotsPanel.svelte';
	import TimePanel from '$lib/components/wh/task/TimePanel.svelte';
	import LogPanel from '$lib/components/wh/task/LogPanel.svelte';
	import PluginSection from '$lib/components/wh/task/PluginSection.svelte';
	import HowItWorkedPanel from '$lib/components/wh/task/HowItWorkedPanel.svelte';
	import { pullRequests } from '$lib/client/pullrequests';
	import { previewChecks } from '$lib/client/previewchecks.svelte';
	import { DEFAULT_TAB, pickTab, taskTabs } from '$lib/taskpage';
	import { tick } from 'svelte';
	import type { TaskDetail, TaskSummary } from '$lib/types';
	import { ArrowLeft, ChevronRight } from '@lucide/svelte';

	let { data } = $props();

	let fetched = $state<TaskDetail | null>(null);
	/** The screenshot enlarged in the lightbox, and the file whose diff is open. */
	let shotIndex = $state<number | null>(null);
	let diffFile = $state<string | null>(null);
	let lastFetch = 0;
	const id = $derived(page.params.id!);
	const detail = $derived(fetched?.task.id === id ? fetched : data.detail);
	// Prefer the live summary from the fleet stream; evidence refreshes separately.
	const task = $derived(currentFleet()?.tasks.find((t) => t.id === id) ?? detail?.task ?? null);
	// The project's plugin review tab while one is on, else the PR on GitHub.
	const prLink = $derived(task?.pr ? pullRequests.review(task.projectId, task.pr) : null);
	const ev = $derived(detail?.evidence ?? null);
	const shots = $derived(ev?.screenshots.available ? ev.screenshots.value : []);
	const shotAt = (url: string) => shots.findIndex((s) => s.url === url);

	// Whether the reported preview answers, so the overview never links to one that has stopped.
	$effect(() => {
		if (task?.preview) return previewChecks.watch(task.id);
	});

	// Refetch evidence when the fleet changes, at most every 10 s.
	$effect(() => {
		void live.revision;
		const want = id;
		if (Date.now() - lastFetch < 10_000) return;
		lastFetch = Date.now();
		fetch(`/api/tasks/${encodeURIComponent(want)}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((d: TaskDetail | null) => {
				if (d && d.task.id === id) fetched = d;
			})
			.catch(() => {});
	});

	// Plugin entries for this task (task.section and step.evidence slots).
	const pluginEntries = $derived(slots.entries(slotKey.task(id), data.slots, data.slotsAt));
	$effect(() => {
		void live.revision;
		slots.refresh(slotKey.task(id), data.slotsAt);
	});

	const back = $derived(harbourHref(task?.projectId));

	const taskSections = $derived(
		placeTaskSections(pluginEntries, task ? task.passage.steps.map((s) => s.key) : [])
	);

	// The overview stays on the left, with the live terminal and the task's time under it;
	// everything else sits in tabs beside it, so the page no longer scrolls through it all. Plugin task.section entries each get a tab, by order
	// (or sit right after their passage step when they name one this passage has).
	const pluginTabs = $derived([...taskSections.byOrder].sort((a, b) => a.order - b.order));
	const hasTime = (task: TaskSummary, detail: TaskDetail) =>
		!!(task.eta && !task.eta.openEnded) ||
		!!(detail.time && detail.time.total > 0) ||
		detail.decided.length > 0;
	const tabs = $derived(
		task && detail
			? taskTabs({
					preview: !!task.preview,
					shots: shots.length,
					// Only Claude Code sessions can be read (a finished task's worker may be gone: then the server uses the ledger's harness).
					how: (task.worker?.harness ?? 'claude').toLowerCase() === 'claude',
					plugins: pluginTabs.map((e) => ({ key: e.key, title: e.title })),
					build: {
						// Only what is still waiting on an answer is counted.
						talk: detail.build.conversation.available
							? detail.build.conversation.value.filter((e) => e.outcome.state === 'open').length
							: 0,
						docs: detail.build.docs.available ? detail.build.docs.value.length : 0
					}
				})
			: []
	);
	// The chosen tab and full-screen preview are per task, and kept in the URL
	// (`?tab=`, `&full=1`) so a link or a reload opens the same view.
	let chosen = $state<{ id: string; tab: string; full: boolean } | null>(null);
	const want = $derived(
		chosen?.id === id ? chosen : { tab: page.url.searchParams.get('tab'), full: false }
	);
	const active = $derived(pickTab(want.tab, tabs));
	const full = $derived(
		!!task?.preview && (chosen?.id === id ? chosen.full : page.url.searchParams.get('full') === '1')
	);

	function show(tab: string, fullScreen = false) {
		chosen = { id, tab, full: fullScreen };
		const url = new URL(page.url);
		if (tab === DEFAULT_TAB) url.searchParams.delete('tab');
		else url.searchParams.set('tab', tab);
		if (fullScreen) url.searchParams.set('full', '1');
		else url.searchParams.delete('full');
		replaceState(url, {});
	}

	// When the overview sits above the tabs (narrow screens), its shortcuts would open a
	// tab out of sight, so bring the tabs into view.
	let tabsTop = $state<HTMLElement>();
	async function reveal(tab: string) {
		show(tab);
		if (matchMedia('(min-width: 64rem)').matches) return;
		await tick();
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		tabsTop?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
	}

	// On narrow screens the tab row scrolls; keep the selected tab in sight (sideways only).
	let tablist = $state<HTMLElement>();
	$effect(() => {
		const tab = document.getElementById(`tab-${active}`);
		if (!tablist || !tab) return;
		const box = tablist.getBoundingClientRect();
		const r = tab.getBoundingClientRect();
		if (r.left < box.left) tablist.scrollLeft -= box.left - r.left;
		else if (r.right > box.right) tablist.scrollLeft += r.right - box.right;
	});

	function onTabKey(e: KeyboardEvent, i: number) {
		const n = tabs.length;
		const to =
			e.key === 'ArrowRight'
				? (i + 1) % n
				: e.key === 'ArrowLeft'
					? (i - 1 + n) % n
					: e.key === 'Home'
						? 0
						: e.key === 'End'
							? n - 1
							: -1;
		if (to < 0) return;
		e.preventDefault();
		show(tabs[to].id);
		document.getElementById(`tab-${tabs[to].id}`)?.focus();
	}

	// The live terminal under the overview can be folded away; the time line jumps to the time.
	let terminalOpen = $state(true);
	let timeTop = $state<HTMLElement>();
	function revealTime() {
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		timeTop?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
	}
</script>

<svelte:head><title>{task?.title ?? id} · Wheelhouse</title></svelte:head>

<main class="px-4 pt-4 pb-20 sm:px-6 {task && ev && detail ? 'lg:p-0' : 'lg:px-10'}">
	{#if !task || !ev || !detail}
		<a
			href={back}
			class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
			><ArrowLeft class="size-4" aria-hidden="true" />Harbour</a
		>
		<p class="surface mt-6 max-w-3xl p-6 text-muted-foreground">{data.problem ?? 'Loading…'}</p>
	{:else}
		<div class="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-0">
			<!-- The overview stays put while the tabs beside it change. On a wide screen it is a
			     flush, full-height panel against the left-hand menu, resizable like the home page's
			     On deck; narrow, it stacks above the tabs as a card. -->
			<ResizableRail
				storageKey="wheelhouse-task-overview-width"
				label="Resize the overview"
				defaultWidth={416}
				side="left"
				class="bg-panel max-lg:!w-auto max-lg:border-0 max-lg:bg-transparent lg:sticky lg:top-14 lg:h-[calc(100dvh-3.5rem)] max-lg:[&>[role=separator]]:hidden"
			>
				<aside
					class="no-scrollbar min-w-0 rounded-lg border bg-panel px-6 pt-1 pb-6 lg:h-full lg:overflow-y-auto lg:rounded-none lg:border-0 lg:pt-0"
					aria-label="Overview"
				>
					<div
						class="-mx-6 flex h-11 items-center border-b px-6 max-lg:mx-0 max-lg:border-0 max-lg:px-0"
					>
						<a
							href={back}
							class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
							><ArrowLeft class="size-4" aria-hidden="true" />Harbour</a
						>
					</div>
					<TaskOverview {task} {detail} {shots} {prLink} onreveal={reveal} ontime={revealTime} />
					{#if consoleInImage(task)}
						<!-- What the worker's terminal shows right now, sampled while on screen. -->
						<section class="mt-6 border-t pt-5" aria-labelledby="live-terminal" data-terminal>
							<h2 id="live-terminal" class="text-sm font-medium">
								<button
									type="button"
									class="group flex w-full items-center gap-2 text-left"
									aria-expanded={terminalOpen}
									aria-controls="live-terminal-body"
									onclick={() => (terminalOpen = !terminalOpen)}
								>
									<span class="group-hover:underline">Live terminal</span>
									<ChevronRight
										class="ml-auto size-4 shrink-0 text-muted-foreground transition-transform {terminalOpen
											? 'rotate-90'
											: ''}"
										aria-hidden="true"
									/>
								</button>
							</h2>
							{#if terminalOpen}
								<div id="live-terminal-body" class="mt-3">
									<ConsoleWindow {task} lines={12} class="rounded-xl" />
								</div>
							{/if}
						</section>
					{/if}
					{#if hasTime(task, detail)}
						<div class="mt-6 scroll-mt-20 border-t pt-5" bind:this={timeTop} data-time>
							<TimePanel {task} {detail} />
						</div>
					{/if}
				</aside>
			</ResizableRail>

			<!-- The tabs and every panel sit on one solid sheet, never on the graph paper. -->
			<div
				class="surface min-w-0 flex-1 scroll-mt-14 px-5 pb-8 sm:px-6 lg:mx-10 lg:mt-4 lg:mb-20"
				bind:this={tabsTop}
			>
				<div class="sticky top-14 z-20 -mx-5 rounded-t-lg bg-card px-5 pt-1 sm:-mx-6 sm:px-6">
					<div
						class="no-scrollbar flex items-center gap-1 overflow-x-auto border-b"
						role="tablist"
						aria-label="Task detail"
						bind:this={tablist}
					>
						{#each tabs as tab, i (tab.id)}
							<button
								type="button"
								role="tab"
								id="tab-{tab.id}"
								aria-selected={active === tab.id}
								aria-controls="panel-{tab.id}"
								tabindex={active === tab.id ? 0 : -1}
								class="-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-base font-semibold tracking-[0.1em] whitespace-nowrap transition-colors [font-variant-caps:all-small-caps] {active ===
								tab.id
									? 'border-brass text-foreground'
									: 'border-transparent text-muted-foreground hover:text-foreground'}"
								onclick={() => show(tab.id)}
								onkeydown={(e) => onTabKey(e, i)}
							>
								{tab.label}{#if tab.count}<span
										class="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums"
										>{tab.count}</span
									>{/if}
							</button>
						{/each}
					</div>
				</div>

				<!-- Every panel is in the page (so a link or search finds it); only the chosen one shows. -->
				{#each tabs as tab (tab.id)}
					<div
						id="panel-{tab.id}"
						role="tabpanel"
						aria-labelledby="tab-{tab.id}"
						tabindex="0"
						class="pt-6 outline-none"
						hidden={active !== tab.id}
					>
						{#if tab.id === 'stages'}<StagesPanel
								{task}
								{detail}
								{shots}
								{pluginEntries}
								afterStep={taskSections.afterStep}
								{prLink}
								onshot={(url) => (shotIndex = shotAt(url))}
								ondiff={(path) => (diffFile = path)}
								onchecks={() => {
									// Keyboard users land where the report is.
									reveal('checks').then(() =>
										document.getElementById('tab-checks')?.focus({ preventScroll: true })
									);
								}}
							/>
						{:else if tab.id === 'preview'}<PreviewPanel
								{task}
								shown={active === 'preview' && !full}
								onfullscreen={() => show('preview', true)}
							/>
						{:else if tab.id === 'screenshots'}<ScreenshotsPanel
								{shots}
								screenshots={detail.evidence.screenshots}
								onshot={(i) => (shotIndex = i)}
							/>
						{:else if tab.id === 'log'}<LogPanel {task} {detail} sampling={active === 'log'} />
						{:else if tab.id === 'talk'}<ConversationPanel
								talk={detail.build.conversation}
								now={live.now}
							/>
						{:else if tab.id === 'checks'}<WorkerEvidence
								value={detail.evidence.worker}
							/><ChecksReport checks={detail.build.checks} taskId={task.id} />
						{:else if tab.id === 'how'}<HowItWorkedPanel
								taskId={task.id}
								shown={active === 'how'}
							/>
						{:else if tab.id === 'docs'}<DocsPanel docs={detail.build.docs} taskId={task.id} />
						{:else}
							{@const entry = pluginTabs.find((e) => `plugin:${e.key}` === tab.id)}
							{#if entry}<PluginSection {entry} />{/if}
						{/if}
					</div>
				{/each}
			</div>
		</div>
		{#if full && task.preview}
			<PreviewStudio
				taskId={task.id}
				title={task.title}
				url={task.preview.url}
				talk={task.status !== 'landed'}
				onclose={() => show('preview')}
			/>
		{/if}
		<Lightbox {shots} bind:index={shotIndex} />
		<DiffDialog taskId={task.id} bind:file={diffFile} />
	{/if}
</main>
