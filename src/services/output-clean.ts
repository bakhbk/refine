const FENCE_START = /^"""[a-zA-Z]*\n/gm;
const FENCE_END = /"""$/gm;
const TAG_LINE = /^\s*\[[A-Za-z]/;

export function cleanOutput(text: string): string {
	const stripped = text.replace(FENCE_START, "").replace(FENCE_END, "").trim();
	const lines = stripped.split("\n");
	const start = lines.findIndex((line) => TAG_LINE.test(line));
	if (start === -1) {
		return stripped;
	}
	return lines.slice(start).join("\n").trim();
}
