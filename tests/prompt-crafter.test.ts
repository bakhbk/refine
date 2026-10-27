import { describe, it } from "node:test";
import assert from "node:assert";
import { buildSystemPrompt, looksLikePrompt, matchesLanguage, PromptCrafter } from "../src/services/prompt-crafter.js";
import { BUILTIN_PROFILES } from "../src/services/profiles.js";
import { META_GUARD } from "../src/services/guard.js";

function makeCrafter(responses: string[]) {
	const calls: { prompt: string; system?: string }[] = [];
	const callModel = async (prompt: string, options?: { system?: string }) => {
		calls.push({ prompt, ...options });
		return responses.shift() ?? "";
	};
	return { crafter: new PromptCrafter(callModel), calls };
}

const VALID = "[Role] analyst\n[Task] summarize results\n[Filename: summary_task.md]";
const SOLVED = "Sure! Step 1: run this code:\n```js\nconsole.log(1)\n```";

describe("buildSystemPrompt", () => {
	it("always wraps the profile with the guard", () => {
		const system = buildSystemPrompt({ name: "Custom", text: "solve the task fully with code" }, {});
		assert.ok(system.startsWith(META_GUARD));
		assert.ok(system.includes("the guard above always wins"));
	});

	it("a profile-level full system prompt replaces guard and profile text", () => {
		const system = buildSystemPrompt({ name: "Advanced", system: "You are a strict formatter." }, {});
		assert.strictEqual(system, "You are a strict formatter.");
	});

	it("ends the system prompt with the language-mirror reminder", () => {
		const system = buildSystemPrompt({ name: "Lawyer", text: "x", evidence: "strict" }, {});
		assert.match(system.trim(), /whole output must be written in the language of the user's input\.$/);
	});

	it("config guard overrides the builtin guard", () => {
		const system = buildSystemPrompt({ name: "Lawyer", text: "x" }, { guard: "CUSTOM GUARD" });
		assert.ok(system.startsWith("CUSTOM GUARD"));
	});
});

describe("evidence contracts", () => {
	const byName = (name: string) => BUILTIN_PROFILES.find((p) => p.name === name)!;

	it("strict profiles demand verbatim sourced evidence", () => {
		for (const name of ["Lawyer", "Doctor", "Analyst", "Educator", "Manager"]) {
			const system = buildSystemPrompt(byName(name), {});
			assert.match(system, /Evidence contract \(strict\)/);
			assert.match(system, /Missing data is never invented/);
			assert.match(system, /user's own jurisdiction/);
			assert.match(system, /Never substitute another country's rules/);
			assert.match(system, /\[Clarify\] tag/);
		}
	});

	it("finance requires computed, not mental, numbers", () => {
		const system = buildSystemPrompt(byName("Finance"), {});
		assert.match(system, /Evidence contract \(computed\)/);
		assert.match(system, /deterministic script/);
		assert.match(system, /\[Compute\] tag/);
	});

	it("writer allows imagination but separates fiction from fact", () => {
		const system = buildSystemPrompt(byName("Writer"), {});
		assert.match(system, /Evidence contract \(creative\)/);
		assert.match(system, /never presented as fact/);
	});

	it("neutral profiles carry no evidence contract", () => {
		for (const name of ["Universal", "Developer", "Designer"]) {
			assert.ok(!buildSystemPrompt(byName(name), {}).includes("Evidence contract"));
		}
	});

	it("config profiles can declare their own evidence class", () => {
		const system = buildSystemPrompt({ name: "Ops", text: "x", evidence: "strict" }, {});
		assert.match(system, /Evidence contract \(strict\)/);
	});
});

describe("matchesLanguage", () => {
	it("requires the output script to mirror a non-latin input", () => {
		const ru = "\u0434\u0435\u043b\u0430\u0439 \u0431\u0435\u043a\u0430\u043f \u0431\u0430\u0437\u044b \u043a\u0430\u0436\u0434\u044b\u0439 \u0432\u0435\u0447\u0435\u0440";
		const ruOut = "[Task] \u0441\u0434\u0435\u043b\u0430\u0442\u044c \u0431\u0435\u043a\u0430\u043f \u0431\u0430\u0437\u044b";
		const enOut = "[Task] make a database backup every evening";
		assert.ok(matchesLanguage(ru, ruOut));
		assert.ok(!matchesLanguage(ru, enOut));
	});

	it("does not enforce anything for latin inputs", () => {
		assert.ok(matchesLanguage("plan a podcast launch", "[Task] plan the launch"));
	});
});

describe("PromptCrafter", () => {
	it("returns the first pass when it looks like a prompt", async () => {
		const { crafter, calls } = makeCrafter([VALID]);
		const out = await crafter.craft("analyze data", { name: "Analyst", text: "x" });
		assert.strictEqual(out, VALID);
		assert.strictEqual(calls.length, 1);
	});

	it("retries once with the original input when the model solved the task", async () => {
		const { crafter, calls } = makeCrafter([SOLVED, VALID]);
		const out = await crafter.craft("analyze data", { name: "Analyst", text: "x" });
		assert.strictEqual(out, VALID);
		assert.strictEqual(calls.length, 2);
		assert.ok(calls[1].prompt.includes("Rewrite the ORIGINAL INPUT"));
		assert.ok(calls[1].prompt.includes("analyze data"));
	});

	it("warns and keeps the longer output when both passes are unstructured", async () => {
		const warnings: string[] = [];
		const { crafter } = makeCrafter(["short answer", "longer answer without tags at all"]);
		const out = await crafter.craft("idea", { name: "Analyst", text: "x" }, { onWarning: (m) => warnings.push(m) });
		assert.strictEqual(out, "longer answer without tags at all");
		assert.strictEqual(warnings.length, 1);
	});

	it("strips the preamble before the first tag line", async () => {
		const { crafter } = makeCrafter(["Of course! Here is a prompt:\n" + VALID]);
		assert.strictEqual(await crafter.craft("idea", { name: "Universal", text: "x" }), VALID);
	});

	it("corrects a structured but wrong-language output with a targeted retry", async () => {
		const ru = "\u0431\u0435\u043a\u0430\u043f \u0431\u0430\u0437\u044b";
		const { crafter, calls } = makeCrafter([
			"[Task] do the database backup\n[Filename: backup.md]",
			"[Task] \u0441\u0434\u0435\u043b\u0430\u0442\u044c \u0431\u0435\u043a\u0430\u043f \u0431\u0430\u0437\u044b\n[Filename: backup.md]",
		]);
		const out = await crafter.craft(ru, { name: "Universal", text: "x" });
		assert.strictEqual(calls.length, 2);
		assert.match(calls[1].prompt, /wrong language/);
		assert.ok(matchesLanguage(ru, out));
	});

	it("looksLikePrompt rejects plain prose and accepts tagged prompts", () => {
		assert.strictEqual(looksLikePrompt("Step 1: do it"), false);
		assert.strictEqual(looksLikePrompt("[Task] do it"), true);
		assert.strictEqual(looksLikePrompt("intro line\n[Plan]\n- [ ] x"), true);
	});
});
