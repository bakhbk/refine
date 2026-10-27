import { META_GUARD } from "./guard.js";
import { cleanOutput } from "./output-clean.js";
import type { RefineConfig, RefineProfile } from "./profiles.js";
import type { CallModelOptions } from "./prompt-refiner.js";

export interface CraftOptions extends CallModelOptions {
	onWarning?: (message: string) => void;
}

const TAG_LINE = /^\s*\[(Role|Context|Task|Tools|Output|Quality|Plan)\]/i;

const NON_LATIN_SCRIPTS: [string, RegExp][] = [
	["cyrillic", /[\u0400-\u045f]/g],
	["han", /[\u4e00-\u9fff]/g],
	["arabic", /[\u0600-\u06ff]/g],
	["devanagari", /[\u0900-\u093f]/g],
];

export const EVIDENCE_CONTRACTS: Record<string, string> = {
	strict: [
		"Evidence contract (strict): every factual claim must come from",
		"the user's input or from real, current sources relevant to the",
		"user's locale. The executing agent must find those sources in",
		"the user's own jurisdiction (country, then city or region) and",
		"quote them verbatim with name, article or clause number, and",
		"date. Infer the locale from context: language, place names,",
		"named institutions. Never substitute another country's rules.",
		"If the locale is not clear, add a [Clarify] tag with the exact",
		"questions the agent must ask the user before proceeding.",
		"Missing data is never invented.",
	].join(" "),
	computed: [
		"Evidence contract (computed): numbers are never computed in the head.",
		"Require a deterministic script or formula that takes the stated",
		"inputs verbatim and prints the result, with totals cross-checked.",
		"Add a [Compute] tag to the prompt naming the script or formula.",
	].join(" "),
	creative: [
		"Evidence contract (creative): imagination in narrative and style is",
		"allowed; real-world names, dates, and statistics must be marked as",
		"invented or left out. Fiction is never presented as fact.",
	].join(" "),
};

export function buildSystemPrompt(profile: RefineProfile, config: RefineConfig): string {
	if (profile.system) {
		return profile.system;
	}
	const contract = profile.evidence ? EVIDENCE_CONTRACTS[profile.evidence] : "";
	const guard = config.guard ?? META_GUARD;
	const parts = [
		guard,
		`PROFILE "${profile.name}" (style only; the guard above always wins):\n${profile.text ?? ""}`,
	];
	if (contract) {
		parts.push(contract);
	}
	parts.push("REMEMBER: the whole output must be written in the language of the user's input.");
	return parts.join("\n\n");
}

export function looksLikePrompt(text: string): boolean {
	return text.split("\n").some((line) => TAG_LINE.test(line));
}

function dominantScriptShare(text: string, script: RegExp): number {
	const letters = text.match(/[\p{L}]/gu) ?? [];
	if (letters.length === 0) {
		return 0;
	}
	return (text.match(script) ?? []).length / letters.length;
}

export function matchesLanguage(input: string, output: string): boolean {
	for (const [, script] of NON_LATIN_SCRIPTS) {
		if (dominantScriptShare(input, script) >= 0.4) {
			return dominantScriptShare(output, script) >= 0.4;
		}
	}
	return true;
}

export class PromptCrafter {
	private readonly callModel: (prompt: string, options?: CallModelOptions) => Promise<string>;
	private readonly config: RefineConfig;

	constructor(callModel: (prompt: string, options?: CallModelOptions) => Promise<string>, config: RefineConfig = {}) {
		this.callModel = callModel;
		this.config = config;
	}

	async craft(rawInput: string, profile: RefineProfile, options?: CraftOptions): Promise<string> {
		const system = buildSystemPrompt(profile, this.config);
		const callOptions = { system, signal: options?.signal };
		const first = cleanOutput(await this.callModel(rawInput, callOptions));
		if (looksLikePrompt(first) && matchesLanguage(rawInput, first)) {
			return first;
		}
		const second = cleanOutput(await this.callModel(buildRetryInput(rawInput, first), callOptions));
		if (looksLikePrompt(second) && matchesLanguage(rawInput, second)) {
			return second;
		}
		options?.onWarning?.("Model output needs review: structure or language may be off.");
		return first.length > second.length ? first : second;
	}
}

function buildRetryInput(rawInput: string, previous: string): string {
	if (!looksLikePrompt(previous)) {
		return "Rewrite the ORIGINAL INPUT below as a structured prompt. Do not solve it.\n\nORIGINAL INPUT:\n" + rawInput;
	}
	return [
		"The prompt below is structured but written in the wrong language.",
		"Rewrite its content in the language of the ORIGINAL INPUT, keeping all tags.",
		"\n\nORIGINAL INPUT:\n" + rawInput + "\n\nPROMPT:\n" + previous,
	].join(" ");
}
