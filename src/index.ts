import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import { Runtime } from "./runtime.js";
import { registerRefineCommand } from "./commands/refine.js";
import { registerTranslateCommand } from "./commands/translate.js";

export { BorderedLoader };

export default function refine(pi: ExtensionAPI) {
	const runtime = new Runtime();
	registerRefineCommand(pi, runtime);
	registerTranslateCommand(pi, runtime);
}
