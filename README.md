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
/pc  — refine an idea with a role profile: Universal, Developer, Analyst, Designer, Lawyer, Doctor, or your own
```

All three share the same flow: enter text → model pass (cancellable with ESC) → review in the editor → Apply / Save / Regenerate / Close.

## Profiles and config (`/pc`)

`/pc` wraps the session model in an immutable guard: the model must return a prompt, never solve the task. A profile only adds role-specific tags and focus.

Each profile declares its relationship to reality via an evidence contract:
- `strict` (Lawyer, Doctor, Analyst, Educator, Manager): facts only from input or verbatim quotes of named sources; unverifiable items become explicit missing data, never inventions.
- `computed` (Finance): numbers are produced by a deterministic script/formula, never mentally.
- `creative` (Writer): imagination allowed, fiction never presented as fact.

Custom profiles in `config.json` accept `"evidence": "strict" | "computed" | "creative"`. If a pass returns an unstructured answer, `/pc` retries once automatically and warns you if both passes fail.

Profiles come from three sources (highest wins): `config.json`, profiles created via `➕ Create a custom profile` (stored as `~/.agents/refine/profiles/<Name>.md`), and the built-ins.

`~/.agents/refine/config.json` (override path with `PI_REFINE_CONFIG`):

```json
{
  "guard": "optional replacement for the built-in guard",
  "profiles": [
    { "name": "Ops Engineer", "text": "focus on runbooks, monitoring, rollback" },
    { "name": "Advanced", "system": "full system prompt, replaces guard and profile" }
  ]
}
```

## Support

If you find `pi-refine` useful, you can support its development:
[DonationAlerts](https://www.donationalerts.com/r/Bakhbk)
