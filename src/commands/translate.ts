import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Translator } from "../services/translator.js";
import type { Runtime } from "../runtime.js";
import { callSessionModel, runPromptFlow } from "./shared.js";

const COMMAND_NAME = "tr";

export function registerTranslateCommand(pi: ExtensionAPI, runtime: Runtime): void {
	pi.registerCommand(COMMAND_NAME, {
		description: "Translate a prompt to English (any source language) using the session model (pure translation, no reformatting)",
		handler: async (_args, ctx) => {
			const callModel = async (prompt: string, options?: { system?: string; signal?: AbortSignal }) => {
				return callSessionModel(runtime, ctx, prompt, options?.system, options?.signal);
			};

			const translator = new Translator(callModel);

			await runPromptFlow(ctx, {
				name: "Translate",
				inputTitle: "Enter the text — it will be translated to English",
				loaderLabel: "🌐 Translating...",
				reviewTitle: "Review the translation",
				cancelNote: "Translation cancelled",
				errorPrefix: "Translation failed:",
				appliedNote: "✅ Translation copied and inserted into the editor!",
				transform: (input, signal) => translator.translate(input, { signal }),
			});
		},
	});
}
