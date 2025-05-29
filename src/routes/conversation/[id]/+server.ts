import { config } from "$lib/server/config";
import { startOfHour } from "date-fns";
import { authCondition, requiresUser } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { models, validModelIdSchema } from "$lib/server/models";
import { ERROR_MESSAGES } from "$lib/stores/errors";
import type { Message } from "$lib/types/Message";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";
import {
	MessageReasoningUpdateType,
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { uploadFile } from "$lib/server/files/uploadFile";
import { convertLegacyConversation } from "$lib/utils/tree/convertLegacyConversation";
import { isMessageId } from "$lib/utils/tree/isMessageId";
import { buildSubtree } from "$lib/utils/tree/buildSubtree.js";
import { addChildren } from "$lib/utils/tree/addChildren.js";
import { addSibling } from "$lib/utils/tree/addSibling.js";
import { usageLimits } from "$lib/server/usageLimits";
import { MetricsServer } from "$lib/server/metrics";
import { textGeneration } from "$lib/server/textGeneration";
import type { TextGenerationContext } from "$lib/server/textGeneration/types";
import { logger } from "$lib/server/logger.js";
import { documentParserToolId } from "$lib/utils/toolIds.js";
import type { Assistant } from "$lib/types/Assistant";

export async function POST({ request, locals, params, getClientAddress }) {
	const id = z.string().parse(params.id);
	const convId = new ObjectId(id);
	const promptedAt = new Date();

	const userId = locals.user?._id ?? locals.sessionId;

	// check user
	if (!userId) {
		error(401, "Unauthorized");
	}

	// check if the user has access to the conversation
	const convBeforeCheck = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (convBeforeCheck && !convBeforeCheck.rootMessageId) {
		const res = await collections.conversations.updateOne(
			{
				_id: convId,
			},
			{
				$set: {
					...convBeforeCheck,
					...convertLegacyConversation(convBeforeCheck),
				},
			}
		);

		if (!res.acknowledged) {
			error(500, "Failed to convert conversation");
		}
	}

	const conv = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conv) {
		error(404, "Conversation not found");
	}

	// register the event for ratelimiting
	await collections.messageEvents.insertOne({
		userId,
		createdAt: new Date(),
		ip: getClientAddress(),
	});

	const messagesBeforeLogin = config.MESSAGES_BEFORE_LOGIN
		? parseInt(config.MESSAGES_BEFORE_LOGIN)
		: 0;

	// guest mode check
	if (!locals.user?._id && requiresUser && messagesBeforeLogin) {
		const totalMessages =
			(
				await collections.conversations
					.aggregate([
						{ $match: { ...authCondition(locals), "messages.from": "assistant" } },
						{ $project: { messages: 1 } },
						{ $limit: messagesBeforeLogin + 1 },
						{ $unwind: "$messages" },
						{ $match: { "messages.from": "assistant" } },
						{ $count: "messages" },
					])
					.toArray()
			)[0]?.messages ?? 0;

		if (totalMessages > messagesBeforeLogin) {
			error(429, "Exceeded number of messages before login");
		}
	}

	if (usageLimits?.messagesPerMinute) {
		// check if the user is rate limited
		const nEvents = Math.max(
			await collections.messageEvents.countDocuments({
				userId,
				createdAt: { $gte: new Date(Date.now() - 60_000) },
			}),
			await collections.messageEvents.countDocuments({
				ip: getClientAddress(),
				createdAt: { $gte: new Date(Date.now() - 60_000) },
			})
		);
		if (nEvents > usageLimits.messagesPerMinute) {
			error(429, ERROR_MESSAGES.rateLimited);
		}
	}

	if (usageLimits?.messages && conv.messages.length > usageLimits.messages) {
		error(
			429,
			`This conversation has more than ${usageLimits.messages} messages. Start a new one to continue`
		);
	}

	// fetch the model
	const model = models.find((m) => m.id === conv.model);

	if (!model) {
		error(410, "Model not available anymore");
	}

	// finally parse the content of the request
	const form = await request.formData();

	const json = form.get("data");

	if (!json || typeof json !== "string") {
		error(400, "Invalid request");
	}

	const {
		inputs: newPrompt,
		id: messageId,
		is_retry: isRetry,
		is_continue: isContinue,
		web_search: webSearch,
		tools: toolsPreferences,
	} = z
		.object({
			id: z.string().uuid().refine(isMessageId).optional(), // parent message id to append to for a normal message, or the message id for a retry/continue
			inputs: z.optional(
				z
					.string()
					.min(1)
					.transform((s) => s.replace(/\r\n/g, "\n"))
			),
			is_retry: z.optional(z.boolean()),
			is_continue: z.optional(z.boolean()),
			web_search: z.optional(z.boolean()),
			tools: z.array(z.string()).optional(),
			files: z.optional(
				z.array(
					z.object({
						type: z.literal("base64").or(z.literal("hash")),
						name: z.string(),
						value: z.string(),
						mime: z.string(),
					})
				)
			),
		})
		.parse(JSON.parse(json));

	const inputFiles = await Promise.all(
		form
			.getAll("files")
			.filter((entry): entry is File => entry instanceof File && entry.size > 0)
			.map(async (file) => {
				const [type, ...name] = file.name.split(";");

				return {
					type: z.literal("base64").or(z.literal("hash")).parse(type),
					value: await file.text(),
					mime: file.type,
					name: name.join(";"),
				};
			})
	);

	// Check for PDF files in the input
	const hasPdfFiles = inputFiles?.some((file) => file.mime === "application/pdf") ?? false;

	// Check for existing PDF files in the conversation
	const hasPdfInConversation =
		conv.messages?.some((msg) => msg.files?.some((file) => file.mime === "application/pdf")) ??
		false;

	if (usageLimits?.messageLength && (newPrompt?.length ?? 0) > usageLimits.messageLength) {
		error(400, "Message too long.");
	}

	// each file is either:
	// base64 string requiring upload to the server
	// hash pointing to an existing file
	const hashFiles = inputFiles?.filter((file) => file.type === "hash") ?? [];
	const b64Files =
		inputFiles
			?.filter((file) => file.type !== "hash")
			.map((file) => {
				const blob = Buffer.from(file.value, "base64");
				return new File([blob], file.name, { type: file.mime });
			}) ?? [];

	// check sizes
	// todo: make configurable
	if (b64Files.some((file) => file.size > 10 * 1024 * 1024)) {
		error(413, "File too large, should be <10MB");
	}

	const uploadedFiles = await Promise.all(b64Files.map((file) => uploadFile(file, conv))).then(
		(files) => [...files, ...hashFiles]
	);

	// we will append tokens to the content of this message
	let messageToWriteToId: Message["id"] | undefined = undefined;
	// used for building the prompt, subtree of the conversation that goes from the latest message to the root
	let messagesForPrompt: Message[] = [];

	if (isContinue && messageId) {
		// if it's the last message and we continue then we build the prompt up to the last message
		// we will strip the end tokens afterwards when the prompt is built
		if ((conv.messages.find((msg) => msg.id === messageId)?.children?.length ?? 0) > 0) {
			error(400, "Can only continue the last message");
		}
		messageToWriteToId = messageId;
		messagesForPrompt = buildSubtree(conv, messageId);
	} else if (isRetry && messageId) {
		// two cases, if we're retrying a user message with a newPrompt set,
		// it means we're editing a user message
		// if we're retrying on an assistant message, newPrompt cannot be set
		// it means we're retrying the last assistant message for a new answer

		const messageToRetry = conv.messages.find((message) => message.id === messageId);

		if (!messageToRetry) {
			error(404, "Message not found");
		}

		if (messageToRetry.from === "user" && newPrompt) {
			// add a sibling to this message from the user, with the alternative prompt
			// add a children to that sibling, where we can write to
			const newUserMessageId = addSibling(
				conv,
				{
					from: "user",
					content: newPrompt,
					files: uploadedFiles,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				messageId
			);
			messageToWriteToId = addChildren(
				conv,
				{
					from: "assistant",
					content: "",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				newUserMessageId
			);
			messagesForPrompt = buildSubtree(conv, newUserMessageId);
		} else if (messageToRetry.from === "assistant") {
			// we're retrying an assistant message, to generate a new answer
			// just add a sibling to the assistant answer where we can write to
			messageToWriteToId = addSibling(
				conv,
				{ from: "assistant", content: "", createdAt: new Date(), updatedAt: new Date() },
				messageId
			);
			messagesForPrompt = buildSubtree(conv, messageId);
			messagesForPrompt.pop(); // don't need the latest assistant message in the prompt since we're retrying it
		}
	} else {
		// just a normal linear conversation, so we add the user message
		// and the blank assistant message back to back
		const newUserMessageId = addChildren(
			conv,
			{
				from: "user",
				content: newPrompt ?? "",
				files: uploadedFiles,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			messageId
		);

		messageToWriteToId = addChildren(
			conv,
			{
				from: "assistant",
				content: "",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			newUserMessageId
		);
		// build the prompt from the user message
		messagesForPrompt = buildSubtree(conv, newUserMessageId);
	}

	const messageToWriteTo = conv.messages.find((message) => message.id === messageToWriteToId);
	if (!messageToWriteTo) {
		error(500, "Failed to create message");
	}
	if (messagesForPrompt.length === 0) {
		error(500, "Failed to create prompt");
	}

	// update the conversation with the new messages
	await collections.conversations.updateOne(
		{ _id: convId },
		{ $set: { messages: conv.messages, title: conv.title, updatedAt: new Date() } }
	);

	let doneStreaming = false;

	// Get the assistants for this conversation
	const assistantIds = conv.assistantIds || (conv.assistantId ? [conv.assistantId] : []);

	// Create the response stream
	const stream = new ReadableStream({
		async start(controller) {
			messageToWriteTo.updates ??= [];

			async function update(event: MessageUpdate) {
				if (!messageToWriteTo || !conv) {
					return;
				}

				// Set the initial message content
				if (event.type === MessageUpdateType.Stream) {
					messageToWriteTo.content += event.token;
				}

				// Set the reasoning
				else if (
					event.type === MessageUpdateType.Reasoning &&
					event.subtype === MessageReasoningUpdateType.Stream
				) {
					messageToWriteTo.reasoning ??= "";
					messageToWriteTo.reasoning += event.token;
				}

				// Set the title
				else if (event.type === MessageUpdateType.Title) {
					conv.title = event.title;
					await collections.conversations.updateOne(
						{ _id: convId },
						{ $set: { title: conv?.title, updatedAt: new Date() } }
					);
				}

				// Set the final text and the interrupted flag
				else if (event.type === MessageUpdateType.FinalAnswer) {
					messageToWriteTo.interrupted = event.interrupted;
					messageToWriteTo.content = initialMessageContent + event.text;

					// add to latency
					MetricsServer.getMetrics().model.latency.observe(
						{ model: model?.id },
						Date.now() - promptedAt.getTime()
					);
				}

				// Add file
				else if (event.type === MessageUpdateType.File) {
					messageToWriteTo.files = [
						...(messageToWriteTo.files ?? []),
						{ type: "hash", name: event.name, value: event.sha, mime: event.mime },
					];
				}

				// Append to the persistent message updates if it's not a stream update
				if (
					event.type !== MessageUpdateType.Stream &&
					!(
						event.type === MessageUpdateType.Status &&
						event.status === MessageUpdateStatus.KeepAlive
					) &&
					!(
						event.type === MessageUpdateType.Reasoning &&
						event.subtype === MessageReasoningUpdateType.Stream
					)
				) {
					messageToWriteTo?.updates?.push(event);
				}

				// Avoid remote keylogging attack executed by watching packet lengths
				// by padding the text with null chars to a fixed length
				// https://cdn.arstechnica.net/wp-content/uploads/2024/03/LLM-Side-Channel.pdf
				if (event.type === MessageUpdateType.Stream) {
					event = { ...event, token: event.token.padEnd(16, "\0") };
				}

				// Send the update to the client
				controller.enqueue(JSON.stringify(event) + "\n");

				// Send 4096 of spaces to make sure the browser doesn't blocking buffer that holding the response
				if (event.type === MessageUpdateType.FinalAnswer) {
					controller.enqueue(" ".repeat(4096));
				}
			}

			// Handle multi-expert or single-expert conversation
			if (assistantIds.length > 1) {
				// Multi-expert conversation: create sequential turns from each assistant
				const assistants = await collections.assistants.find({
					_id: { $in: assistantIds }
				}).toArray();

				let currentMessageId = messageToWriteTo.id;
				let currentMessagesForPrompt = [...messagesForPrompt];

				for (let i = 0; i < assistants.length; i++) {
					const assistant = assistants[i];
					let currentMessageToWriteTo: Message;

					if (i === 0) {
						// Use the existing message for the first assistant
						currentMessageToWriteTo = messageToWriteTo;
						currentMessageToWriteTo.assistantId = assistant._id.toString();
					} else {
						// Create new message as child of the previous expert's message
						const newAssistantMessageId = addChildren(
							conv,
							{
								from: "assistant",
								content: "",
								assistantId: assistant._id.toString(),
								createdAt: new Date(),
								updatedAt: new Date(),
							},
							currentMessageId // Add as child of the previous expert's message
						);
						currentMessageToWriteTo = conv.messages.find(m => m.id === newAssistantMessageId)!;
						currentMessageId = newAssistantMessageId;
						
						// Update the prompt to include all previous expert responses
						currentMessagesForPrompt = buildSubtree(conv, currentMessageId);
						currentMessagesForPrompt.pop(); // Remove the current empty message
					}

					// Send expert indicator
					controller.enqueue(JSON.stringify({
						type: MessageUpdateType.Status,
						status: MessageUpdateStatus.Started,
						message: `${assistant.name} is responding...`,
						assistantId: assistant._id.toString()
					}) + "\n");

					currentMessageToWriteTo.updates ??= [];
					let hasError = false;
					const initialMessageContent = currentMessageToWriteTo.content;

					// Create a new update function for this specific message
					async function updateCurrentMessage(event: MessageUpdate) {
						if (!currentMessageToWriteTo || !conv) {
							return;
						}

						// Add assistantId to all events for this expert
						const eventWithAssistant = { ...event, assistantId: assistant._id.toString() };

						// Set the initial message content
						if (event.type === MessageUpdateType.Stream) {
							currentMessageToWriteTo.content += event.token;
						}

						// Set the reasoning
						else if (
							event.type === MessageUpdateType.Reasoning &&
							event.subtype === MessageReasoningUpdateType.Stream
						) {
							currentMessageToWriteTo.reasoning ??= "";
							currentMessageToWriteTo.reasoning += event.token;
						}

						// Set the title (only for first assistant)
						else if (event.type === MessageUpdateType.Title && i === 0) {
							conv.title = event.title;
							await collections.conversations.updateOne(
								{ _id: convId },
								{ $set: { title: conv?.title, updatedAt: new Date() } }
							);
						}

						// Set the final text and the interrupted flag
						else if (event.type === MessageUpdateType.FinalAnswer) {
							currentMessageToWriteTo.interrupted = event.interrupted;
							currentMessageToWriteTo.content = initialMessageContent + event.text;

							// add to latency
							MetricsServer.getMetrics().model.latency.observe(
								{ model: model?.id },
								Date.now() - promptedAt.getTime()
							);
						}

						// Add file
						else if (event.type === MessageUpdateType.File) {
							currentMessageToWriteTo.files = [
								...(currentMessageToWriteTo.files ?? []),
								{ type: "hash", name: event.name, value: event.sha, mime: event.mime },
							];
						}

						// Append to the persistent message updates if it's not a stream update
						if (
							event.type !== MessageUpdateType.Stream &&
							!(
								event.type === MessageUpdateType.Status &&
								event.status === MessageUpdateStatus.KeepAlive
							) &&
							!(
								event.type === MessageUpdateType.Reasoning &&
								event.subtype === MessageReasoningUpdateType.Stream
							)
						) {
							currentMessageToWriteTo?.updates?.push(eventWithAssistant);
						}

						// Avoid remote keylogging attack executed by watching packet lengths
						// by padding the text with null chars to a fixed length
						if (event.type === MessageUpdateType.Stream) {
							eventWithAssistant.token = event.token.padEnd(16, "\0");
						}

						// Send the update to the client
						controller.enqueue(JSON.stringify(eventWithAssistant) + "\n");

						// Send 4096 of spaces to make sure the browser doesn't blocking buffer that holding the response
						if (event.type === MessageUpdateType.FinalAnswer) {
							controller.enqueue(" ".repeat(4096));
						}
					}

					try {
						// Create context with assistant-specific preprompt
						const assistantPrompt = assistant.preprompt || "";
						const modifiedMessages = [...currentMessagesForPrompt];
						if (modifiedMessages[0]?.from === "system") {
							modifiedMessages[0] = { ...modifiedMessages[0], content: assistantPrompt };
						}

						const ctx: TextGenerationContext = {
							model,
							endpoint: await model.getEndpoint(),
							conv,
							messages: modifiedMessages,
							assistant,
							isContinue: isContinue ?? false,
							webSearch: webSearch ?? false,
							toolsPreference: [
								...(toolsPreferences ?? []),
								...(hasPdfFiles || hasPdfInConversation ? [documentParserToolId] : []), // Add document parser tool if PDF files are present
							],
							promptedAt,
							ip: getClientAddress(),
							username: locals.user?.username,
						};

						// run the text generation and send updates to the client
						for await (const event of textGeneration(ctx)) {
							await updateCurrentMessage(event);
						}
					} catch (e) {
						hasError = true;
						await updateCurrentMessage({
							type: MessageUpdateType.Status,
							status: MessageUpdateStatus.Error,
							message: (e as Error).message,
						});
						logger.error(e);
					} finally {
						// check if no output was generated
						if (!hasError && currentMessageToWriteTo.content === initialMessageContent) {
							await updateCurrentMessage({
								type: MessageUpdateType.Status,
								status: MessageUpdateStatus.Error,
								message: "No output was generated. Something went wrong.",
							});
						}
					}

					currentMessageToWriteTo.updatedAt = new Date();

					// Update assistant stats
					await collections.assistantStats.updateOne(
						{ assistantId: assistant._id, "date.at": startOfHour(new Date()), "date.span": "hour" },
						{ $inc: { count: 1 } },
						{ upsert: true }
					);

					// Update the conversation after each expert response
					await collections.conversations.updateOne(
						{ _id: convId },
						{ $set: { messages: conv.messages, title: conv?.title, updatedAt: new Date() } }
					);
				}
			} else {
				// Single expert or no expert - use existing logic
				await collections.conversations.updateOne(
					{ _id: convId },
					{ $set: { title: conv.title, updatedAt: new Date() } }
				);
				messageToWriteTo.updatedAt = new Date();

				let hasError = false;
				const initialMessageContent = messageToWriteTo.content;

				// Get the assistant if there is one
				let assistant: Assistant | undefined;
				if (assistantIds.length === 1) {
					assistant = await collections.assistants.findOne({ _id: assistantIds[0] });
					messageToWriteTo.assistantId = assistantIds[0].toString();
				}

				try {
					// Create context with assistant-specific preprompt if available
					const modifiedMessages = [...messagesForPrompt];
					if (assistant?.preprompt && modifiedMessages[0]?.from === "system") {
						modifiedMessages[0] = { ...modifiedMessages[0], content: assistant.preprompt };
					}

					const ctx: TextGenerationContext = {
						model,
						endpoint: await model.getEndpoint(),
						conv,
						messages: modifiedMessages,
						assistant,
						isContinue: isContinue ?? false,
						webSearch: webSearch ?? false,
						toolsPreference: [
							...(toolsPreferences ?? []),
							...(hasPdfFiles || hasPdfInConversation ? [documentParserToolId] : []), // Add document parser tool if PDF files are present
						],
						promptedAt,
						ip: getClientAddress(),
						username: locals.user?.username,
					};
					// run the text generation and send updates to the client
					for await (const event of textGeneration(ctx)) await update(event);
				} catch (e) {
					hasError = true;
					await update({
						type: MessageUpdateType.Status,
						status: MessageUpdateStatus.Error,
						message: (e as Error).message,
					});
					logger.error(e);
				} finally {
					// check if no output was generated
					if (!hasError && messageToWriteTo.content === initialMessageContent) {
						await update({
							type: MessageUpdateType.Status,
							status: MessageUpdateStatus.Error,
							message: "No output was generated. Something went wrong.",
						});
					}
				}

				// Update assistant stats for single assistant
				if (conv.assistantId) {
					await collections.assistantStats.updateOne(
						{ assistantId: conv.assistantId, "date.at": startOfHour(new Date()), "date.span": "hour" },
						{ $inc: { count: 1 } },
						{ upsert: true }
					);
				}
			}

			// Update the conversation with all messages
			await collections.conversations.updateOne(
				{ _id: convId },
				{ $set: { messages: conv.messages, title: conv?.title, updatedAt: new Date() } }
			);

			// used to detect if cancel() is called bc of interrupt or just because the connection closes
			doneStreaming = true;

			controller.close();
		},
	});

	const metrics = MetricsServer.getMetrics();
	metrics.model.messagesTotal.inc({ model: model?.id });
	
	// Return the response with proper headers
	return new Response(stream, {
		headers: {
			"Content-Type": "application/jsonl",
		},
	});
}

export async function DELETE({ locals, params }) {
	const convId = new ObjectId(params.id);

	const conv = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conv) {
		error(404, "Conversation not found");
	}

	await collections.conversations.deleteOne({ _id: conv._id });

	return new Response();
}

export async function PATCH({ request, locals, params }) {
	const values = z
		.object({
			title: z.string().trim().min(1).max(100).optional(),
			model: validModelIdSchema.optional(),
		})
		.parse(await request.json());

	const convId = new ObjectId(params.id);

	const conv = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conv) {
		error(404, "Conversation not found");
	}

	await collections.conversations.updateOne(
		{
			_id: convId,
		},
		{
			$set: values,
		}
	);

	return new Response();
}
