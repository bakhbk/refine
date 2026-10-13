/**
 * Shared utilities for prompt commands (/rf, /tr).
 * DRY: single source of truth for the common editor → transform → review → actions flow.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import type { Context, UserMessage } from "@earendil-works/pi-ai";
import type { Runtime } from "../runtime.js";
import { resolveWorkerStreamSimple, type WorkerStreamSimple } from "../agents/worker-stream.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Call the session model for a plain-text response.
 * Uses runtime.resolveModel to get apiKey/headers/env, then streamSimple.
 *
 * `signal` (local AbortController) lets the caller cancel the in-flight stream.
 * We do NOT rely on `ctx.abort()`/`ctx.signal`: prompt commands run outside the
 * agent loop, so the agent has no `activeRun` and those would be no-ops.
 */
export async function callSessionModel(
	runtime: Runtime,
	ctx: ExtensionContext,
	prompt: string,
	systemPrompt?: string,
	signal?: AbortSignal,
): Promise<string> {
	const model = ctx.model;
	if (!model) throw new Error("No model selected");

	const resolved = await runtime.resolveModel({
		model,
		modelRegistry: ctx.modelRegistry,
		hasUI: ctx.hasUI,
		ui: ctx.ui,
	});

	if (!resolved.ok) {
		throw new Error(resolved.reason);
	}

	const resolvedModel = resolved.model as any;

	const streamOptions: any = {};
	if (resolved.apiKey) {
		streamOptions.apiKey = resolved.apiKey;
	}
	if (resolved.headers && Object.keys(resolved.headers).length > 0) {
		streamOptions.headers = resolved.headers;
	}
	// A rewrite/translation task doesn't need extended thinking: keeps the pass
	// fast and gives the user something to cancel before long reasoning.
	// (The .d.ts types reasoning as ThinkingLevel without "off", but the runtime
	// clamps ModelThinkingLevel — "off" maps to enable_thinking: false, etc.)
	streamOptions.reasoning = "off";

	const streamSimple: WorkerStreamSimple = resolveWorkerStreamSimple(resolvedModel, ctx.modelRegistry);

	const userMessage: UserMessage = {
		role: "user",
		content: [{ type: "text", text: prompt }],
		timestamp: Date.now(),
	};

	const context: Context = { messages: [userMessage] };
	if (systemPrompt) {
		context.systemPrompt = systemPrompt;
	}

	const stream = streamSimple(resolvedModel, context, {
		...streamOptions,
		signal,
	});

	let response = "";
	for await (const event of stream) {
		if (event.type === "text_delta" && typeof event.delta === "string") {
			response += event.delta;
		}
		if (event.type === "done") {
			const finalMsg = await stream.result();
			if (finalMsg && Array.isArray(finalMsg.content)) {
				const text = finalMsg.content
					.filter((p: any) => p.type === "text" && typeof p.text === "string")
					.map((p: any) => p.text)
					.join("");
				if (text.length > response.length) {
					response = text;
				}
			}
		}
	}

	if (signal?.aborted) {
		throw new Error("Cancelled");
	}

	await stream.result();
	return response.trim();
}

/**
 * Copy text to clipboard and set in editor.
 */
export async function copyPromptToClipboard(text: string): Promise<void> {
	const { copyTextToClipboard } = await import("../clipboard.js");
	await copyTextToClipboard(text);
}

// ─────────────────────────── shared flow ───────────────────────────

export type TransformResult =
	| { kind: "ok"; text: string; filename?: string }
	| { kind: "cancelled" }
	| { kind: "error"; message: string };

/** One model pass over the input text (cancellable via the passed signal). */
export type Transform = (input: string, signal: AbortSignal) => Promise<string>;

export interface PromptFlowOptions {
	/** Command display name, e.g. "Refine" / "Translate" — used in log + no-model message. */
	name: string;
	inputTitle: string;
	loaderLabel: string;
	reviewTitle: string;
	/** Shown when the user aborts the transform (original text restored). */
	cancelNote: string;
	/** Prefixed to the error message if the transform fails. */
	errorPrefix: string;
	/** Shown after "Apply". */
	appliedNote: string;
	transform: Transform;
}

/** Strip `[Filename: …]` from the last line, return cleaned text + extracted filename. */
export function stripFilenameMeta(text: string): { text: string; filename?: string } {
	const m = text.match(/\[Filename:\s*([^\]]+)\]\s*$/);
	if (!m) return { text };
	const filename = m[1].trim().replace(/\.(md)?$/i, ".md");
	const lines = text.split("\n");
	return { text: lines.slice(0, lines.length - 1).join("\n").trim(), filename };
}

/**
 * Generates a filename from the [Task] section content (not the first words,
 * which are from [Role]). Falls back to first 4 words if no [Task] tag.
 */
export function generateFilename(text: string): string {
	// Try to extract content from [Task] section — it describes WHAT the task does.
	const taskMatch = text.match(/^\[Task\]\s*\n?(.+?)(?=^\[|$)/m);
	const source = taskMatch ? taskMatch[1].trim() : text.trim().split(/\s+/).slice(0, 4).join(" ");

	// If the source still looks like it starts with a Role tag, strip it.
	const clean = source.replace(/^\[?role\]?\.?/i, "").trim();

	const words = clean.split(/\s+/);
	const slug = words
		.filter((w) => w.length > 0)
		.slice(0, 4)
		.map((w) => w.replace(/[^a-zA-Z\p{Script=Cyrillic}0-9_]/gu, ""))
		.filter((w) => w.length > 0)
		.join("_");
	return `${slug || "untitled"}.md`;
}

/**
 * Saves the prompt into `~/.agents/prompts/` using a suggested or generated filename,
 * allowing the user to rename it. Handles existing file conflicts.
 */
export async function handleSaveToCollection(
	text: string,
	ctx: ExtensionContext,
	suggestedFilename?: string,
): Promise<void> {
	const defaultName = suggestedFilename || generateFilename(text);
	const collectionDir = path.join(os.homedir(), ".agents", "prompts");
	fs.mkdirSync(collectionDir, { recursive: true });

	// Use editor() — in pi 0.86, input() ignores the prefill argument.
	const userInput = await ctx.ui.editor("File name", `~/.agents/prompts/${defaultName}`);
	if (userInput === undefined) {
		return; // ESC or empty -> cancel
	}

	// Extract only the file name from the path (handles `~`, full paths, and nested dirs)
	const clean = userInput.replace(/^~\//, "").replace(/^~$/, "");
	const filename = path.basename(clean);
	const filePath = path.join(os.homedir(), ".agents", "prompts", filename);

	if (fs.existsSync(filePath)) {
		const overwrite = await ctx.ui.select("File already exists", ["📝 Overwrite", "❌ Cancel"]);
		if (overwrite !== "📝 Overwrite") {
			return; // User chose not to overwrite
		}
	}

	fs.writeFileSync(filePath, text, "utf-8");
	ctx.ui.notify(`✅ Prompt saved and copied to clipboard: ${filename}`, "info");
}

/**
 * Common user flow for prompt commands:
 * editor (input) → transform (cancellable loader) → editor (review) →
 * select (Apply / Save / Regenerate / Close).
 * Every ESC exits the command; only an explicit "Regenerate" loops.
 */
export async function runPromptFlow(ctx: ExtensionContext, opts: PromptFlowOptions): Promise<void> {
	const { ui } = ctx;

	if (!ctx.model) {
		ui.notify(`${opts.name}: No model selected. Cannot proceed.`, "error");
		return;
	}

	const restore = (text: string, note: string) => {
		ui.setEditorText(text);
		ui.notify(note, "info");
	};

	// Step 1: source text in a multi-line editor.
	// ESC or empty submit -> leave the command (pi restores the main editor).
	const inputText = await ui.editor(opts.inputTitle, "");
	if (inputText === undefined || inputText.trim().length === 0) {
		return;
	}
	const originalInput = inputText.trim();
	let current = originalInput;

	// One transform pass, shown as a cancellable loader.
	// ESC / Ctrl+C on the loader aborts the in-flight request and resolves "cancelled".
	const runOnce = async (input: string): Promise<TransformResult> => {
		const abort = new AbortController();
		const state = { kind: "ok" as "ok" | "cancelled" | "error", text: "", message: "" };

		await ui.custom<string>((tui, theme, _kb, done) => {
			const loader = new BorderedLoader(tui, theme, opts.loaderLabel);
			tui.setFocus?.(loader);
			tui.requestRender();

			let settled = false;
			const finish = (value: string) => {
				if (settled) return;
				settled = true;
				done(value);
			};

			// CancellableLoader fires onAbort on ESC / Ctrl+C.
			loader.onAbort = () => {
				state.kind = "cancelled";
				abort.abort(); // cancel the HTTP request inside streamSimple
				finish("");
			};

			opts.transform(input, abort.signal).then(
				(text: string) => {
					state.kind = "ok";
					state.text = text;
					finish(text);
				},
				(err: unknown) => {
					if (err instanceof Error && err.message === "Cancelled") {
						state.kind = "cancelled";
					} else {
						state.kind = "error";
						state.message = err instanceof Error ? err.message : String(err);
						console.error(`[${opts.name.toLowerCase()}] transform failed:`, err);
					}
					finish("");
				},
			);

			return loader;
		});

		if (state.kind === "ok" && state.text.trim().length > 0) {
			const { text, filename } = stripFilenameMeta(state.text);
			return { kind: "ok", text, filename };
		}
		if (state.kind === "cancelled" || abort.signal.aborted) {
			return { kind: "cancelled" };
		}
		if (state.kind === "error") {
			return { kind: "error", message: state.message || "Unknown error" };
		}
		// ok but empty:
		return { kind: "error", message: "empty result" };
	};

	while (true) {
		// ── Step 2: transform ──
		const res = await runOnce(current);
		if (res.kind === "cancelled") {
			restore(originalInput, opts.cancelNote);
			return;
		}
		if (res.kind === "error") {
			ui.notify(`${opts.errorPrefix} ${res.message}`, "error");
			return;
		}
		const resultText = res.text;
		const suggestedFilename = res.filename;

		// ── Step 3: review the transformed text in a multi-line editor (prefilled) ──
		// `editor()` applies the prefill via setText, so the result is visible.
		// ESC -> exit; Enter -> keep the (possibly edited) text and go to actions.
		const reviewed = await ui.editor(opts.reviewTitle, resultText);
		if (reviewed === undefined) {
			restore(originalInput, "Prompt not applied");
			return;
		}
		const text = reviewed.trim().length > 0 ? reviewed.trim() : resultText;

		// ── Step 4: actions ──
		const value = await ui.select("Actions", [
			"✅ Apply",
			"📁 Save",
			"🔄 Regenerate",
			"❌ Close",
		]);

		if (value === "✅ Apply") {
			await copyPromptToClipboard(text);
			ui.setEditorText(text);
			ui.notify(opts.appliedNote, "info");
			return;
		} else if (value === "📁 Save") {
			await copyPromptToClipboard(text);
			await handleSaveToCollection(text, ctx, suggestedFilename);
			return;
		} else if (value === "🔄 Regenerate") {
			// Re-transform the (edited) text. Only an explicit choice loops.
			current = text;
			continue;
		} else {
			// "❌ Close" or ESC on the select -> exit.
			restore(originalInput, "Prompt not applied");
			return;
		}
	}
}
