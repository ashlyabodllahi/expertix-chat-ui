<script lang="ts">
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import { page } from "$app/state";
	import { publicConfig } from "$lib/utils/PublicConfig.svelte";

	import ChatWindow from "$lib/components/chat/ChatWindow.svelte";
	import { ERROR_MESSAGES, error } from "$lib/stores/errors";
	import { pendingMessage } from "$lib/stores/pendingMessage";
	import { useSettingsStore } from "$lib/stores/settings.js";
	import { findCurrentModel } from "$lib/utils/models";
	import { onMount } from "svelte";

	let { data } = $props();
	let loading = $state(false);
	let files: File[] = $state([]);

	const settings = useSettingsStore();

	async function createConversation(messageData: { content: string; selectedAssistants?: Assistant[] }) {
		try {
			loading = true;

			const { content, selectedAssistants = [] } = messageData;

			// check if $settings.activeModel is a valid model
			// else check if it's an assistant, and use that model
			// else use the first model

			const validModels = data.models.map((model) => model.id);

			let model;
			if (validModels.includes($settings.activeModel)) {
				model = $settings.activeModel;
			} else {
				if (validModels.includes(data.assistant?.modelId)) {
					model = data.assistant?.modelId;
				} else {
					model = data.models[0].id;
				}
			}

			const requestBody: any = {
				model,
				preprompt: $settings.customPrompts[$settings.activeModel],
			};

			// Handle multiple assistants or single assistant
			if (selectedAssistants.length > 0) {
				requestBody.assistantIds = selectedAssistants.map(a => a._id);
			} else if (data.assistant?._id) {
				requestBody.assistantId = data.assistant._id;
			}

			const res = await fetch(`${base}/conversation`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(requestBody),
			});

			if (!res.ok) {
				const errorMessage = (await res.json()).message || ERROR_MESSAGES.default;
				error.set(errorMessage);
				console.error("Error while creating conversation: ", errorMessage);
				return;
			}

			const { conversationId } = await res.json();

			// Ugly hack to use a store as temp storage, feel free to improve ^^
			pendingMessage.set({
				content,
				files,
			});

			// invalidateAll to update list of conversations
			await goto(`${base}/conversation/${conversationId}`, { invalidateAll: true });
		} catch (err) {
			error.set((err as Error).message || ERROR_MESSAGES.default);
			console.error(err);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		// check if there's a ?q query param with a message
		const query = page.url.searchParams.get("q");
		if (query) createConversation({ content: query });
	});

	let currentModel = $derived(
		findCurrentModel(
			[...data.models, ...data.oldModels],
			!$settings.assistants.includes($settings.activeModel)
				? $settings.activeModel
				: data.assistant?.modelId
		)
	);
</script>

<svelte:head>
	<title>{publicConfig.PUBLIC_APP_NAME}</title>
</svelte:head>

<ChatWindow
	on:message={(ev) => createConversation(ev.detail)}
	{loading}
	assistant={data.assistant}
	{currentModel}
	models={data.models}
	bind:files
/>
