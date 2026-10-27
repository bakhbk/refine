/**
 * PromptRefiner: one-shot prompt polishing + output post-processing edge cases.
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
		await refiner.refineSimple("make a website");
		assert.strictEqual(calls[0].prompt, "make a website");
		assert.match(calls[0].system ?? "", /PROMPT REWRITER/);
	});

	it("strips triple-quoted fences", async () => {
		const { refiner } = makeRefiner("\"\"\"text\n[Role] expert\n[Task] do it\n\"\"\"");
		assert.strictEqual(await refiner.refineSimple("idea"), "[Role] expert\n[Task] do it");
	});

	it("drops preamble lines before the first tag line, in any language", async () => {
		const { refiner } = makeRefiner("Sure, here is the prompt:\n[Task] x");
		assert.strictEqual(await refiner.refineSimple("idea"), "[Task] x");
		const russian = makeRefiner("\u041a\u043e\u043d\u0435\u0447\u043d\u043e, \u0432\u043e\u0442 \u043f\u0440\u043e\u043c\u043f\u0442:\n[Task] x");
		assert.strictEqual(await russian.refiner.refineSimple("idea"), "[Task] x");
	});

	it("cuts trailing junk after the [Filename] line", async () => {
		const { refiner } = makeRefiner("[Task] x\n[Filename: t.md]\nThe user's last message is about streetlights. The earlier messages... some reasoning noise");
		assert.strictEqual(await refiner.refineSimple("idea"), "[Task] x\n[Filename: t.md]");
	});

	it("keeps unstructured output untouched when no tags are present", async () => {
		const { refiner } = makeRefiner("Step 1: do the thing");
		assert.strictEqual(await refiner.refineSimple("idea"), "Step 1: do the thing");
	});

	it("keeps the [Filename] tag (stripping happens in the flow, not here)", async () => {
		const { refiner } = makeRefiner("[Task] x\n[Filename: my_task.md]");
		assert.match(await refiner.refineSimple("idea"), /\[Filename: my_task\.md\]/);
	});
});
