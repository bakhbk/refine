/**
 * Translation: one-shot translation to English (from any source language).
 * Pure translation only — no reformatting or restructuring (unlike PromptRefiner).
 */

import type { CallModelOptions } from "./prompt-refiner.js";

const SYSTEM_PROMPT_TRANSLATE = `You are a TRANSLATOR. Translate the user's text to English, from whatever language it is written in. If the input is already in English, return it unchanged.

Rules (non-negotiable):
- Translate meaning, not words: convey the same meaning, emphasis, and tone, so the result reads naturally in English.
- Preserve register: keep the same formality and complexity level as the source — technical stays technical, simple stays simple. Do not simplify or complicate beyond the original.
- Stay faithful: no new information, no embellishment, no style "improvements" or extra adjectives, no added comments or notes. Keep the same length — do not pad or condense.
- Preserve the input structure exactly: line breaks, lists, and all bracketed tags like [Role], [Context], [Task], [Filename: …] keep their position and form — translate only the human-readable content inside them.
- Keep technical terms, code, file paths, and identifiers unchanged.
- Do NOT start with any preamble. First line = first line of the translation.
- Do NOT wrap output in backticks or any code fence.`;

export class Translator {
	private readonly callModel: (prompt: string, options?: CallModelOptions) => Promise<string>;

	constructor(callModel: (prompt: string, options?: CallModelOptions) => Promise<string>) {
		this.callModel = callModel;
	}

	async translate(rawInput: string, options?: CallModelOptions): Promise<string> {
		const response = await this.callModel(rawInput, { ...options, system: SYSTEM_PROMPT_TRANSLATE });
		return response.trim();
	}
}
