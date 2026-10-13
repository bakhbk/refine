# refine

Minimal commands that turn chaotic ideas into structured prompts — and translate prompts between languages.

## Compatibility

**pi 0.81.0 and 0.86.0** — the UI API types (`ctx.ui.editor()`, `custom()`, `setEditorText()`) are identical in both versions.

Cancellation (ESC) works through a local `AbortController` passed into `streamSimple` — independent of the pi version. Model reasoning is disabled while refining (`reasoning: "off"`).

## Install

```bash
pi install npm:pi-refine
```

Alternatively, from the git repository:

```bash
pi install git:github.com/bakhbk/refine
```

## Commands

```
/rf  — refine a chaotic idea into a structured prompt
/tr  — translate a prompt to English, from any language (pure translation, no reformatting)
```

Both share the same flow: enter text → model pass (cancellable with ESC) → review in the editor → Apply / Save / Regenerate / Close.

## Support

If you find `pi-refine` useful, you can support its development:
[DonationAlerts](https://www.donationalerts.com/r/Bakhbk)
