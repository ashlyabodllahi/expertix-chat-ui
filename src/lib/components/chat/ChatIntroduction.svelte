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
	import CarbonClose from "~icons/carbon/close";
	import CarbonSearch from "~icons/carbon/search";
	import IconInternet from "../icons/IconInternet.svelte";
	import { formatUserCount } from "$lib/utils/formatUserCount";
	import { useSettingsStore } from "$lib/stores/settings";

	interface Props {
		currentModel: Model;
	}

	let { currentModel }: Props = $props();

	const dispatch = createEventDispatcher<{ 
		message: string;
		selectedAssistants: Assistant[];
	}>();
	const settings = useSettingsStore();

	let assistants: Assistant[] = $state([]);
	let filteredAssistants: Assistant[] = $state([]);
	let selectedAssistants: Assistant[] = $state([]);
	let loading = $state(true);
	let searchQuery = $state("");

	const MAX_SELECTED = 7;

	// Dispatch selectedAssistants changes to parent
	$effect(() => {
		dispatch("selectedAssistants", selectedAssistants);
	});

	onMount(async () => {
		try {
			// Fetch assistants from the API
			const response = await fetch(`${base}/api/assistants?p=0`);
			const data = await response.json();
			assistants = data.assistants.slice(0, 30); // Show top 30 assistants
			filteredAssistants = assistants;
		} catch (error) {
			console.error("Failed to fetch assistants:", error);
		} finally {
			loading = false;
		}
	});

	$effect(() => {
		// Filter assistants based on search query
		if (searchQuery.trim() === "") {
			filteredAssistants = assistants;
		} else {
			const query = searchQuery.toLowerCase().trim();
			filteredAssistants = assistants.filter(assistant => 
				assistant.name.toLowerCase().includes(query) ||
				assistant.description?.toLowerCase().includes(query)
			);
		}
	});

	function handleAssistantClick(assistant: Assistant) {
		const isSelected = selectedAssistants.some(a => a._id === assistant._id);
		
		if (isSelected) {
			// Remove from selection
			selectedAssistants = selectedAssistants.filter(a => a._id !== assistant._id);
		} else {
			// Add to selection if under limit
			if (selectedAssistants.length < MAX_SELECTED) {
				selectedAssistants = [...selectedAssistants, assistant];
			}
		}
	}

	function removeSelectedAssistant(assistant: Assistant) {
		selectedAssistants = selectedAssistants.filter(a => a._id !== assistant._id);
	}

	function isAssistantSelected(assistant: Assistant): boolean {
		return selectedAssistants.some(a => a._id === assistant._id);
	}
</script>

<div class="my-auto grid gap-8">
	<!-- Header Section -->
	<div class="grid gap-8 lg:grid-cols-3">
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
	</div>

	<!-- Expert Selection Section -->
	<div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
		<!-- Header -->
		<div class="mb-6 text-center">
			<h2 class="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
				Expert Consultation Panel
			</h2>
			<p class="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
				Select up to {MAX_SELECTED} specialized experts to collaborate on your project. 
				Each expert brings unique capabilities and knowledge to assist you.
			</p>
			<div class="mt-3 inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
				<span class="h-2 w-2 rounded-full bg-blue-500"></span>
				{selectedAssistants.length} of {MAX_SELECTED} experts selected
			</div>
		</div>

		<div class="grid gap-6 lg:grid-cols-3">
			<!-- Available Experts (Left Panel) -->
			<div class="lg:col-span-2">
				<div class="mb-4 flex items-center justify-between">
					<h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Available Experts</h3>
					<!-- Search Bar -->
					<div class="relative w-72">
						<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
							<CarbonSearch class="h-4 w-4 text-gray-400" />
						</div>
						<input
							type="text"
							bind:value={searchQuery}
							placeholder="Search experts..."
							class="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-400"
						/>
					</div>
				</div>
				
				{#if loading}
					<div class="grid grid-cols-2 gap-4 md:grid-cols-3">
						{#each Array(12) as _}
							<div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
								<div class="mb-3 h-12 w-12 animate-pulse rounded-full bg-gray-300 dark:bg-gray-600"></div>
								<div class="mb-2 h-4 w-24 animate-pulse rounded bg-gray-300 dark:bg-gray-600"></div>
								<div class="flex gap-1">
									<div class="h-3 w-3 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"></div>
									<div class="h-3 w-3 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"></div>
								</div>
							</div>
						{/each}
					</div>
				{:else if filteredAssistants.length === 0}
					<div class="text-center py-12">
						<div class="mx-auto h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center dark:bg-gray-800 mb-4">
							<CarbonSearch class="h-6 w-6 text-gray-400" />
						</div>
						<p class="text-gray-500 dark:text-gray-400">
							{searchQuery ? `No experts found matching "${searchQuery}"` : "No experts available"}
						</p>
					</div>
				{:else}
					<div class="grid grid-cols-2 gap-4 md:grid-cols-3 max-h-96 overflow-y-auto pr-2">
						{#each filteredAssistants as assistant}
							{@const hasRag =
								assistant?.rag?.allowAllDomains ||
								!!assistant?.rag?.allowedDomains?.length ||
								!!assistant?.rag?.allowedLinks?.length ||
								!!assistant?.dynamicPrompt}
							{@const isSelected = isAssistantSelected(assistant)}
							
							<button
								type="button"
								class="group relative flex flex-col items-start rounded-lg border p-4 text-left transition-all duration-200 {isSelected 
									? 'border-blue-500 bg-blue-50 shadow-lg ring-2 ring-blue-200 dark:border-blue-400 dark:bg-blue-950/30 dark:ring-blue-800' 
									: 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600'} {selectedAssistants.length >= MAX_SELECTED && !isSelected ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}"
								onclick={() => handleAssistantClick(assistant)}
								disabled={selectedAssistants.length >= MAX_SELECTED && !isSelected}
							>
								{#if isSelected}
									<div class="absolute -top-2 -right-2 rounded-full bg-blue-500 p-1.5 shadow-lg">
										<svg class="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 20 20">
											<path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
										</svg>
									</div>
								{/if}

								<div class="mb-3 flex w-full items-start justify-between">
									{#if assistant.avatar}
										<img
											src="{base}/settings/assistants/{assistant._id}/avatar.jpg"
											alt="Avatar"
											class="h-12 w-12 rounded-full object-cover ring-2 ring-gray-200 dark:ring-gray-600"
										/>
									{:else}
										<div
											class="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-gray-400 to-gray-600 text-lg font-bold text-white"
										>
											{assistant.name[0]}
										</div>
									{/if}
									
									{#if assistant.userCount && assistant.userCount > 1}
										<div
											class="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300"
											title="Number of users"
										>
											<CarbonUserMultiple class="h-3 w-3" />
											{formatUserCount(assistant.userCount)}
										</div>
									{/if}
								</div>

								<h3 class="mb-2 line-clamp-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
									{assistant.name}
								</h3>

								<div class="flex gap-2">
									{#if assistant.tools?.length}
										<div
											class="flex items-center gap-1 rounded-full bg-purple-100 px-2 py-1 text-xs text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
											title="Has tools capabilities"
										>
											<CarbonTools class="h-3 w-3" />
											Tools
										</div>
									{/if}
									{#if hasRag}
										<div
											class="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
											title="Web search capabilities"
										>
											<IconInternet classNames="h-3 w-3" />
											Web
										</div>
									{/if}
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Selected Panel (Right Panel) -->
			<div class="lg:col-span-1">
				<div class="sticky top-0">
					<h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Expert Panel</h3>
					
					<div class="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800 min-h-64">
						{#if selectedAssistants.length === 0}
							<div class="flex h-full items-center justify-center text-center">
								<div>
									<div class="mx-auto mb-4 h-16 w-16 rounded-full bg-gray-200 flex items-center justify-center dark:bg-gray-700">
										<svg class="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
										</svg>
									</div>
									<h4 class="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
										Build Your Expert Team
									</h4>
									<p class="text-sm text-gray-500 dark:text-gray-400">
										Select experts from the available list to create your consultation panel. Then use the message input below to start your consultation.
									</p>
								</div>
							</div>
						{:else}
							<div class="space-y-3">
								{#each selectedAssistants as assistant, index}
									<div class="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-600 dark:bg-gray-700">
										<div class="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300">
											{index + 1}
										</div>
										{#if assistant.avatar}
											<img
												src="{base}/settings/assistants/{assistant._id}/avatar.jpg"
												alt="Avatar"
												class="h-8 w-8 rounded-full object-cover"
											/>
										{:else}
											<div
												class="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-gray-400 to-gray-600 text-sm font-bold text-white"
											>
												{assistant.name[0]}
											</div>
										{/if}
										<div class="flex-1 min-w-0">
											<h4 class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
												{assistant.name}
											</h4>
										</div>
										<button
											class="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-red-100 hover:text-red-600 transition-colors dark:bg-gray-600 dark:text-gray-400 dark:hover:bg-red-900 dark:hover:text-red-400"
											onclick={() => removeSelectedAssistant(assistant)}
											title="Remove expert"
										>
											<CarbonClose class="h-3 w-3" />
										</button>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</div>

	{#if currentModel.promptExamples}
		<div class="lg:mt-6">
			<p class="mb-3 text-center text-gray-600 dark:text-gray-300 lg:text-left">Quick Start Examples</p>
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
