# Spellbook for Herdr

[Spellbook](https://spellbook.getmurmur.dev) as a [Herdr](https://herdr.dev) layout: write agent skills with Claude Code beside you, in Herdr's window.

- **Skills** on the left: your drafts in `~/Skills`, newest first. Each one says whether it's installed in Claude Code, or changed since it was. A dot shows when its agent is working or needs you.
- **The skill** in the middle: name and description fields bound to the frontmatter, the body in an editor, Spellbook's lint as you type, and autosave. When the agent edits `SKILL.md`, the change shows up at once, with Revert.
- **The agent** on the right: Claude Code, started in the skill's folder with Spellbook's writing prompt. Each skill is a Herdr space, so its agent and conversation stay where you left them.
- **New skill** takes a name and, if you like, a sentence about what it should do. That sentence becomes Claude's first message.
- **Install in Claude Code** copies the draft to `~/.claude/skills/<name>`. It asks first if the installed copy is different.

## Install

Needs Herdr, and Claude Code on your PATH.

```sh
git clone https://github.com/<you>/spellbook-herdr && cd spellbook-herdr
sh scripts/link.sh
```

Then switch layouts with `ctrl-shift-l`. Your own layout stays as it was.

## Settings

`~/.config/herdr-app/spellbook.json`, all optional:

```json
{
  "root": "~/Skills",
  "claude": "~/.claude/skills",
  "agent": ["claude"],
  "font": "Geist"
}
```

`root` is where your drafts live (the same folder as the Spellbook app's), `claude` is where Install copies to, `agent` is the command each skill's space starts (Spellbook's prompt is added only for `claude`), and `font` is the editor's.

## Develop

The lint and frontmatter code is Spellbook's, in TypeScript under `src/core`, bundled into `mods/spellbook/core.js`. That file is committed, so the mod runs straight from a clone.

```sh
bun install
bun test
bun run typecheck
bun run build                       # after changing src/core
herdr-app check mods/spellbook      # Herdr's own check
```

Herdr doesn't hot-reload a linked mod: switch to another layout and back to load your changes.

To try it without touching your own spaces, run a separate Herdr with its own home and core:

```sh
HERDR_APP_HOME=/tmp/sb/home HC_SESSION=spellbook-test herdr-app
```

## Not yet

- Diff review: an outside change can be reverted as a whole, not chunk by chunk.
- Renaming a skill from the name field (the folder keeps its name).
- Files other than `SKILL.md` in the editor, Evals, Share, Publish, Codex and project installs.
