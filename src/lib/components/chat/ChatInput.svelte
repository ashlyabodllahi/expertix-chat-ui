<script lang="ts">
	import { createEventDispatcher, onMount } from "svelte";

	import HoverTooltip from "$lib/components/HoverTooltip.svelte";
	import IconInternet from "$lib/components/icons/IconInternet.svelte";
	import IconImageGen from "$lib/components/icons/IconImageGen.svelte";
	import IconPaperclip from "$lib/components/icons/IconPaperclip.svelte";
	import { useSettingsStore } from "$lib/stores/settings";
	import { webSearchParameters } from "$lib/stores/webSearchParameters";
	import {
		documentParserToolId,
		fetchUrlToolId,
		imageGenToolId,
		webSearchToolId,
	} from "$lib/utils/toolIds";
	import type { Assistant } from "$lib/types/Assistant";
	import { page } from "$app/state";
	import type { ToolFront } from "$lib/types/Tool";
	import ToolLogo from "../ToolLogo.svelte";
	import { goto } from "$app/navigation";
	import { base } from "$app/paths";
	import IconAdd from "~icons/carbon/add";
	import { captureScreen } from "$lib/utils/screenshot";
	import IconScreenshot from "../icons/IconScreenshot.svelte";
	import { loginModalOpen } from "$lib/stores/loginModal";
	import { isVirtualKeyboard } from "$lib/utils/isVirtualKeyboard";
	import EosIconsLoading from "~icons/eos-icons/loading";

	interface Props {
		files?: File[];
		mimeTypes?: string[];
		value?: string;
		placeholder?: string;
		loading?: boolean;
		disabled?: boolean;
		assistant?: Assistant | undefined;
		modelHasTools?: boolean;
		modelIsMultimodal?: boolean;
		children?: import("svelte").Snippet;
		onPaste?: (e: ClipboardEvent) => void;
		focused?: boolean;
		selectedAssistants?: Assistant[];
	}

	let {
		files = $bindable([]),
		mimeTypes = [],
		value = $bindable(""),
		placeholder = "Ask anything",
		loading = false,
		disabled = false,
		assistant = undefined,
		modelHasTools = false,
		modelIsMultimodal = false,
		children,
		onPaste,
		focused = $bindable(false),
		selectedAssistants = [],
	}: Props = $props();

	const onFileChange = async (e: Event) => {
		if (!e.target) return;
		const target = e.target as HTMLInputElement;
		files = [...files, ...(target.files ?? [])];

		if (files.some((file) => file.type.startsWith("application/"))) {
			await settings.instantSet({
				tools: [...($settings.tools ?? []), documentParserToolId],
			});
		}
	};

	let textareaElement: HTMLTextAreaElement | undefined = $state();
	let isCompositionOn = $state(false);

	const dispatch = createEventDispatcher<{ submit: void }>();

	onMount(() => {
		if (!isVirtualKeyboard()) {
			textareaElement?.focus();
		}
		function onFormSubmit() {
			adjustTextareaHeight();
		}

		const formEl = textareaElement?.closest("form");
		formEl?.addEventListener("submit", onFormSubmit);
		return () => {
			formEl?.removeEventListener("submit", onFormSubmit);
		};
	});

	function adjustTextareaHeight() {
		if (!textareaElement) {
			return;
		}

		textareaElement.style.height = "auto";
		textareaElement.style.height = `${textareaElement.scrollHeight}px`;

		if (textareaElement.selectionStart === textareaElement.value.length) {
			textareaElement.scrollTop = textareaElement.scrollHeight;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (
			event.key === "Enter" &&
			!event.shiftKey &&
			!isCompositionOn &&
			!isVirtualKeyboard() &&
			value.trim() !== ""
		) {
			event.preventDefault();
			dispatch("submit");
		}
	}

	const settings = useSettingsStore();

	// tool section

	let webSearchIsOn = $derived(
		modelHasTools
			? ($settings.tools?.includes(webSearchToolId) ?? false) ||
					($settings.tools?.includes(fetchUrlToolId) ?? false)
			: $webSearchParameters.useSearch
	);
	let imageGenIsOn = $derived($settings.tools?.includes(imageGenToolId) ?? false);

	let documentParserIsOn = $derived(
		modelHasTools && files.length > 0 && files.some((file) => file.type.startsWith("application/"))
	);

	let extraTools = $derived(
		page.data.tools
			.filter((t: ToolFront) => $settings.tools?.includes(t._id))
			.filter(
				(t: ToolFront) =>
					![documentParserToolId, imageGenToolId, webSearchToolId, fetchUrlToolId].includes(t._id)
			) satisfies ToolFront[]
	);

	let showWebSearch = $derived(!assistant);
	let showImageGen = $derived(modelHasTools && !assistant);
	let showFileUpload = $derived((modelIsMultimodal || modelHasTools) && mimeTypes.length > 0);
	let showExtraTools = $derived(modelHasTools && !assistant);

	let showNoTools = $derived(!showWebSearch && !showImageGen && !showFileUpload && !showExtraTools);

	let submitDisabled = $derived(
		loading || 
		disabled || 
		!value.trim() || 
		// Only in new chat mode (no assistant), require experts to be selected
		(!assistant && (!selectedAssistants || selectedAssistants.length === 0))
	);
</script>

<div class="flex min-h-full flex-1 flex-col" onpaste={onPaste}>
	<textarea
		rows="1"
		tabindex="0"
		inputmode="text"
		class="scrollbar-custom max-h-[4lh] w-full resize-none overflow-y-auto overflow-x-hidden border-0 bg-transparent px-2.5 py-2.5 outline-none focus:ring-0 focus-visible:ring-0 sm:px-3"
		class:text-gray-400={disabled}
		bind:value
		bind:this={textareaElement}
		onkeydown={handleKeydown}
		oncompositionstart={() => (isCompositionOn = true)}
		oncompositionend={() => (isCompositionOn = false)}
		oninput={adjustTextareaHeight}
		onbeforeinput={(ev) => {
			if (page.data.loginRequired) {
				ev.preventDefault();
				$loginModalOpen = true;
			}
		}}
		{placeholder}
		{disabled}
		onfocus={() => (focused = true)}
		onblur={() => (focused = false)}
	></textarea>

	{#if !showNoTools}
		<div
			class={[
				"scrollbar-custom -ml-0.5 flex max-w-[calc(100%-40px)] flex-wrap items-center justify-start gap-2.5 px-3 pb-2.5 pt-1.5 text-gray-500 dark:text-gray-400 max-md:flex-nowrap max-md:overflow-x-auto sm:gap-2",
			]}
		>
			{#if showWebSearch}
				<HoverTooltip
					label="Search the web"
					position="top"
					TooltipClassNames="text-xs !text-left !w-auto whitespace-nowrap !py-1 !mb-0 max-sm:hidden {webSearchIsOn
						? 'hidden'
						: ''}"
				>
					<button
						class="base-tool"
						class:active-tool={webSearchIsOn}
						disabled={loading}
						onclick={async (e) => {
							e.preventDefault();
							if (modelHasTools) {
								if (webSearchIsOn) {
									await settings.instantSet({
										tools: ($settings.tools ?? []).filter(
											(t) => t !== webSearchToolId && t !== fetchUrlToolId
										),
									});
								} else {
									await settings.instantSet({
										tools: [...($settings.tools ?? []), webSearchToolId, fetchUrlToolId],
									});
								}
							} else {
								$webSearchParameters.useSearch = !webSearchIsOn;
							}
						}}
					>
						<IconInternet classNames="text-xl" />
						{#if webSearchIsOn}
							Search
						{/if}
					</button>
				</HoverTooltip>
			{/if}
			{#if showImageGen}
				<HoverTooltip
					label="Generate	images"
					position="top"
					TooltipClassNames="text-xs !text-left !w-auto whitespace-nowrap !py-1 !mb-0 max-sm:hidden {imageGenIsOn
						? 'hidden'
						: ''}"
				>
					<button
						class="base-tool"
						class:active-tool={imageGenIsOn}
						disabled={loading}
						onclick={async (e) => {
							e.preventDefault();
							if (modelHasTools) {
								if (imageGenIsOn) {
									await settings.instantSet({
										tools: ($settings.tools ?? []).filter((t) => t !== imageGenToolId),
									});
								} else {
									await settings.instantSet({
										tools: [...($settings.tools ?? []), imageGenToolId],
									});
								}
							}
						}}
					>
						<IconImageGen classNames="text-xl" />
						{#if imageGenIsOn}
							Image Gen
						{/if}
					</button>
				</HoverTooltip>
			{/if}
			{#if showFileUpload}
				{@const mimeTypesString = mimeTypes
					.map((m) => {
						// if the mime type ends in *, grab the first part so image/* becomes image
						if (m.endsWith("*")) {
							return m.split("/")[0];
						}
						// otherwise, return the second part for example application/pdf becomes pdf
						return m.split("/")[1];
					})
					.join(", ")}
				<div class="flex items-center">
					<HoverTooltip
						label={mimeTypesString.includes("*")
							? "Upload any file"
							: `Upload ${mimeTypesString} files`}
						position="top"
						TooltipClassNames="text-xs !text-left !w-auto whitespace-nowrap !py-1 !mb-0 max-sm:hidden"
					>
						<label class="base-tool relative" class:active-tool={documentParserIsOn}>
							<input
								disabled={loading}
								class="absolute hidden size-0"
								aria-label="Upload file"
								type="file"
								onchange={onFileChange}
								accept={mimeTypes.join(",")}
							/>
							<IconPaperclip classNames="text-xl" />
							{#if documentParserIsOn}
								Document Parser
							{/if}
						</label>
					</HoverTooltip>
				</div>
				{#if mimeTypes.includes("image/*")}
					<HoverTooltip
						label="Capture screenshot"
						position="top"
						TooltipClassNames="text-xs !text-left !w-auto whitespace-nowrap !py-1 !mb-0 max-sm:hidden"
					>
						<button
							class="base-tool"
							onclick={async (e) => {
								e.preventDefault();
								const screenshot = await captureScreen();

								// Convert base64 to blob
								const base64Response = await fetch(screenshot);
								const blob = await base64Response.blob();

								// Create a File object from the blob
								const file = new File([blob], "screenshot.png", { type: "image/png" });

								files = [...files, file];
							}}
						>
							<IconScreenshot classNames="text-xl" />
						</button>
					</HoverTooltip>
				{/if}
			{/if}
			{#if showExtraTools}
				{#each extraTools as tool}
					<button
						class="active-tool base-tool"
						disabled={loading}
						onclick={async (e) => {
							e.preventDefault();
							goto(`${base}/tools/${tool._id}`);
						}}
					>
						{#key tool.icon + tool.color}
							<ToolLogo icon={tool.icon} color={tool.color} size="xs" />
						{/key}
						{tool.displayName}
					</button>
				{/each}
				<HoverTooltip
					label="Browse more tools"
					position="right"
					TooltipClassNames="text-xs !text-left !w-auto whitespace-nowrap !py-1 max-sm:hidden"
				>
					<a
						class="base-tool flex !size-[20px] items-center justify-center rounded-full border !border-gray-200 !bg-white !transition-none dark:!border-gray-500 dark:!bg-transparent"
						href={`${base}/tools`}
						title="Browse more tools"
					>
						<IconAdd class="text-sm" />
					</a>
				</HoverTooltip>
			{/if}
		</div>
	{/if}
	{@render children?.()}

	{#if loading}
		<button
			disabled
			class="btn absolute bottom-1 right-0.5 size-10 self-end rounded-lg bg-transparent text-gray-400"
		>
			<EosIconsLoading />
		</button>
	{:else}
		<button
			class="btn absolute bottom-2 right-2 size-7 self-end rounded-full border shadow transition-none {submitDisabled 
				? 'bg-gray-200 text-gray-400 border-gray-200 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500 dark:border-gray-600' 
				: 'bg-white text-black border-gray-300 hover:bg-white hover:shadow-inner dark:border-gray-600 dark:bg-gray-900 dark:text-white dark:hover:enabled:bg-black'}"
			disabled={submitDisabled}
			type="submit"
			aria-label={!assistant && (!selectedAssistants || selectedAssistants.length === 0) ? "Select experts to send message" : "Send message"}
			name="submit"
			title={!assistant && (!selectedAssistants || selectedAssistants.length === 0) ? "Select at least one expert to send your message" : "Send message"}
		>
			<svg
				width="1em"
				height="1em"
				viewBox="0 0 32 32"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
			>
				<path
					fill-rule="evenodd"
					clip-rule="evenodd"
					d="M17.0606 4.23197C16.4748 3.64618 15.525 3.64618 14.9393 4.23197L5.68412 13.4871C5.09833 14.0729 5.09833 15.0226 5.68412 15.6084C6.2699 16.1942 7.21965 16.1942 7.80544 15.6084L14.4999 8.91395V26.7074C14.4999 27.5359 15.1715 28.2074 15.9999 28.2074C16.8283 28.2074 17.4999 27.5359 17.4999 26.7074V8.91395L24.1944 15.6084C24.7802 16.1942 25.7299 16.1942 26.3157 15.6084C26.9015 15.0226 26.9015 14.0729 26.3157 13.4871L17.0606 4.23197Z"
					fill="currentColor"
				/>
			</svg>
		</button>
	{/if}
</div>

<style lang="postcss">
	:global(pre),
	:global(textarea) {
		font-family: inherit;
		box-sizing: border-box;
		line-height: 1.5;
		font-size: 16px;
	}
</style>
