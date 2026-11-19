import { appHome, exec, readTextFile, run, setShared, spaces } from "herdr";

// One pass over the drafts: id, SKILL.md's modified time, and how the Claude Code copy compares.
const LIST = `root=$1; target=$2
for d in "$root"/*/; do
  [ -f "$d/SKILL.md" ] || continue
  id=\${d%/}; id=\${id##*/}
  m=$(stat -f %m "$d/SKILL.md" 2>/dev/null || stat -c %Y "$d/SKILL.md")
  if [ ! -d "$target/$id" ]; then s=draft
  elif diff -rq -x .DS_Store "$d" "$target/$id" >/dev/null 2>&1; then s=installed
  else s=changed; fi
  printf '%s\\t%s\\t%s\\n' "$id" "$m" "$s"
done`;

/** The person's skills, newest first: `{ id, modified, install: "draft" | "installed" | "changed" }`. */
export async function listSkills(config) {
  const r = await exec("sh", ["-c", LIST, "spellbook", config.root, config.claude]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "Couldn't read your skills");
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, modified, install] = line.split("\t");
      return { id, modified: Number(modified), install };
    })
    .sort((a, b) => b.modified - a.modified || a.id.localeCompare(b.id));
}

export const skillFolder = (config, id) => `${config.root}/${id}`;

/** The space working on a skill: a local space whose folder is the skill's. */
export function spaceFor(config, id) {
  const folder = skillFolder(config, id);
  return spaces().find((s) => !s.machine && s.folder.replace(/\/+$/, "") === folder) ?? null;
}

/** The skill the shown space is working on, or null when it's some other kind of space. */
export function shownSkill(config) {
  const space = spaces().find((s) => s.active);
  if (!space || space.machine) return null;
  const folder = space.folder.replace(/\/+$/, "");
  if (!folder.startsWith(config.root + "/")) return null;
  const id = folder.slice(config.root.length + 1);
  return id && !id.includes("/") ? id : null;
}

/**
 * Shows a skill's space, making one when it has none. A new space starts the agent in the
 * skill's folder with Spellbook's writing prompt; `task`, if given, is its first message.
 */
export async function openSkill(config, id, task) {
  const space = spaceFor(config, id);
  if (space) {
    run("space.select", { id: space.id });
    return;
  }
  const argv = [...config.agent];
  if (argv[0] === "claude") {
    const prompt = await readTextFile(`${appHome()}/mods/spellbook/prompt.md`);
    if (prompt) argv.push("--append-system-prompt", prompt.trim());
  }
  run("space.new", { name: id, folder: skillFolder(config, id), argv, ...(task ? { task } : {}) });
}

/** Copies the draft over Claude Code's copy, so it matches exactly. */
export async function install(config, id) {
  const r = await exec("sh", [
    "-c",
    'mkdir -p "$2" && rsync -a --delete --exclude .DS_Store "$1/" "$2/$3/"',
    "spellbook",
    skillFolder(config, id),
    config.claude,
    id,
  ]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "Couldn't install");
  // The library compares installs when it lists, so tell every copy to look again.
  setShared("spellbook.installed", Date.now());
}

export async function installStatus(config, id) {
  const r = await exec("sh", [
    "-c",
    '[ -d "$2/$3" ] || { echo draft; exit; }; if diff -rq -x .DS_Store "$1" "$2/$3" >/dev/null 2>&1; then echo installed; else echo changed; fi',
    "spellbook",
    skillFolder(config, id),
    config.claude,
    id,
  ]);
  return r.stdout.trim() || "draft";
}

/** Every file in a skill, relative to its folder, SKILL.md first, as lint expects. */
export async function skillFiles(config, id) {
  const r = await exec("sh", ["-c", 'cd "$1" && find . -type f ! -name .DS_Store ! -path "./.git/*"', "spellbook", skillFolder(config, id)]);
  const files = r.stdout.split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, ""));
  return ["SKILL.md", ...files.filter((f) => f !== "SKILL.md").sort()];
}
