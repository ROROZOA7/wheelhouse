<script lang="ts">
	/**
	 * One decision box outside the Decisions page (On deck, the task page): the
	 * same DecisionCard, keeping its own evidence toggle, whose Agree sends
	 * Firstmate's recommendation through the inbox. An answered card leaves at
	 * once; one whose answer was not taken stays with the reason.
	 */
	import { page } from '$app/state';
	import { inbox } from '$lib/client/inbox.svelte';
	import { agreeWith } from '$lib/client/agree';
	import type { InboxCard, InboxView } from '$lib/inbox';
	import DecisionCard from './DecisionCard.svelte';

	let {
		card,
		project = null,
		now,
		onLater
	}: {
		card: InboxCard;
		project?: string | null;
		now: number;
		/** Ask me later, where the list honours it. */
		onLater?: () => void;
	} = $props();

	let expanded = $state(false);
	const token = $derived((page.data.sessionToken as string | undefined) ?? '');
</script>

<DecisionCard
	{card}
	{project}
	{expanded}
	canAnswer={inbox.view(page.data.inbox as InboxView | undefined)?.canAnswer ?? false}
	error={inbox.errors[card.id] ?? null}
	{now}
	onAgree={() => agreeWith(card, token)}
	{onLater}
	onClose={() => inbox.answer(card, 'close', null, token)}
	onToggle={() => (expanded = !expanded)}
/>
