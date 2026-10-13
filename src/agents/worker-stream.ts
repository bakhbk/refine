import * as piAi from "@earendil-works/pi-ai";
import type { AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import { streamSimple as compatStreamSimple } from "@earendil-works/pi-ai/compat";

/**
 * A stream function compatible with every pi-ai version we support (0.81–0.86).
 *
 * pi-ai 0.86 changed the provider-facing context to a branded `TranscriptContext`
 * (system prompt folded into a leading system message). We cannot reference that
 * type when compiling against 0.81, so the parameter is left untyped: callers
 * pass the public `Context` and this module adapts it where the version requires.
 */
export type WorkerStreamSimple = (
	model: Model<any>,
	context: any,
	options?: any,
) => AssistantMessageEventStream;

/**
 * Duck-typed subset of Pi's extension ModelRegistry.
 *
 * `streamSimple` is the host-composed path. `getRegisteredProviderConfig`
 * exposes each `registerProvider` `streamSimple` handler by provider id.
 * Use only the model's exact provider and require matching API metadata
 * as a consistency check.
 */
export type StreamableModelRegistry = {
	streamSimple?: WorkerStreamSimple;
	getRegisteredProviderConfig?: (providerId: string) => {
		api?: string;
		streamSimple?: WorkerStreamSimple;
	} | undefined;
};

/**
 * pi-ai >= 0.86 exports `normalizeContext` (folds systemPrompt/tools into a
 * leading system message and produces the provider-facing transcript).
 * pi-ai 0.81 has no such export — provider streams there expect the raw Context.
 * Its presence is our runtime version marker.
 */
const normalizeContext = (piAi as any).normalizeContext as
	| ((context: any) => any)
	| undefined;

function adaptContext(context: any): any {
	return normalizeContext ? normalizeContext(context) : context;
}

/**
 * Resolve the stream function background workers must pass to the model.
 *
 * Direct `@earendil-works/pi-ai/compat` `streamSimple` only knows built-in API
 * ids. Custom providers (`cursor-sdk`, `cliproxyapi-*`, commandcode, …) live on
 * Pi's composed runtime. Using compat after a successful foreground turn is
 * what crashes Pi with `No API provider registered for api: …` (#30).
 *
 * Context handling per path:
 * - host `registry.streamSimple` (pi >= 0.86): accepts the raw Context and
 *   normalizes internally — pass through.
 * - registered provider config: its `streamSimple` is provider-facing.
 *   pi-ai >= 0.86 requires the normalized transcript, 0.81 the raw Context —
 *   `adaptContext` picks the right one.
 * - compat fallback: accepts the raw Context on both versions — pass through.
 */
export function resolveWorkerStreamSimple(
	model: Model<any>,
	modelRegistry?: StreamableModelRegistry | null,
	override?: WorkerStreamSimple,
): WorkerStreamSimple {
	if (override) return override;

	const registry = modelRegistry ?? undefined;
	const registryStream = registry?.streamSimple;
	if (registry && typeof registryStream === "function") {
		// `.call(registry)`: the registry method reads `this.runtime`; an unbound
		// detached function would crash with `this` === undefined (pi >= 0.86).
		return (nextModel, context, options) => registryStream.call(registry, nextModel, context, options);
	}

	try {
		const config = modelRegistry?.getRegisteredProviderConfig?.(model.provider);
		const composed = config?.streamSimple;
		if (config?.api === model.api && typeof composed === "function") {
			return (nextModel, context, options) => composed(nextModel, adaptContext(context), options);
		}
	} catch {
		// Incomplete host/test doubles still use the built-in compat dispatcher.
	}

	return compatStreamSimple;
}
