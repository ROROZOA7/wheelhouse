<script lang="ts">
	import { live } from '$lib/client/live.svelte';
	import WorkerEvidence from './WorkerEvidence.svelte';
	import type { SlotEntry } from '$lib/plugins/types';
	import SlotContent from '$lib/components/wh/plugins/SlotContent.svelte';
	import { ago, clock } from '$lib/format';
	import { plainStatus } from '$lib/plain';
	import { showsChecks } from '$lib/checks';
	import ChecksTimeline from '$lib/components/wh/ChecksTimeline.svelte';
	import BusyRing from '$lib/components/wh/BusyRing.svelte';
	import RawDetails from '$lib/components/wh/RawDetails.svelte';
	import LinkedText from '$lib/components/wh/LinkedText.svelte';
	import { docHref } from '$lib/docpath';
	import { previewChecks } from '$lib/client/previewchecks.svelte';
	import ChangeRequests from '$lib/components/wh/ChangeRequests.svelte';
	import PastRun from '$lib/components/wh/PastRun.svelte';
	import RunSwitcher from '$lib/components/wh/RunSwitcher.svelte';
	import { runAt } from '$lib/changes';
	import { tone, textClass } from '$lib/components/wh/tone';
	import { hasDetail, openByDefault, prState, stepGist, type TaskShot } from '$lib/taskpage';
	import type { PullRequestLink } from '$lib/plugins/pullrequests';
	import type { Snippet } from 'svelte';
	import type { Check, PassageCheck, PassageStep, TaskDetail, TaskSummary } from '$lib/types';
	import {
		Check as CheckIcon,
		ChevronRight,
		Compass,
		ExternalLink,
		FileText,
		X
	} from '@lucide/svelte';
	import { checkIcon, source, unavailable } from './snippets.svelte';
	import PluginSection from './PluginSection.svelte';

	let {
		task,
		detail,
		shots,
		pluginEntries,
		afterStep,
		prLink,
		onshot,
		ondiff,
		onchecks
	}: {
		task: TaskSummary;
		detail: TaskDetail;
		shots: TaskShot[];
		/** The task's plugin entries (step.evidence ones show under their step). */
		pluginEntries: SlotEntry[];
		/** Plugin task.section entries placed right after a passage step, by step key. */
		afterStep: Record<string, SlotEntry[]>;
		prLink: PullRequestLink | null;
		/** Enlarge the screenshot with this url. */
		onshot: (url: string) => void;
		/** Open one changed file's diff. */
		ondiff: (path: string) => void;
		/** Bring the Checks tab forward. */
		onchecks: () => void;
	} = $props();

	const id = $derived(task.id);
	const ev = $derived(detail.evidence);
	const t = $derived(tone(task));
	const FILES_PREVIEW = 12;
	// Per task: the panel is reused when moving to another task.
	let allFilesFor = $state<string | null>(null);
	const showAllFiles = $derived(allFilesFor === id);

	// On a later run, the stages show only the screenshots saved in it (earlier runs keep theirs).
	const runShots = $derived(
		detail.task.runs && detail.task.runs.current > 1
			? shots.filter((s) => runAt(detail.task.runs, s.modifiedAt) === detail.task.runs!.current)
			: shots
	);
	// Which of the task's runs the Stages tab shows: the current one unless another is picked.
	let pickedRun = $state<{ task: string; n: number } | null>(null);
	const shownRun = $derived(
		pickedRun?.task === id ? pickedRun.n : (detail.task.runs?.current ?? 1)
	);

	const stepEntries = (key: string) =>
		pluginEntries.filter((e) => e.slot === 'step.evidence' && e.step === key);

	// Evidence blocks by id; each passage step lists the ids it shows (stages.ts).
	const blocks: Record<string, Snippet<[PassageStep, string]>> = {
		queue: queueBlock,
		progress: progressBlock,
		files: filesBlock,
		validation: validationBlock,
		pr: prBlock,
		report: reportBlock,
		screenshots: screenshotsBlock,
		preview: previewBlock,
		decision: decisionBlock,
		landed: landedBlock
	};
	// `check:<id>` blocks show one of the passage's declared checks (a deploy, a release).
	const blockFor = (id: string): Snippet<[PassageStep, string]> | undefined =>
		blocks[id] ?? (id.startsWith('check:') ? checkBlock : undefined);
	const PASS = ['success', 'inactive', 'included', 'published', 'ok', 'yes', 'present'];
	const FAIL = ['failure', 'error', 'mismatch'];
	const checkTone = (c: PassageCheck): Check['state'] =>
		c.state === 'off' || c.state === 'gave-up'
			? 'skipped'
			: c.state !== 'observed'
				? 'unknown'
				: PASS.includes(c.outcome ?? '')
					? 'pass'
					: FAIL.includes(c.outcome ?? '')
						? 'fail'
						: c.outcome === 'in_progress'
							? 'running'
							: 'pending';

	// Stages fold to one line once finished; the current one is open. A stage the captain
	// opened or closed stays that way, per task, until the page is left.
	let toggled = $state<Record<string, boolean>>({});
	const isOpen = (s: PassageStep) => toggled[`${id} ${s.key}`] ?? openByDefault(s);
	const toggle = (s: PassageStep) => (toggled[`${id} ${s.key}`] = !isOpen(s));
	function setAll(open: boolean) {
		for (const s of task.passage.steps) if (hasDetail(s)) toggled[`${id} ${s.key}`] = open;
	}
	const runs = $derived(task.runs && task.runs.runs.length > 1 ? task.runs : null);
	const run = $derived(runs?.runs.find((r) => r.n === shownRun) ?? null);
</script>

{#snippet filesBlock()}
	{#if ev.files.available}
		{@const f = ev.files.value}
		{@const max = Math.max(1, ...f.files.map((x) => (x.additions ?? 0) + (x.deletions ?? 0)))}
		<h4 class="mb-2 text-sm font-medium">
			Files changed <span class="font-normal text-muted-foreground"
				>{f.branch ? `on ${f.branch}` : ''} against {f.base}</span
			>
		</h4>
		{#if f.files.length}
			<ul class="divide-y rounded-lg border">
				{#each showAllFiles ? f.files : f.files.slice(0, FILES_PREVIEW) as x (x.path)}
					<li>
						<button
							type="button"
							class="flex w-full items-center gap-3 px-3 py-2 text-left text-xs hover:bg-accent/60"
							onclick={() => ondiff(x.path)}
							aria-label="Show the changes to {x.path}"
						>
							<span class="w-3 font-mono text-muted-foreground">{x.status}</span>
							<span class="min-w-0 flex-1 truncate font-mono" title={x.path}>{x.path}</span>
							{#if x.status === '?'}
								<span class="text-muted-foreground">new, not committed</span>
							{:else if x.additions === null}
								<span class="text-muted-foreground">binary</span>
							{:else}
								<span class="tabular"
									><span class="text-success">+{x.additions}</span>
									<span class="text-danger">−{x.deletions}</span></span
								>
								<span class="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:flex">
									<span class="bg-success" style="width:{((x.additions ?? 0) / max) * 100}%"></span>
									<span class="bg-danger" style="width:{((x.deletions ?? 0) / max) * 100}%"></span>
								</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
			{#if !showAllFiles && f.files.length > FILES_PREVIEW}
				<button
					class="mt-2 text-sm text-muted-foreground hover:text-foreground hover:underline"
					onclick={() => (allFilesFor = id)}
				>
					Show all {f.files.length} files
				</button>
			{/if}
			{#if f.truncated}<p class="mt-1 text-xs text-muted-foreground">
					Showing the first {f.files.length} of {f.total} files.
				</p>{/if}
			<p class="mt-1 text-xs text-muted-foreground">Select a file to see its diff.</p>
		{:else}
			<p class="text-sm text-muted-foreground">No changes yet.</p>
		{/if}
		{@render source(ev.files)}
	{:else}
		{@render unavailable(ev.files)}
	{/if}
{/snippet}

{#snippet checksLink()}
	<button type="button" class="mt-2 block text-sm text-sea hover:underline" onclick={onchecks}
		>What each check found</button
	>
{/snippet}

{#snippet queueBlock()}
	<p class="text-sm text-muted-foreground">
		{task.since ? `Filed ${task.since}.` : 'Queued by Firstmate.'}
		{#if task.blockedBy.length}Waiting on {task.blockedBy.join(', ')}.{/if}
	</p>
{/snippet}

{#snippet progressBlock()}
	<!-- What the worker is doing now is the overview's Now line, beside the stages; not repeated here. -->
{/snippet}

{#snippet validationBlock()}
	<WorkerEvidence value={ev.worker} />
	{#if showsChecks(task)}
		<ChecksTimeline
			pipeline={task.pipeline}
			busy={task.busy}
			prChecks={ev.pr.available ? ev.pr.value.checks : []}
		/>
		{#if ev.validation.available}
			<RawDetails
				raw={ev.validation.value.detail}
				plain={plainStatus(task.current?.state, ev.validation.value.detail)}
			/>
		{/if}
		<p class="mt-1.5 text-xs text-muted-foreground">
			From the validation run’s own report{task.pipeline.observedAt
				? `, ${ago(task.pipeline.observedAt, live.now)}`
				: ''}.
		</p>
		{@render checksLink()}
	{:else if ev.validation.available}
		{@const plain = plainStatus(task.current?.state, ev.validation.value.detail)}
		<p class="text-sm">{plain}</p>
		{#if task.pipeline && task.current?.state === 'working'}
			<p class="mt-1 text-sm text-muted-foreground">
				{task.pipeline.label} step{task.pipeline.round
					? `, fix round ${task.pipeline.round}`
					: ''}{task.pipeline.startedAt
					? `, started ${ago(task.pipeline.startedAt, live.now)}`
					: ''}.
			</p>
		{/if}
		<RawDetails raw={ev.validation.value.detail} {plain} />
		{@render source(ev.validation)}
	{:else if detail.build.checks.available}
		<!-- No run is current any more, but the latest one's report is still there. -->
		<ul class="space-y-1 text-sm">
			{#each detail.build.checks.value.steps.filter((x) => x.key !== 'intent') as c (c.key)}
				<li><span class="font-medium">{c.label}</span> · {c.summary}</li>
			{/each}
		</ul>
		{@render checksLink()}
	{:else}
		{@render unavailable(ev.validation)}
	{/if}
{/snippet}

{#snippet reviewTab()}
	<!-- Only a plugin's review tab: the pull request on GitHub is linked just above. -->
	{#if prLink && !prLink.external}
		<a
			href={prLink.href}
			class="mt-2 inline-flex items-center gap-1.5 text-sm text-sea hover:underline"
			data-review-pr><Compass class="size-3.5" aria-hidden="true" />Review the pull request</a
		>
	{/if}
{/snippet}

{#snippet prBlock()}
	{#if ev.pr.available}
		{@const pr = ev.pr.value}
		<p class="text-sm">
			<a
				href={pr.url}
				target="_blank"
				rel="noreferrer"
				class="inline-flex items-center gap-1 text-sea hover:underline"
				>Pull request{pr.number ? ` #${pr.number}` : ''}<ExternalLink
					class="size-3.5"
					aria-hidden="true"
				/></a
			>
			<span class="text-muted-foreground"
				>{prState(pr.state, pr.draft)}{pr.reviewDecision
					? `, ${pr.reviewDecision.toLowerCase().replace(/_/g, ' ')}`
					: ''}</span
			>
		</p>
		{#if pr.checks.length}
			<ul class="mt-3 divide-y rounded-lg border">
				{#each pr.checks as c, i (c.name + i)}
					<li class="flex items-center gap-3 px-3 py-2 text-sm">
						{@render checkIcon(c)}<span class="truncate">{c.name}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-2 text-sm text-muted-foreground">No CI checks reported.</p>
		{/if}
		{@render source(ev.pr)}
		{@render reviewTab()}
	{:else if !ev.pr.available && task.pr}
		<a
			href={task.pr.url}
			target="_blank"
			rel="noreferrer"
			class="inline-flex items-center gap-1 text-sm text-sea hover:underline"
			>Pull request{task.pr.number ? ` #${task.pr.number}` : ''}<ExternalLink
				class="size-3.5"
				aria-hidden="true"
			/></a
		>
		<p class="mt-1 text-sm text-muted-foreground">
			Its state and checks are not available. {ev.pr.reason}
		</p>
	{:else}
		{@render unavailable(ev.pr)}
	{/if}
{/snippet}

{#snippet reportBlock()}
	{#if ev.report.available}
		<div class="flex gap-3 rounded-lg border p-3">
			<FileText class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
			<div class="min-w-0">
				<a
					href={docHref(ev.report.value.path)}
					class="block truncate font-mono text-xs text-sea underline-offset-2 hover:underline"
					data-doc-link>{ev.report.value.path}</a
				>
				<p class="mt-1 text-sm leading-relaxed">{ev.report.value.excerpt}</p>
			</div>
		</div>
		{@render source(ev.report)}
	{:else}
		{@render unavailable(ev.report)}
	{/if}
{/snippet}

{#snippet screenshotsBlock()}
	{#if ev.screenshots.available && (runShots.length || !shots.length)}
		<div class="flex flex-wrap gap-3">
			{#each runShots as s (s.url)}
				<button
					type="button"
					class="w-48 shrink-0 cursor-zoom-in text-left"
					onclick={() => onshot(s.url)}
					aria-label="Enlarge {s.name}"
				>
					<img
						src={s.url}
						alt={s.name}
						loading="lazy"
						class="aspect-[16/10] w-full rounded-lg border object-cover object-top"
					/>
					<p class="mt-1.5 truncate text-xs text-muted-foreground">{s.name}</p>
				</button>
			{/each}
		</div>
		{@render source(ev.screenshots)}
	{:else if ev.screenshots.available}
		<p class="text-sm text-muted-foreground">
			No screenshots were saved in this run yet; earlier runs keep theirs.
		</p>
	{:else}
		{@render unavailable(ev.screenshots)}
	{/if}
{/snippet}

{#snippet previewBlock()}
	{#if ev.preview.available && task.preview?.url === ev.preview.value.url && previewChecks.stopped(task.id)}
		<p class="text-sm text-muted-foreground" data-preview-stopped>
			Preview stopped. {previewChecks.checks[task.id]?.reason ?? ''}
		</p>
		{@render source(ev.preview)}
	{:else if ev.preview.available}
		<a
			href={ev.preview.value.url}
			target="_blank"
			rel="noreferrer"
			class="inline-flex items-center gap-1 text-sm text-sea hover:underline"
			>Open preview<ExternalLink class="size-3.5" aria-hidden="true" /></a
		>
		{@render source(ev.preview)}
	{:else}
		{@render unavailable(ev.preview)}
	{/if}
{/snippet}

{#snippet decisionBlock(s: PassageStep)}
	{#if s.state === 'current' && ev.decisions.length}
		<ul class="list-disc space-y-1 pl-5 text-sm">
			{#each ev.decisions as d, i (i)}
				{@const plain = plainStatus('needs-decision', d.text)}
				<li>{plain}<RawDetails raw={d.text} {plain} /></li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet checkBlock(_s: PassageStep, block: string)}
	{@const c = task.passage.checks.find((x) => `check:${x.id}` === block)}
	{#if c}
		<div class="flex items-start gap-3 rounded-lg border px-3 py-2 text-sm" data-check={c.id}>
			{@render checkIcon({ name: c.label, state: checkTone(c) })}
			<div class="min-w-0 flex-1">
				<p>
					<span class="font-medium">{c.label}</span>
					<span class="text-muted-foreground">{c.summary}</span>
				</p>
				<p class="mt-0.5 text-xs text-muted-foreground">
					{c.type === 'command' ? 'Command' : c.type}{c.observedAt
						? `, ${c.type === 'command' ? 'ran' : 'checked'} ${ago(c.observedAt, live.now)}`
						: ''}{c.state === 'gave-up' ? ', no longer checked' : ''}
					{#if c.url}
						·
						<a
							href={c.url}
							target="_blank"
							rel="noreferrer"
							class="inline-flex items-center gap-1 text-sea hover:underline"
							>Open<ExternalLink class="size-3" aria-hidden="true" /></a
						>
					{/if}
				</p>
				{#if c.command}
					<p class="mt-1 font-mono text-xs break-all text-muted-foreground">Runs {c.command}</p>
				{/if}
				{#if c.output}
					<details class="mt-1">
						<summary class="cursor-pointer text-xs text-sea">Output</summary>
						<pre
							class="mt-1 max-h-80 overflow-auto rounded-md bg-terminal px-3 py-2 font-mono text-xs text-terminal-foreground">{c.output}</pre>
					</details>
				{/if}
			</div>
		</div>
	{/if}
{/snippet}

{#snippet landedBlock()}
	<p class="text-sm text-muted-foreground">
		{#if task.mergedAt}Merged {ago(task.mergedAt, live.now)} ({clock(task.mergedAt)}).
		{:else if task.completedOn}Closed on {task.completedOn}; the exact time was not recorded.
		{:else if task.status === 'landed'}Done.
		{/if}
	</p>
{/snippet}

{#snippet currentStages(task: TaskSummary)}
	{@const steps = task.passage.steps}
	{@const any = steps.filter(hasDetail)}
	<section aria-labelledby="passage">
		<div class="flex items-baseline justify-between gap-4">
			<h2 id="passage" class="sr-only">Passage</h2>
			<p class="text-xs text-muted-foreground">Placed from: {task.passage.basis}.</p>
			{#if any.length > 1}
				{@const allOpen = any.every(isOpen)}
				<button
					type="button"
					class="shrink-0 text-xs text-muted-foreground hover:text-foreground hover:underline"
					onclick={() => setAll(!allOpen)}>{allOpen ? 'Fold all' : 'Open all'}</button
				>
			{/if}
		</div>

		<ol class="mt-5">
			{#each steps as s, i (s.key)}
				{@const done = s.state === 'done'}
				{@const now = s.state === 'current'}
				{@const finished = now && task.status === 'landed' && !s.failed}
				{@const open = hasDetail(s) && isOpen(s)}
				{@const gist = open ? null : stepGist(s, task, ev)}
				<li
					class="relative flex gap-4 {open ? 'pb-8' : 'pb-5'}"
					data-stage={s.key}
					data-open={open}
				>
					{#if i < steps.length - 1}
						<span
							class="absolute top-7 bottom-0 left-[11px] {done
								? 'w-0.5 bg-foreground/40'
								: 'w-0 border-l border-dotted border-input'}"
						></span>
					{/if}
					<span
						class="relative z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium {done
							? 'bg-foreground text-background'
							: now
								? t === 'trouble' || s.failed
									? 'bg-danger text-white'
									: t === 'you'
										? 'bg-sea text-white dark:text-slate-950'
										: finished
											? 'bg-success text-white dark:text-slate-950'
											: 'bg-foreground text-background ring-4 ring-foreground/15'
								: s.state === 'skipped'
									? 'border border-dashed bg-background text-muted-foreground'
									: 'border bg-background text-muted-foreground'}"
					>
						{#if now && !finished && task.busy}<BusyRing class="bg-foreground" />{/if}
						{#if done || finished}<CheckIcon
								class="size-3.5"
								aria-hidden="true"
							/>{:else if s.failed}<X class="size-3.5" aria-hidden="true" />{:else}{i + 1}{/if}
					</span>
					<div class="min-w-0 flex-1">
						<!-- A stage not reached yet, with nothing to show, has no detail to open. -->
						<button
							type="button"
							class="group flex w-full min-w-0 items-baseline gap-2 rounded-md text-left disabled:cursor-default"
							disabled={!hasDetail(s)}
							aria-expanded={hasDetail(s) ? open : undefined}
							aria-controls={hasDetail(s) ? `stage-${s.key}` : undefined}
							onclick={() => toggle(s)}
						>
							<span
								class="shrink-0 font-display text-[1.12rem] font-medium group-enabled:group-hover:underline {s.state ===
									'upcoming' || s.state === 'skipped'
									? 'text-muted-foreground italic'
									: ''}">{s.label}</span
							>
							{#if s.state === 'skipped'}<span class="shrink-0 text-sm text-muted-foreground"
									>skipped</span
								>{/if}
							{#if now && s.failed}
								<span class="shrink-0 text-sm text-danger">failed</span>
							{:else if now && !finished}
								<span
									class="shrink-0 text-sm {t === 'normal' || t === 'landed'
										? 'text-muted-foreground'
										: textClass[t]}"
								>
									{t === 'trouble'
										? `${task.statusLabel.toLowerCase()} here`
										: t === 'you'
											? 'waiting on you'
											: t === 'firstmate'
												? 'waiting on Firstmate'
												: task.status === 'done'
													? 'finished, with Firstmate'
													: 'in progress'}
								</span>
							{/if}
							{#if gist}<span class="min-w-0 truncate text-sm text-muted-foreground" title={gist}
									>· {gist}</span
								>{/if}
							{#if hasDetail(s)}<ChevronRight
									class="ml-auto size-4 shrink-0 self-center text-muted-foreground transition-transform {open
										? 'rotate-90'
										: ''}"
									aria-hidden="true"
								/>{/if}
						</button>
						{#if open}
							<div id="stage-{s.key}">
								{#if s.note}<p class="mt-1 text-xs text-muted-foreground">
										<LinkedText text={s.note} />
									</p>{/if}
								{#if done || now}
									<div class="mt-3 space-y-4">
										{#each s.evidence as id (id)}{@render blockFor(id)?.(s, id)}{/each}
										{#each stepEntries(s.key) as e (e.key)}
											<div data-slot="step.evidence">
												<h4 class="mb-2 text-sm font-medium">{e.title}</h4>
												<SlotContent entry={e} now={live.now} />
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
						{#each afterStep[s.key] ?? [] as e (e.key)}
							<div class="mt-4"><PluginSection entry={e} /></div>
						{/each}
					</div>
				</li>
			{/each}
		</ol>
	</section>
{/snippet}

{#if runs}
	<div class="mb-6">
		<RunSwitcher {runs} selected={shownRun} onselect={(n) => (pickedRun = { task: task.id, n })} />
	</div>
{/if}
{#if runs && run && run.n !== runs.current}
	<PastRun
		{run}
		{runs}
		steps={task.passage.steps}
		validations={(detail.validations ?? []).filter((v) => runAt(runs, v.startedAt) === run.n)}
		shots={shots.filter((s) => runAt(runs, s.modifiedAt) === run.n)}
		{onshot}
	/>
{:else}
	{#if run && run.n > 1}
		<!-- The changes that started this run, at its top. -->
		<div class="mb-6"><ChangeRequests {run} /></div>
	{/if}
	{@render currentStages(task)}
{/if}
