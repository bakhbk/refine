import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUILTIN_PROFILES, loadConfig, ProfileStore, resolveProfiles, slugifyProfile } from "../src/services/profiles.js";

describe("profiles", () => {
	it("ships ten builtin profiles covering all output archetypes", () => {
		assert.deepStrictEqual(BUILTIN_PROFILES.map((p) => p.name), [
			"Universal", "Developer", "Analyst", "Designer", "Lawyer",
			"Doctor", "Writer", "Educator", "Finance", "Manager",
		]);
	});

	it("archetype profiles add their structural tags to the system prompt", () => {
		const expects: [string, string][] = [
			["Writer", "[Audience]"],
			["Educator", "[Learners]"],
			["Finance", "[Assumptions]"],
			["Manager", "[Stakeholders]"],
		];
		for (const [name, tag] of expects) {
			const profile = BUILTIN_PROFILES.find((p) => p.name === name);
			assert.ok(profile?.text?.includes(tag), `${name} must define ${tag}`);
		}
	});

	it("slugifies names with spaces and unicode without emitting cyrillic literals", () => {
		assert.strictEqual(slugifyProfile("Legal Bomb Pro!"), "Legal_Bomb_Pro.md");
		assert.strictEqual(slugifyProfile(""), "custom.md");
	});

	it("stores and lists custom profiles", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "profiles-"));
		const store = new ProfileStore(dir);
		store.save("Ops Engineer", "focus on runbooks");
		const listed = store.list();
		assert.strictEqual(listed.length, 1);
		assert.strictEqual(listed[0].name, "Ops Engineer");
		assert.strictEqual(listed[0].text, "focus on runbooks");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("config profiles override builtins by name, store profiles merge in", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "profiles-"));
		const store = new ProfileStore(dir);
		store.save("Ops", "runbook focus");
		const config = loadConfig(writeTempConfig(dir, {
			profiles: [{ name: "Developer", text: "custom dev rules" }],
		}));
		const profiles = resolveProfiles(config, store);
		const dev = profiles.find((p) => p.name === "Developer");
		assert.strictEqual(dev?.text, "custom dev rules");
		assert.ok(profiles.some((p) => p.name === "Universal"));
		assert.ok(profiles.some((p) => p.name === "Ops"));
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("fails fast on invalid JSON config", () => {
		const file = path.join(os.tmpdir(), `bad-config-${Date.now()}.json`);
		fs.writeFileSync(file, "{not json");
		assert.throws(() => loadConfig(file), /invalid JSON/);
		fs.rmSync(file);
	});

	it("returns an empty config when no file exists", () => {
		assert.deepStrictEqual(loadConfig(path.join(os.tmpdir(), "no-such-config.json")), {});
	});
});

function writeTempConfig(dir: string, config: unknown): string {
	const file = path.join(dir, "config.json");
	fs.writeFileSync(file, JSON.stringify(config));
	return file;
}
