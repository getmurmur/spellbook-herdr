import type { FrontmatterValue } from "./frontmatter"

// Every frontmatter field Claude Code reads, from https://code.claude.com/docs/en/skills
// (checked 14 November 2026). The header, lint and Export all read this one table.

export type FieldType = "string" | "bool" | "enum" | "list" | "object"

export type FieldSpec = {
  key: string
  type: FieldType
  /** What Claude Code does without the key, as the tooltip says it; null when there's nothing to say. */
  default: string | null
  /** The value a bool has when the key is absent. */
  boolDefault?: boolean
  hint: string
  /** A real example, shown in the empty value. */
  placeholder: string
  /** The values an enum takes. */
  values?: readonly string[]
  /** Accepted outside Claude Code too (claude.ai uploads, the open standard). */
  portable: boolean
  /** Only meaningful when another key has this value. */
  requires?: { key: string; value: string }
  /** The longest value Claude Code accepts. */
  max?: number
  /** How a list written as one string separates its items. */
  separator?: "space" | "comma" | "space-or-comma"
  /** Prose rather than an identifier: set in the UI font, and the field grows to fit. */
  prose?: boolean
  /** Values to offer as it's typed. */
  suggestions?: readonly string[]
  /** Shown as a chip from the start, in this order (1 first); the rest wait behind "More fields". */
  featured?: number
}

export const FIELDS: readonly FieldSpec[] = [
  {
    key: "name",
    type: "string",
    default: null,
    hint: "The skill's name, and its slash command",
    placeholder: "tidy-prs",
    portable: true,
  },
  {
    key: "description",
    type: "string",
    default: "the first line of the body",
    hint: "What the skill does and when to use it. Claude reads it to decide when to load the skill",
    placeholder: "What it does, and when to use it",
    portable: true,
    prose: true,
  },
  {
    key: "when_to_use",
    featured: 1,
    type: "string",
    default: null,
    hint: "More context on when to load the skill, added after the description",
    placeholder: "When the person asks to clean up a branch before review",
    portable: false,
    prose: true,
  },
  {
    key: "argument-hint",
    featured: 3,
    type: "string",
    default: null,
    hint: "Shown when the skill is typed as a slash command, to say what to pass",
    placeholder: "[issue-number]",
    portable: false,
  },
  {
    key: "arguments",
    type: "list",
    default: null,
    hint: "Named arguments, in order, for $name in the body",
    placeholder: "issue branch",
    portable: false,
    separator: "space-or-comma",
  },
  {
    key: "disable-model-invocation",
    featured: 4,
    type: "bool",
    default: "false",
    boolDefault: false,
    hint: "On: Claude can't load the skill by itself, or preload it into subagents. Only the slash command runs it",
    placeholder: "",
    portable: false,
  },
  {
    key: "user-invocable",
    type: "bool",
    default: "true",
    boolDefault: true,
    hint: "Off: hidden from the / menu, so only Claude can load it",
    placeholder: "",
    portable: false,
  },
  {
    key: "allowed-tools",
    featured: 2,
    type: "list",
    default: null,
    hint: "Tools Claude can use without asking while the skill runs",
    placeholder: "Read Grep Bash(git status *)",
    portable: true,
    separator: "space-or-comma",
  },
  {
    key: "disallowed-tools",
    type: "list",
    default: null,
    hint: "Tools taken away while the skill is active",
    placeholder: "WebFetch",
    portable: false,
    separator: "space-or-comma",
  },
  {
    key: "model",
    featured: 5,
    type: "string",
    default: "the session's model",
    hint: "The model the skill runs on, as /model names it, or inherit",
    placeholder: "sonnet",
    portable: false,
    suggestions: ["inherit", "opus", "sonnet", "haiku"],
  },
  {
    key: "effort",
    type: "enum",
    default: "the session's effort",
    hint: "How hard the model thinks while the skill runs",
    placeholder: "Choose",
    values: ["low", "medium", "high", "xhigh", "max"],
    portable: false,
  },
  {
    key: "context",
    type: "enum",
    default: "none",
    hint: "fork runs the skill in a subagent of its own, away from the conversation",
    placeholder: "Choose",
    values: ["fork"],
    portable: false,
  },
  {
    key: "agent",
    type: "string",
    default: "general-purpose",
    hint: "The subagent a forked skill runs as: Explore, Plan, general-purpose or one of your own",
    placeholder: "Explore",
    portable: false,
    requires: { key: "context", value: "fork" },
    suggestions: ["Explore", "Plan", "general-purpose"],
  },
  {
    key: "background",
    type: "bool",
    default: "true",
    boolDefault: true,
    hint: "Off: wait for the forked subagent's result before going on",
    placeholder: "",
    portable: false,
    requires: { key: "context", value: "fork" },
  },
  {
    key: "hooks",
    type: "object",
    default: null,
    hint: "Hooks that run while the skill is active",
    placeholder: "",
    portable: false,
  },
  {
    key: "paths",
    type: "list",
    default: null,
    hint: "Globs: Claude only loads the skill by itself when working on matching files",
    placeholder: "src/**/*.ts",
    portable: false,
    separator: "comma",
  },
  {
    key: "shell",
    type: "enum",
    default: "bash",
    hint: "The shell that runs the body's inline commands",
    placeholder: "Choose",
    values: ["bash", "powershell"],
    portable: false,
  },
  {
    key: "license",
    type: "string",
    default: null,
    hint: "The skill's licence. Claude Code accepts it but doesn't act on it",
    placeholder: "MIT",
    portable: true,
  },
  {
    key: "compatibility",
    type: "string",
    default: null,
    hint: "What the skill needs to run, up to 500 characters. Claude Code accepts it but doesn't act on it",
    placeholder: "Needs git and the gh CLI",
    portable: true,
    max: 500,
    prose: true,
  },
  {
    key: "metadata",
    type: "object",
    default: null,
    hint: "Anything else, as keys and values. Claude Code ignores it",
    placeholder: "",
    portable: true,
  },
]

const BY_KEY = new Map(FIELDS.map((f) => [f.key, f]))

export const fieldSpec = (key: string): FieldSpec | undefined => BY_KEY.get(key)

/** name and description: always rows, never removed. */
export const isRequiredField = (key: string): boolean => key === "name" || key === "description"

export const PORTABLE_KEYS: readonly string[] = FIELDS.filter((f) => f.portable).map((f) => f.key)

/** Keys an upload outside Claude Code rejects: every field it doesn't know, documented for Claude Code or not. */
export function nonPortableKeys(keys: readonly string[]): string[] {
  return keys.filter((k) => !PORTABLE_KEYS.includes(k))
}

/** The Export and Share warning, or null when the skill would upload anywhere. */
export function portabilityWarning(keys: readonly string[]): { title: string; keys: string[] } | null {
  const offending = nonPortableKeys(keys)
  if (offending.length === 0) return null
  return {
    title: "claude.ai only accepts name, description, license, compatibility, metadata and allowed-tools: uploading this zip there will fail",
    keys: offending,
  }
}

/** YAML reads yes and on as text; Claude Code reads them as booleans, and so does this. */
export function parseBool(text: string | null): boolean | null {
  if (text === null) return null
  const v = text.trim().toLowerCase()
  if (["true", "yes", "on", "1"].includes(v)) return true
  if (["false", "no", "off", "0"].includes(v)) return false
  return null
}

/** A list field's items, whether the file writes it as a YAML list or as one string. */
export function splitList(spec: FieldSpec | undefined, text: string): string[] {
  const separator = spec?.separator ?? "space-or-comma"
  // Bash(git add *) has a space inside it, so a space only separates outside parentheses.
  const out: string[] = []
  let current = ""
  let depth = 0
  for (const ch of text) {
    if (ch === "(") depth++
    if (ch === ")") depth = Math.max(0, depth - 1)
    const breaks = depth === 0 && (ch === "," ? separator !== "space" : /\s/.test(ch) ? separator !== "comma" : false)
    if (breaks) {
      if (current.trim()) out.push(current.trim())
      current = ""
    } else current += ch
  }
  if (current.trim()) out.push(current.trim())
  return out
}

/** A list field's items, from a YAML list or a string. */
export function listItems(spec: FieldSpec | undefined, value: FrontmatterValue): string[] {
  if (value.kind === "list") return value.items
  if (value.kind === "text") return splitList(spec, value.text ?? "")
  return []
}

/** What to write for a list's new items: a list, unless the file writes this one as a string, which it keeps doing. */
export function listInput(spec: FieldSpec | undefined, value: FrontmatterValue, items: string[]): string | string[] {
  if (value.kind !== "text" || !value.text?.trim() || items.length === 0) return items
  const comma = spec?.separator === "comma" || value.text.includes(",")
  return items.join(comma ? ", " : " ")
}

/** One line for a value the header doesn't edit in place: hooks, metadata, or a key it doesn't know. */
export function summarise(key: string, value: FrontmatterValue): string {
  if (value.kind === "text") return value.text ?? "Empty"
  if (value.kind === "list") return value.items.length ? value.items.join(", ") : "Empty"
  if (value.keys.length === 0) return "Empty"
  if (key === "hooks") {
    const count = countHooks(value.json)
    const events = value.keys.join(", ")
    return count ? `${count} ${count === 1 ? "hook" : "hooks"} on ${events}` : events
  }
  return value.keys.join(", ")
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Commands under hooks: { Event: [{ matcher, hooks: [...] }] }, or 0 when it isn't that shape. */
function countHooks(json: unknown): number {
  if (!isRecord(json)) return 0
  let count = 0
  for (const matchers of Object.values(json)) {
    if (!Array.isArray(matchers)) continue
    for (const m of matchers) if (isRecord(m) && Array.isArray(m.hooks)) count += m.hooks.length
  }
  return count
}

/** Keys that aren't present yet and make sense to add, in the table's order. */
export function addableFields(present: ReadonlyMap<string, string | null>): FieldSpec[] {
  return FIELDS.filter((f) => {
    if (present.has(f.key) || isRequiredField(f.key)) return false
    if (f.requires) return present.get(f.requires.key) === f.requires.value
    return true
  })
}

/** The chips to show now, and the ones that wait behind "More fields", from the addable fields. */
export function chipGroups(addable: readonly FieldSpec[]): { featured: FieldSpec[]; more: FieldSpec[] } {
  const featured = addable.filter((f) => f.featured !== undefined).sort((a, b) => (a.featured ?? 0) - (b.featured ?? 0))
  return { featured, more: addable.filter((f) => f.featured === undefined) }
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = row[j]
      row[j] = next
    }
  }
  return row[b.length]
}

/** The known key an unknown one most likely meant, or null when nothing is close. */
export function nearestField(key: string): string | null {
  const plain = (s: string) => s.toLowerCase().replace(/[-_\s]/g, "")
  const exact = FIELDS.find((f) => plain(f.key) === plain(key))
  if (exact) return exact.key
  let best: { key: string; d: number } | null = null
  for (const f of FIELDS) {
    const d = distance(key.toLowerCase(), f.key)
    if (!best || d < best.d) best = { key: f.key, d }
  }
  if (!best) return null
  return best.d <= Math.max(2, Math.floor(best.key.length / 4)) ? best.key : null
}

/** The tooltip for a chip or a row's label: what it does, its default, and where it works. */
export function fieldTooltip(spec: FieldSpec): string[] {
  const lines = [spec.hint]
  if (spec.default !== null) lines.push(`Default: ${spec.default}`)
  if (spec.requires) lines.push(`Only applies with ${spec.requires.key}: ${spec.requires.value}`)
  if (!spec.portable) lines.push("Claude Code only")
  return lines
}
