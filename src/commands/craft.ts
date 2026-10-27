import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Runtime } from "../runtime.js";
import { callSessionModel, runPromptFlow } from "./shared.js";
import { PromptCrafter } from "../services/prompt-crafter.js";
import { loadConfig, ProfileStore, resolveProfiles, type RefineProfile } from "../services/profiles.js";

const CREATE_LABEL = "➕ Create a custom profile";

async function selectProfile(
	ctx: ExtensionContext,
	profiles: RefineProfile[],
	store: ProfileStore,
): Promise<RefineProfile | undefined> {
	const labels = profiles.map((p) => `${p.builtin ? "✨" : "📂"} ${p.name}`);
	labels.push(CREATE_LABEL);
	const choice = await ctx.ui.select("Refine with which profile?", labels);
	if (choice === undefined) {
		return undefined;
	}
	if (choice === CREATE_LABEL) {
		const name = await ctx.ui.editor("Profile name", "");
		if (!name || name.trim().length === 0) {
			return undefined;
		}
		const text = await ctx.ui.editor("How this profile refines prompts: focus, extra tags, domain rules", "");
		if (!text || text.trim().length === 0) {
			return undefined;
		}
		return store.save(name.trim(), text.trim());
	}
	return profiles.find((p) => p.name === choice.slice(choice.indexOf(" ") + 1));
}

export function registerCraftCommand(pi: ExtensionAPI, runtime: Runtime, store = new ProfileStore()): void {
	pi.registerCommand("pc", {
		description:
			"Craft a refined prompt using a profile: Universal, Developer, Analyst, Designer, Lawyer, Doctor, custom, or JSON-configured",
		handler: async (_args, ctx) => {
			let config;
			try {
				config = loadConfig();
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
				return;
			}
			const profile = await selectProfile(ctx, resolveProfiles(config, store), store);
			if (!profile) {
				return;
			}
			const callModel = (prompt: string, options?: { system?: string; signal?: AbortSignal }) =>
				callSessionModel(runtime, ctx, prompt, options?.system, options?.signal);
			const crafter = new PromptCrafter(callModel, config);
			await runPromptFlow(ctx, {
				name: "Craft",
				inputTitle: `Describe what needs to be done — chaos welcome (profile: ${profile.name})`,
				loaderLabel: `✨ Crafting prompt (${profile.name})...`,
				reviewTitle: "Review the prompt",
				cancelNote: "Crafting cancelled",
				errorPrefix: "Crafting failed:",
				appliedNote: "✅ Prompt copied and inserted into the editor!",
				transform: (input, signal) =>
					crafter.craft(input, profile, { signal, onWarning: (message) => ctx.ui.notify(message, "warning") }),
			});
		},
	});
}
