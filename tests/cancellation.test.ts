/**
 * Behavioral test: callSessionModel cancels when the local AbortSignal fires.
 *
 * The fake registry stream mimics real pi-ai providers (see providers/faux.js):
 * it yields deltas with a delay, checks options.signal?.aborted, and on abort
 * pushes an error event + ends the stream.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { callSessionModel } from "../src/commands/shared.js";
import type { Runtime } from "../src/runtime.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

function freshCtx(overrides?: Record<string, unknown>) {
	return {
		model: { id: "test", provider: "fake", api: "fake" },
		modelRegistry: undefined,
		hasUI: false,
		ui: { notify: () => undefined },
		signal: undefined, // pi has no activeRun while a command handler runs
		...overrides,
	} as unknown as ExtensionContext;
}

/** Slow stream: 50 deltas x 20ms, respects options.signal like real providers. */
function slowStreamFactory() {
	return (model: any, context: any, options: any) => {
		const stream = createAssistantMessageEventStream() as any;
		(async () => {
			let text = "";
			for (let i = 0; i < 50; i++) {
				if (options?.signal?.aborted) {
					stream.push({ type: "error", reason: "aborted", error: { stopReason: "aborted" } } as any);
					stream.end();
					return;
				}
				text += "x";
				stream.push({ type: "text_delta", delta: "x", partial: { content: [] } } as any);
				await new Promise((r) => setTimeout(r, 20));
			}
			stream.push({ type: "done", reason: "stop", message: { stopReason: "stop", content: [{ type: "text", text }] } } as any);
			stream.end();
		})();
		return stream;
	};
}

function makeRuntime() {
	return {
		resolveModel: async (ctx: any) => {
			return { ok: true as const, model: ctx.model, apiKey: "k" };
		},
	} as unknown as Runtime;
}

describe("callSessionModel cancellation", () => {
	it("aborts the stream when the signal fires mid-stream", async () => {
		const controller = new AbortController();
		const started = Date.now();

		const promise = callSessionModel(makeRuntime(), freshCtx({ modelRegistry: { streamSimple: slowStreamFactory() } }), "hello", "system", controller.signal);
		setTimeout(() => controller.abort(), 80);

		try {
			await promise;
			assert.fail("should have thrown Cancelled");
		} catch (error: any) {
			const elapsed = Date.now() - started;
			assert.strictEqual(error.message, "Cancelled", "throws Cancelled on abort");
			assert.ok(elapsed < 700, `stream stopped promptly (took ${elapsed}ms, full would be ~1s)`);
		}
		console.log("✅ abort mid-stream → Cancelled, stream stopped");
	});

	it("completes normally when the signal is not aborted", async () => {
		const result = await callSessionModel(makeRuntime(), freshCtx({ modelRegistry: { streamSimple: slowStreamFactory() } }), "hello", "system", new AbortController().signal);
		assert.strictEqual(result, "x".repeat(50), "full 50-char response");
		console.log("✅ no abort → full response");
	});

	it("passes reasoning:off and the signal into stream options", async () => {
		let seen: any;
		const ctx = freshCtx({
			modelRegistry: {
				streamSimple: (_m: any, _c: any, options: any) => {
					seen = options;
					const stream = createAssistantMessageEventStream() as any;
					stream.push({ type: "done", reason: "stop", message: { stopReason: "stop", content: [{ type: "text", text: "ok" }] } } as any);
					stream.end();
					return stream;
				},
			},
		});

		const controller = new AbortController();
		await callSessionModel(makeRuntime(), ctx, "hello", "system", controller.signal);

		assert.strictEqual(seen.reasoning, "off", "reasoning is off");
		assert.strictEqual(seen.signal, controller.signal, "signal is passed");
		console.log("✅ reasoning:off + signal reach the provider");
	});
});
