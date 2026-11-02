<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { ExternalLink } from '@lucide/svelte';
	import { playsInPlace } from '$lib/tour';

	/**
	 * Help's video tour, from where it is hosted: played here when `url` is the
	 * video itself, else (the README's tour section) a link that opens it in a new tab.
	 */
	let { url }: { url: string } = $props();

	const video = $derived(playsInPlace(url));
	const GUIDE = 'https://github.com/chrisjowen/wheelhouse/blob/main/docs/guide.md';
</script>

{#if video}
	<!-- The tour's captions are part of the picture. -->
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		class="aspect-[16/10] w-full rounded-md bg-primary"
		src={url}
		controls
		autoplay
		playsinline
		preload="metadata"
	></video>
{:else}
	<p>The tour is in Wheelhouse’s README on GitHub.</p>
{/if}
<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
	<Button variant="ghost" href={GUIDE} target="_blank" rel="noopener noreferrer"
		>Read the guide<ExternalLink /></Button
	>
	{#if !video}
		<Button href={url} target="_blank" rel="noopener noreferrer"
			>Watch the tour<ExternalLink /></Button
		>
	{/if}
</div>
