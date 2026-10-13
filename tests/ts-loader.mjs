/**
 * Node resolve hook: fall back `./x.js` -> `./x.ts` so the src chain
 * (which uses `.js` specifiers for the pi/TS toolchain) resolves under
 * `node --experimental-strip-types`.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
	try {
		return await nextResolve(specifier, context);
	} catch (err) {
		if (err.code === "ERR_MODULE_NOT_FOUND" && specifier.endsWith(".js") && context.parentURL) {
			const tsUrl = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
			if (existsSync(fileURLToPath(tsUrl))) {
				return { url: tsUrl.href, format: "module-typescript", shortCircuit: true };
			}
		}
		throw err;
	}
}
