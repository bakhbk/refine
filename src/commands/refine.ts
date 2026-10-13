import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PromptRefiner } from "../services/prompt-refiner.js";
import type { Runtime } from "../runtime.js";
import { callSessionModel, runPromptFlow } from "./shared.js";

const COMMAND_NAME = "rf";

export function registerRefineCommand(pi: ExtensionAPI, runtime: Runtime): void {
	pi.registerCommand(COMMAND_NAME, {
		description: "Refine chaotic ideas into structured prompts using the session model",
		handler: async (_args, ctx) => {
			const callModel = async (prompt: string, options?: { system?: string; signal?: AbortSignal }) => {
				return callSessionModel(runtime, ctx, prompt, options?.system, options?.signal);
			};

			const promptRefiner = new PromptRefiner(callModel);

			await runPromptFlow(ctx, {
				name: "Refine",
				inputTitle: "Describe what needs to be done — chaos welcome",
				loaderLabel: "✨ Refining prompt...",
				reviewTitle: "Review the prompt",
				cancelNote: "Refinement cancelled",
				errorPrefix: "Refinement failed:",
				appliedNote: "✅ Prompt copied and inserted into the editor!",
				transform: (input, signal) => promptRefiner.refineSimple(input, { signal }),
			});
		},
	});
}
