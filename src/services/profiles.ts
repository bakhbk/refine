import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Evidence = "strict" | "computed" | "creative";

export interface RefineProfile {
	name: string;
	text?: string;
	system?: string;
	builtin?: boolean;
	evidence?: Evidence;
}

export interface RefineConfig {
	guard?: string;
	profiles?: RefineProfile[];
}

const UNIVERSAL = `Universal refinement for any profession.
Make the goal, audience, deadline, and format explicit when the input mentions them.
Keep the user's own terminology. Do not invent domain facts.`;

const DEVELOPER = `Software-task additions:
Add [Quality]: principles clearly implied by the input, one line each, at most 5 from: DRY, reuse-first, KISS, SOLID, YAGNI, backward compatibility, tests-first, security, small diffs, performance, secrets in .env, feature flags, self-documenting names, context discipline.
Add [Plan] only for new features, modules, or projects: CONTRACT (checkable acceptance bullets), then PLAN (ordered checkbox stages). Omit for fixes, refactors, and small edits.
State the completion criterion: code must compile without errors and run correctly.`;

const ANALYST = `Analysis-task additions:
Add [Method]: how data is collected and analyzed — sources, metrics, baseline for comparison.
Add [Evidence]: what must be shown to support each conclusion.
Separate facts from assumptions; list open questions under [Context].`;

const DESIGNER = `Design-task additions:
Add [Audience]: users, context, brand tone.
Add [Deliverables]: exact artifacts with format, size, and medium.
Describe visual intent concretely, not vaguely. No implementation code unless the input asks for it.`;

const LAWYER = `Legal-task additions:
Add [Jurisdiction]: the legal system and bodies named or implied by the input.
Add [Documents]: the exact artifacts to draft or review.
Add [Risks]: clauses and exposure to flag.
Preserve every citation, article number, and case name from the input verbatim.`;

const WRITER = `Persuasive-text additions:
Add [Audience]: who the text is for and what they already know.
Add [Channel]: where it will be published and its format limits.
Add [Tone]: voice and emotional register requested by the input.
Add [Action]: the exact response the reader should take.
Do not invent facts, offers, or claims the user did not provide.`;

const EDUCATOR = `Teaching-task additions:
Add [Learners]: level, prior knowledge, and group size.
Add [Objectives]: what the learner must be able to do after, in verifiable terms.
Add [Format]: duration, materials, and delivery mode.
Add [Assessment]: how understanding is checked.
Respect timing given by the user; do not add content beyond the stated scope.`;

const FINANCE = `Quantitative-task additions:
Add [Data]: the exact figures the user provided.
Add [Assumptions]: every rate, period, and unstated input, listed explicitly.
Add [Calculation]: the formula or method to apply, no invented numbers.
Add [Sensitivity]: which assumptions change the conclusion most.
Omit results that cannot be derived from the given data.`;

const MANAGER = `Process and rollout additions:
Add [Goals]: the outcome, in checkable terms.
Add [Stakeholders]: teams and roles involved, as named by the input.
Add [Timeline]: milestones and deadlines the user mentioned.
Add [Risks]: dependencies and failure points implied by the input.
Do not invent teams, tools, or dates the user did not state.`;

const DOCTOR = `Medical and research-task additions:
Add [Audience]: clinician, patient, or reviewer.
Add [Evidence]: required data, labs, and guidelines.
Add [Safety]: red flags and disclaimers to include.
Do not invent statistics or citations; mark missing evidence as a gap in [Context].`;

export const BUILTIN_PROFILES: RefineProfile[] = [
	{ name: "Universal", text: UNIVERSAL, builtin: true },
	{ name: "Developer", text: DEVELOPER, builtin: true },
	{ name: "Analyst", text: ANALYST, builtin: true, evidence: "strict" },
	{ name: "Designer", text: DESIGNER, builtin: true },
	{ name: "Lawyer", text: LAWYER, builtin: true, evidence: "strict" },
	{ name: "Doctor", text: DOCTOR, builtin: true, evidence: "strict" },
	{ name: "Writer", text: WRITER, builtin: true, evidence: "creative" },
	{ name: "Educator", text: EDUCATOR, builtin: true, evidence: "strict" },
	{ name: "Finance", text: FINANCE, builtin: true, evidence: "computed" },
	{ name: "Manager", text: MANAGER, builtin: true, evidence: "strict" },
];

export function configPath(): string {
	return process.env.PI_REFINE_CONFIG ?? path.join(os.homedir(), ".agents", "refine", "config.json");
}

export function loadConfig(file = configPath()): RefineConfig {
	if (!fs.existsSync(file)) {
		return {};
	}
	const raw = fs.readFileSync(file, "utf-8");
	try {
		return JSON.parse(raw) as RefineConfig;
	} catch (err) {
		throw new Error(`invalid JSON in config ${file}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

export function slugifyProfile(name: string): string {
	const slug = name.trim().replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
	return `${slug || "custom"}.md`;
}

export class ProfileStore {
	private readonly dir: string;

	constructor(dir = path.join(os.homedir(), ".agents", "refine", "profiles")) {
		this.dir = dir;
	}

	list(): RefineProfile[] {
		if (!fs.existsSync(this.dir)) {
			return [];
		}
		return fs.readdirSync(this.dir)
			.filter((file) => file.endsWith(".md"))
			.map((file) => ({
				name: file.replace(/\.md$/i, "").replace(/_/g, " "),
				text: fs.readFileSync(path.join(this.dir, file), "utf-8").trim(),
			}));
	}

	save(name: string, text: string): RefineProfile {
		fs.mkdirSync(this.dir, { recursive: true });
		const trimmed = text.trim();
		fs.writeFileSync(path.join(this.dir, slugifyProfile(name)), trimmed, "utf-8");
		return { name: name.trim(), text: trimmed };
	}
}

export function resolveProfiles(config: RefineConfig, store: ProfileStore): RefineProfile[] {
	const byName = new Map<string, RefineProfile>();
	for (const profile of [...BUILTIN_PROFILES, ...store.list(), ...(config.profiles ?? [])]) {
		byName.set(profile.name.toLowerCase(), profile);
	}
	return [...byName.values()];
}
