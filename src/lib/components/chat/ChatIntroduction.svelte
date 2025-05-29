<script lang="ts">
	import { publicConfig } from "$lib/utils/PublicConfig.svelte";

	import Logo from "$lib/components/icons/Logo.svelte";
	import { createEventDispatcher, onMount } from "svelte";
	import IconGear from "~icons/bi/gear-fill";
	import AnnouncementBanner from "../AnnouncementBanner.svelte";
	import type { Model } from "$lib/types/Model";
	import ModelCardMetadata from "../ModelCardMetadata.svelte";
	import { base } from "$app/paths";
	import JSON5 from "json5";
	import type { Assistant } from "$lib/types/Assistant";
	import { goto } from "$app/navigation";
	import { page } from "$app/stores";
	import CarbonUserMultiple from "~icons/carbon/user-multiple";
	import CarbonTools from "~icons/carbon/tools";
	import IconInternet from "../icons/IconInternet.svelte";
	import { formatUserCount } from "$lib/utils/formatUserCount";
	import { useSettingsStore } from "$lib/stores/settings";

	interface Props {
		currentModel: Model;
	}

	let { currentModel }: Props = $props();

	const dispatch = createEventDispatcher<{ message: string }>();
	const settings = useSettingsStore();

	let assistants: Assistant[] = $state([]);
	let loading = $state(true);

	onMount(async () => {
		try {
			// Fetch popular assistants from the API
			const response = await fetch(`${base}/api/assistants?p=0`);
			const data = await response.json();
			assistants = data.assistants.slice(0, 8); // Show top 8 assistants
		} catch (error) {
			console.error("Failed to fetch assistants:", error);
		} finally {
			loading = false;
		}
	});

	function handleAssistantClick(assistant: Assistant) {
		if ($settings.assistants.includes(assistant._id.toString())) {
			// Assistant is already in user's list, set as active model
			settings.instantSet({ activeModel: assistant._id.toString() });
			goto(`${base}` || "/");
		} else {
			// Navigate to assistant page
			goto(`${base}/assistant/${assistant._id}`);
		}
	}
</script>

<div class="my-auto grid gap-8 lg:grid-cols-3">
	<div class="lg:col-span-1">
		<div>
			<div class="mb-3 flex items-center text-2xl font-semibold">
				<Logo classNames="mr-1 flex-none" />
				{publicConfig.PUBLIC_APP_NAME}
				<div
					class="ml-3 flex h-6 items-center rounded-lg border border-gray-100 bg-gray-50 px-2 text-base text-gray-400 dark:border-gray-700/60 dark:bg-gray-800"
				>
					v{publicConfig.PUBLIC_VERSION}
				</div>
			</div>
			<p class="text-base text-gray-600 dark:text-gray-400">
				{publicConfig.PUBLIC_APP_DESCRIPTION ||
					"Making the community's best AI chat models available to everyone."}
			</p>
		</div>
	</div>
	<div class="lg:col-span-2 lg:pl-24">
		{#each JSON5.parse(publicConfig.PUBLIC_ANNOUNCEMENT_BANNERS || "[]") as banner}
			<AnnouncementBanner classNames="mb-4" title={banner.title}>
				<a
					target={banner.external ? "_blank" : "_self"}
					href={banner.linkHref}
					class="mr-2 flex items-center underline hover:no-underline">{banner.linkTitle}</a
				>
			</AnnouncementBanner>
		{/each}
		<div class="overflow-hidden rounded-xl border dark:border-gray-800">
			<div class="flex p-3">
				<div>
					<div class="text-sm text-gray-600 dark:text-gray-400">Current Model</div>
					<div class="flex items-center gap-1.5 font-semibold max-sm:text-smd">
						{#if currentModel.logoUrl}
							<img
								class=" overflown aspect-square size-4 rounded border dark:border-gray-700"
								src={currentModel.logoUrl}
								alt=""
							/>
						{:else}
							<div
								class="size-4 rounded border border-transparent bg-gray-300 dark:bg-gray-800"
							></div>
						{/if}
						{currentModel.displayName}
					</div>
				</div>
				<a
					href="{base}/settings/{currentModel.id}"
					aria-label="Settings"
					class="btn ml-auto flex h-7 w-7 self-start rounded-full bg-gray-100 p-1 text-xs hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-600"
					><IconGear /></a
				>
			</div>
			<ModelCardMetadata variant="dark" model={currentModel} />
		</div>
	</div>

	<!-- Available Assistants Section -->
	{#if !loading && assistants.length > 0}
		<div class="lg:col-span-3 lg:mt-6">
			<div class="mb-4 flex items-center justify-between">
				<p class="text-center text-gray-600 dark:text-gray-300 lg:text-left">Popular Assistants</p>
				<a 
					href="{base}/assistants" 
					class="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
				>
					View all
				</a>
			</div>
			<div class="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-4">
				{#each assistants as assistant}
					{@const hasRag =
						assistant?.rag?.allowAllDomains ||
						!!assistant?.rag?.allowedDomains?.length ||
						!!assistant?.rag?.allowedLinks?.length ||
						!!assistant?.dynamicPrompt}
					
					<button
						type="button"
						class="relative flex flex-col items-center justify-center overflow-hidden text-balance rounded-xl border bg-gray-50/50 p-3 text-center shadow hover:bg-gray-50 hover:shadow-inner dark:border-gray-800/70 dark:bg-gray-950/20 dark:hover:bg-gray-950/40"
						onclick={() => handleAssistantClick(assistant)}
					>
						{#if assistant.userCount && assistant.userCount > 1}
							<div
								class="absolute right-2 top-2 flex items-center gap-1 text-xs text-gray-400"
								title="Number of users"
							>
								<CarbonUserMultiple class="text-xxs" />{formatUserCount(assistant.userCount)}
							</div>
						{/if}

						<div class="absolute left-2 top-2 flex items-center gap-1 text-xs text-gray-400">
							{#if assistant.tools?.length}
								<div
									class="grid size-4 place-items-center rounded-full bg-purple-500/10"
									title="This assistant can use tools"
								>
									<CarbonTools class="text-xs text-purple-600" />
								</div>
							{/if}
							{#if hasRag}
								<div
									class="grid size-4 place-items-center rounded-full bg-blue-500/10"
									title="This assistant uses the websearch."
								>
									<IconInternet classNames="text-sm text-blue-600" />
								</div>
							{/if}
						</div>

						{#if assistant.avatar}
							<img
								src="{base}/settings/assistants/{assistant._id}/avatar.jpg"
								alt="Avatar"
								class="mb-2 aspect-square size-10 flex-none rounded-full object-cover"
							/>
						{:else}
							<div
								class="mb-2 flex aspect-square size-10 flex-none items-center justify-center rounded-full bg-gray-300 text-lg font-bold uppercase text-gray-500 dark:bg-gray-800"
							>
								{assistant.name[0]}
							</div>
						{/if}
						<h3
							class="mb-1 line-clamp-2 max-w-full break-words text-center text-xs font-semibold leading-snug"
						>
							{assistant.name}
						</h3>
						<p class="line-clamp-2 text-xs text-gray-700 dark:text-gray-400">
							{assistant.description}
						</p>
					</button>
				{/each}
			</div>
		</div>
	{:else if loading}
		<div class="lg:col-span-3 lg:mt-6">
			<p class="mb-3 text-center text-gray-600 dark:text-gray-300 lg:text-left">Popular Assistants</p>
			<div class="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-4">
				{#each Array(8) as _}
					<div class="flex flex-col items-center justify-center rounded-xl border bg-gray-50/50 p-3 dark:border-gray-800/70 dark:bg-gray-950/20">
						<div class="mb-2 h-10 w-10 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"></div>
						<div class="mb-1 h-3 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
						<div class="h-2 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if currentModel.promptExamples}
		<div class="lg:col-span-3 lg:mt-6">
			<p class="mb-3 text-center text-gray-600 dark:text-gray-300 lg:text-left">Examples</p>
			<div
				class="flex max-h-60 gap-2 overflow-x-auto pb-2 text-center scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-700 lg:grid lg:grid-cols-3 lg:overflow-y-auto lg:text-left"
			>
				{#each currentModel.promptExamples as example}
					<button
						type="button"
						class="flex-shrink-0 rounded-xl border bg-gray-50 p-2.5 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 sm:p-3 lg:w-full xl:p-3.5 xl:text-base"
						onclick={() => dispatch("message", example.prompt)}
					>
						{example.title}
					</button>
				{/each}
			</div>
		</div>
	{/if}
	<div class="h-40 sm:h-24"></div>
</div>
