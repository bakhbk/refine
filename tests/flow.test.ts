/**
 * runPromptFlow: shared user flow for /rf and /tr (editor → loader → review → actions).
 * Covers the command UX contracts; the model side is covered in the service tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { initTheme } from "@earendil-works/pi-coding-agent";

// BorderedLoader renders key hints through the global theme.
initTheme();
import { runPromptFlow, type PromptFlowOptions } from "../src/commands/shared.js";
import { registerRefineCommand } from "../src/commands/refine.js";
import { registerTranslateCommand } from "../src/commands/translate.js";
import type { Runtime } from "../src/runtime.js";

/** Scriptable fake UI: canned editor/select responses, recorded calls. */
function makeUi(script: { editors?: (string | undefined)[]; selects?: (string | undefined)[] }) {
	const ui: any = {
		editorQueue: script.editors ?? [],
		selectQueue: script.selects ?? [],
		editorCalls: [] as { title: string; prefill?: string }[],
		selectCalls: [] as { title: string; options: string[] }[],
		notifies: [] as { msg: string; type: string }[],
		editorTexts: [] as string[],
		editor: async (title: string, prefill?: string) => {
			ui.editorCalls.push({ title, prefill });
			return ui.editorQueue.length > 0 ? ui.editorQueue.shift() : undefined;
		},
		select: async (title: string, options: string[]) => {
			ui.selectCalls.push({ title, options });
			return ui.selectQueue.length > 0 ? ui.selectQueue.shift() : undefined;
		},
		// BorderedLoader spins a setInterval in its constructor; dispose it once
		// done() settles so the fake tui doesn't keep the event loop alive.
		custom: (cb: any) =>
			new Promise<any>((res) => {
				const comp = cb({ setFocus() {}, requestRender() {} }, { fg: (_k: string, s: string) => s }, undefined, (v: any) => res(v));
				// BorderedLoader.onAbort is setter-only; the plain onAbort field the flow
				// assigns lives on the cancellable loader inside. Stash it for cancel tests.
				(ui as any).__loaderHolder = (ui as any).__loaderHolder ?? { loader: undefined as any };
				(ui as any).__loaderHolder.loader = (comp as any)?.loader ?? comp;
				comp?.dispose?.();
			}),
		notify: (msg: string, type: string) => ui.notifies.push({ msg, type }),
		setEditorText: (t: string) => ui.editorTexts.push(t),
	};
	return ui;
}

function makeCtx(ui: any, withModel = true) {
	return { model: withModel ? { id: "m" } : undefined, ui } as unknown as ExtensionContext;
}

const baseOpts = (transform: PromptFlowOptions["transform"]): PromptFlowOptions => ({
	name: "Translate",
	inputTitle: "Enter the text",
	loaderLabel: "🌐 Translating...",
	reviewTitle: "Review the translation",
	cancelNote: "Translation cancelled",
	errorPrefix: "Translation failed:",
	appliedNote: "✅ Done!",
	transform,
});

describe("runPromptFlow", () => {
	it("exits with an error when no model is selected", async () => {
		let transformCalled = false;
		const ui = makeUi({});
		await runPromptFlow(makeCtx(ui, false), baseOpts(async () => ((transformCalled = true), "x")));
		assert.strictEqual(transformCalled, false);
		assert.deepStrictEqual(ui.editorCalls, []);
		assert.match(ui.notifies[0].msg, /No model selected/);
		assert.strictEqual(ui.notifies[0].type, "error");
	});

	it("exits silently on empty input or ESC", async () => {
		let transformCalled = false;
		const ui = makeUi({ editors: ["   "] });
		await runPromptFlow(makeCtx(ui), baseOpts(async () => ((transformCalled = true), "x")));
		assert.strictEqual(transformCalled, false);
		assert.strictEqual(ui.notifies.length, 0);
		assert.strictEqual(ui.editorTexts.length, 0);
	});

	it("strips [Filename] meta before review and restores original text on close", async () => {
		const ui = makeUi({ editors: ["hello world", "hello world EDITED"], selects: ["❌ Close"] });
		await runPromptFlow(makeCtx(ui), baseOpts(async () => "hello world\n[Filename: my_task.md]"));
		// review editor is prefilled with the cleaned text only
		assert.strictEqual(ui.editorCalls[1].prefill, "hello world");
		// "Close" restores the original input, not the result
		assert.deepStrictEqual(ui.editorTexts, ["hello world"]);
		assert.match(ui.notifies[0].msg, /not applied/);
	});

	it("restores original input and notifies on cancel (ESC in loader)", async () => {
		const ui = makeUi({ editors: ["original text"] });
		await runPromptFlow(
			makeCtx(ui),
			baseOpts((_input, signal) => {
				// Real path: ESC in the loader fires onAbort -> abort() -> stream rejects.
				queueMicrotask(() => (ui as any).__loaderHolder.loader?.onAbort?.());
				return new Promise<string>((_res, rej) => {
					signal.addEventListener("abort", () => {
						rej(new Error("Cancelled"));
					}, { once: true });
				});
			}),
		);
		assert.deepStrictEqual(ui.editorTexts, ["original text"]);
		assert.deepStrictEqual(ui.notifies, [{ msg: "Translation cancelled", type: "info" }]);
	});

	it("notifies the error prefix + message on transform failure", async () => {
		const ui = makeUi({ editors: ["original text"] });
		await runPromptFlow(makeCtx(ui), baseOpts(async () => Promise.reject(new Error("boom"))));
		assert.deepStrictEqual(ui.notifies, [{ msg: "Translation failed: boom", type: "error" }]);
		assert.strictEqual(ui.editorTexts.length, 0);
	});

	it("treats an empty transform result as an error", async () => {
		const ui = makeUi({ editors: ["original text"] });
		await runPromptFlow(makeCtx(ui), baseOpts(async () => "   "));
		assert.deepStrictEqual(ui.notifies, [{ msg: "Translation failed: empty result", type: "error" }]);
	});

	it("re-transforms the edited text only on an explicit 'Regenerate', then exits on 'Close'", async () => {
		const inputs: string[] = [];
		const ui = makeUi({ editors: ["original", "edited text"], selects: ["🔄 Regenerate", "❌ Close"] });
		await runPromptFlow(makeCtx(ui), baseOpts(async (input) => ((inputs.push(input), `translation of ${input}`))));
		assert.deepStrictEqual(inputs, ["original", "edited text"]);
		assert.deepStrictEqual(ui.editorTexts, ["original"]); // restored on close
	});

	it("keeps the transformed text if the user empties the review editor", async () => {
		const ui = makeUi({ editors: ["original", "   "], selects: ["❌ Close"] });
		await runPromptFlow(makeCtx(ui), baseOpts(async () => "result text"));
		// emptied review falls back to the transform result; close then restores original
		assert.strictEqual(ui.selectCalls[0].options[0], "✅ Apply");
		assert.deepStrictEqual(ui.editorTexts, ["original"]);
	});
});

describe("command registration", () => {
	function makePi() {
		const commands = new Map<string, any>();
		return { pi: { registerCommand: (name: string, def: any) => commands.set(name, def) } as unknown as ExtensionAPI, commands };
	}

	it("registers /rf and /tr as separate commands", () => {
		const { pi, commands } = makePi();
		registerRefineCommand(pi, {} as Runtime);
		registerTranslateCommand(pi, {} as Runtime);
		assert.ok(commands.has("rf"));
		assert.ok(commands.has("tr"));
		assert.match(commands.get("rf").description, /Refine/i);
		assert.match(commands.get("tr").description, /Translate/i);
	});

	it("each command handler runs the shared flow end to end", async () => {
		const { pi, commands } = makePi();
		// Fake provider stream: immediately answers with a fixed result.
		const streamSimple = () => {
			const stream = createAssistantMessageEventStream() as any;
			stream.push({ type: "done", reason: "stop", message: { stopReason: "stop", content: [{ type: "text", text: "result" }] } } as any);
			stream.end();
			return stream;
		};
		const runtime = {
			resolveModel: async (a: any) => ({ ok: true as const, model: a.model, apiKey: "k" }),
		} as unknown as Runtime;
		registerRefineCommand(pi, runtime);
		registerTranslateCommand(pi, runtime);
		const ui = makeUi({ editors: ["hello", "hello", "hello", "hello"], selects: ["❌ Close", "❌ Close"] });
		const ctx = makeCtx(ui, true) as any;
		ctx.modelRegistry = { streamSimple };
		await Promise.all([commands.get("rf").handler(" ", ctx), commands.get("tr").handler(" ", ctx)]);
		// both ran the same flow: input editor + review editor + actions select each
		assert.strictEqual(ui.editorCalls.length, 4);
		assert.strictEqual(ui.selectCalls.length, 2);
		assert.deepStrictEqual(ui.editorTexts, ["hello", "hello"]);
	});
});
