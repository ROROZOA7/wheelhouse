<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { CircleHelp } from '@lucide/svelte';
	import { DEFAULT_TOUR_URL, playsInPlace } from '$lib/tour';
	import TourPlayer from './TourPlayer.svelte';

	/**
	 * Help in the header: the video tour. Nothing is bundled with Wheelhouse; the
	 * tour plays from where it is hosted (TourPlayer).
	 */
	let { url = DEFAULT_TOUR_URL }: { url?: string } = $props();

	let open = $state(false);
</script>

<Button variant="ghost" size="icon-sm" aria-label="Help" onclick={() => (open = true)}>
	<CircleHelp />
</Button>

<Dialog.Root bind:open>
	<Dialog.Content class={playsInPlace(url) ? 'sm:max-w-4xl' : 'sm:max-w-md'}>
		<Dialog.Header>
			<Dialog.Title class="font-display text-lg">A short tour</Dialog.Title>
			<Dialog.Description>
				Two minutes on the chat, decisions, the Harbour, task pages and PR review.
			</Dialog.Description>
		</Dialog.Header>
		<TourPlayer {url} />
	</Dialog.Content>
</Dialog.Root>
