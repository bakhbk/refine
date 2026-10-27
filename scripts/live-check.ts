import fs from "node:fs";
import { PromptCrafter, looksLikePrompt } from "../src/services/prompt-crafter.js";
import { BUILTIN_PROFILES } from "../src/services/profiles.js";

const BASE_URL = process.env.LIVE_URL;
const MODEL = process.env.LIVE_MODEL;
const KEY = process.env.LIVE_KEY;

if (!BASE_URL || !MODEL || !KEY) {
	console.error("LIVE_URL, LIVE_MODEL and LIVE_KEY environment variables are required");
	process.exit(1);
}

interface Scenario {
	label: string;
	profile?: string;
	custom?: { name: string; text: string; evidence?: string };
	input: string;
	expect: string;
	minShare?: number;
	must?: string;
}

function scriptShare(text: string, expect: string): number {
	const letters = text.match(/\p{L}/gu) ?? [];
	if (letters.length === 0) {
		return 0;
	}
	const script = text.match(new RegExp(expect, "gu")) ?? [];
	return script.length / letters.length;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callModel(prompt: string, options?: { system?: string }): Promise<string> {
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			return await request(prompt, options);
		} catch (err) {
			if (attempt === 3) {
				throw err;
			}
			console.log(`[retry ${attempt}/3 after transient provider error]`);
			await sleep(2000 * attempt);
		}
	}
	return "";
}

async function request(prompt: string, options?: { system?: string }): Promise<string> {
	const res = await fetch(`${BASE_URL}/chat/completions`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
		body: JSON.stringify({
			model: MODEL,
			messages: [
				{ role: "system", content: options?.system ?? "" },
				{ role: "user", content: prompt },
			],
			temperature: 0.2,
		}),
		signal: AbortSignal.timeout(120_000),
	});
	if (!res.ok) {
		throw new Error(`provider error ${res.status}: ${await res.text()}`);
	}
	const data = await res.json();
	return data.choices[0].message.content ?? "";
}

async function runScenario(scenario: Scenario): Promise<boolean> {
	const profile = scenario.custom ?? BUILTIN_PROFILES.find((p) => p.name === scenario.profile);
	let calls = 0;
	const counting = async (prompt: string, options?: { system?: string }) => {
		calls++;
		return callModel(prompt, options);
	};
	const started = Date.now();
	const out = await new PromptCrafter(counting).craft(scenario.input, profile);
	const structured = looksLikePrompt(out);
	const sameLanguage = scenario.minShare
		? scriptShare(out, scenario.expect) >= scenario.minShare
		: new RegExp(scenario.expect, "i").test(out);
	const content = !scenario.must || new RegExp(scenario.must, "i").test(out);
	console.log(`\n=== ${scenario.label} === (${Date.now() - started}ms, calls: ${calls}, structured: ${structured}, language: ${sameLanguage}, content: ${content})`);
	console.log(out.slice(0, 700));
	return structured && sameLanguage && content;
}

async function main() {
	const scenarios = JSON.parse(
		fs.readFileSync(process.env.LIVE_SCENARIOS ?? "scripts/scenarios.json", "utf-8"),
	).scenarios as Scenario[];
	const filter = process.argv.slice(2);
	let pass = 0;
	let total = 0;
	for (const scenario of scenarios) {
		if (filter.length > 0 && !filter.some((f) => scenario.label.toLowerCase().includes(f.toLowerCase()))) {
			continue;
		}
		total++;
		if (await runScenario(scenario)) {
			pass++;
		}
	}
	console.log(`\nSUMMARY: ${pass}/${total} passed`);
	if (pass !== total) {
		process.exit(1);
	}
}

main().catch((err) => {
	console.error("live check failed:", err);
	process.exit(1);
});
