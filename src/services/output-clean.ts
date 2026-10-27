const FENCE_START = /^"""[a-zA-Z]*\n/gm;
const FENCE_END = /"""$/gm;
const TAG_LINE = /^\s*\[[A-Za-z]/;

const FILENAME_LINE = /^\s*\[Filename:.*\]\s*$/;

export function cleanOutput(text: string): string {
	const stripped = text.replace(FENCE_START, "").replace(FENCE_END, "").trim();
	const lines = stripped.split("\n");
	const start = lines.findIndex((line) => TAG_LINE.test(line));
	if (start === -1) {
		return stripped;
	}
	let end = -1;
	for (let i = start; i < lines.length; i++) {
		if (FILENAME_LINE.test(lines[i])) {
			end = i;
		}
	}
	const cut = end === -1 ? lines.length : end + 1;
	return lines.slice(start, cut).join("\n").trim();
}
