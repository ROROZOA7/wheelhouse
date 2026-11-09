<script module lang="ts">
	// Small pieces the task page's panels share: why a value is unavailable, where it came
	// from, and a check's state icon.
	import { live } from '$lib/client/live.svelte';
	import { ago } from '$lib/format';
	import type { Available, Check } from '$lib/types';
	import { Check as CheckIcon, CircleDashed, LoaderCircle, Minus, X } from '@lucide/svelte';

	export { unavailable, source, checkIcon };
</script>

{#snippet unavailable(a: Available<unknown>)}
	{#if !a.available}<p class="text-sm text-muted-foreground">Not available. {a.reason}</p>{/if}
{/snippet}

{#snippet source(a: Available<unknown>)}
	{#if a.available}<p class="mt-1.5 text-xs text-muted-foreground">
			From {a.source}{a.observedAt ? `, ${ago(a.observedAt, live.now)}` : ''}.
		</p>{/if}
{/snippet}

{#snippet checkIcon(c: Check)}
	{#if c.state === 'pass'}<CheckIcon class="size-4 shrink-0 text-success" aria-label="Passed" />
	{:else if c.state === 'fail'}<X class="size-4 shrink-0 text-danger" aria-label="Failed" />
	{:else if c.state === 'running'}<LoaderCircle
			class="size-4 shrink-0 animate-spin text-muted-foreground"
			aria-label="Running"
		/>
	{:else if c.state === 'skipped'}<Minus
			class="size-4 shrink-0 text-muted-foreground"
			aria-label="Skipped"
		/>
	{:else}<CircleDashed class="size-4 shrink-0 text-muted-foreground" aria-label="Pending" />{/if}
{/snippet}
