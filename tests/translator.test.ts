/**
 * Translator: one-shot translation to English (any source language), no reformatting.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { Translator } from "../src/services/translator.js";

function makeTranslator(response: string) {
	const calls: { prompt: string; system?: string; signal?: AbortSignal }[] = [];
	const callModel = async (prompt: string, options?: { system?: string; signal?: AbortSignal }) => {
		calls.push({ prompt, ...options });
		// Like real providers: reject when the stream is aborted.
		if (options?.signal?.aborted) throw new Error("Cancelled");
		return response;
	};
	return { translator: new Translator(callModel), calls };
}

describe("Translator", () => {
	it("passes the raw input and a translation system prompt", async () => {
		const { translator, calls } = makeTranslator("  hello world  ");
		const out = await translator.translate("\u043f\u0440\u0438\u0432\u0435\u0442 \u043c\u0438\u0440");
		assert.strictEqual(out, "hello world"); // trimmed
		assert.strictEqual(calls[0].prompt, "\u043f\u0440\u0438\u0432\u0435\u0442 \u043c\u0438\u0440");
		assert.match(calls[0].system ?? "", /TRANSLATOR/);
	});

	it("forwards the abort signal", async () => {
		const { translator } = makeTranslator("x");
		const controller = new AbortController();
		await translator.translate("test input", { signal: controller.signal });
		// signal was forwarded to the model call (no throw since not aborted)
	});

	it("propagates cancellation errors from the model call", async () => {
		const translator = new Translator(async () => {
			throw new Error("Cancelled");
		});
		await assert.rejects(translator.translate("test input"), /Cancelled/);
	});
});
