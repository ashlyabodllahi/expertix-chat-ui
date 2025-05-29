<script lang="ts">
	import { base } from "$app/paths";
	import type { Assistant } from "$lib/types/Assistant";

	interface Props {
		assistants: Assistant[];
	}

	let { assistants }: Props = $props();
</script>

{#if assistants && assistants.length > 0}
	<div class="mb-4 border-b border-gray-200 dark:border-gray-700 pb-4">
		<div class="flex flex-wrap items-center gap-3">
			<span class="text-sm font-medium text-gray-600 dark:text-gray-400">Selected Experts:</span>
			{#each assistants as assistant}
				<div class="flex items-center gap-2 rounded-full bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5">
					{#if assistant.avatar}
						<img
							src="{base}/settings/assistants/{assistant._id}/avatar.jpg"
							alt="{assistant.name} Avatar"
							class="h-5 w-5 rounded-full object-cover"
						/>
					{:else}
						<div class="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-xs font-bold text-white">
							{assistant.name[0]}
						</div>
					{/if}
					<span class="text-sm font-medium text-blue-700 dark:text-blue-300">{assistant.name}</span>
				</div>
			{/each}
		</div>
	</div>
{/if} 