/**
 * PromptRefiner: one-shot prompt polishing + post-processing edge cases.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { PromptRefiner } from "../src/services/prompt-refiner.js";

function makeRefiner(response: string) {
	const calls: { prompt: string; system?: string }[] = [];
	const callModel = async (prompt: string, options?: { system?: string }) => {
		calls.push({ prompt, ...options });
		return response;
	};
	return { refiner: new PromptRefiner(callModel), calls };
}

describe("PromptRefiner", () => {
	it("passes the raw input and a rewriter system prompt", async () => {
		const { refiner, calls } = makeRefiner("[Role] x");
		await refiner.refineSimple("сделай сайт");
		assert.strictEqual(calls[0].prompt, "сделай сайт");
		assert.match(calls[0].system ?? "", /PROMPT REWRITER/);
	});

	it("characterization: only triple-quoted fences are stripped, backtick fences pass through", async () => {
		const { refiner } = makeRefiner("```text\n[Role] expert\n[Task] do it\n```");
		// Characterization: the cleaner only removes """-fences, backtick fences pass through.
		assert.strictEqual(await refiner.refineSimple("идея"), "```text\n[Role] expert\n[Task] do it\n```");
		const quoted = makeRefiner("\"\"\"text\n[Role] expert\n[Task] do it\n\"\"\"");
		assert.strictEqual(await quoted.refiner.refineSimple("идея"), "[Role] expert\n[Task] do it");
	});

	it("strips an English preamble line", async () => {
		const { refiner } = makeRefiner("Sure, here is the prompt:\n[Task] x");
		assert.strictEqual(await refiner.refineSimple("idea"), "[Task] x");
	});

	it("strips a Russian preamble line (unicode \\b via the u flag)", async () => {
		const { refiner } = makeRefiner("Конечно, вот промпт:\n[Task] x");
		assert.strictEqual(await refiner.refineSimple("идея"), "[Task] x");
	});

	it("keeps the [Filename] tag (stripping happens in the flow, not here)", async () => {
		const { refiner } = makeRefiner("[Task] x\n[Filename: my_task.md]");
		assert.match(await refiner.refineSimple("идея"), /\[Filename: my_task\.md\]/);
	});
});
