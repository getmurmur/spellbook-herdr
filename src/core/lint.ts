import { fieldSpec, nearestField, parseBool } from "./frontmatterFields"
import { readFrontmatter } from "./frontmatter"

export type Problem = {
  from: number
  to: number
  severity: "error" | "warning"
  message: string
  /** The frontmatter key the problem belongs to, so its row in the header can show it inline. */
  field?: string
}

export type LintContext = {
  /** Every file in the skill, relative to its folder, SKILL.md first. */
  files: string[]
}

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/
const MAX_NAME = 64
/** The open standard's limit, which uploads outside Claude Code enforce. */
const MAX_DESCRIPTION = 1024
/** Claude Code cuts description and when_to_use, together, past this. */
const MAX_LISTING = 1536
const MAX_BODY_LINES = 500
/** Folders a skill conventionally keeps its files in, so a backtick path under one is meant to be in the skill. */
const SKILL_FOLDERS = ["references", "scripts", "assets", "templates", "examples"]

/** Every rule in PLAN.md §6, as pure logic. */
export function lintSkill(text: string, context: LintContext): Problem[] {
  const problems: Problem[] = []
  const read = readFrontmatter(text)
  let bodyFrom = 0

  if (read.kind === "none") {
    const lineEnd = text.search(/\r?\n|$/)
    problems.push({ from: 0, to: lineEnd, severity: "error", message: "Missing frontmatter with a name and description" })
  } else if (read.kind === "invalid") {
    const to = Math.min(text.length, lineEndAt(text, read.errorAt))
    problems.push({ from: read.errorAt, to, severity: "error", message: `Frontmatter isn't valid YAML: ${read.message}` })
    bodyFrom = read.range ? read.range.to : text.length
  } else {
    bodyFrom = read.range.to
    const fence = { from: 0, to: 3 }
    const { name, description } = read.fields

    if (name.nested) {
      problems.push({ ...span(name), severity: "error", message: "Name should be a single value", field: "name" })
    } else if (!name.value) {
      problems.push({ ...(name.present ? span(name) : fence), severity: "error", message: "Name is missing", field: "name" })
    } else {
      if (!NAME.test(name.value)) {
        problems.push({
          ...span(name),
          severity: "error",
          message: "Name can only use lowercase letters, numbers and single hyphens",
          field: "name",
        })
      }
      if (name.value.length > MAX_NAME) {
        problems.push({ ...span(name), severity: "error", message: `Name is over ${MAX_NAME} characters`, field: "name" })
      }
    }

    if (description.nested) {
      problems.push({ ...span(description), severity: "error", message: "Description should be text", field: "description" })
    } else if (!description.value?.trim()) {
      problems.push({
        ...(description.present ? span(description) : fence),
        severity: "error",
        message: "Description is missing",
        field: "description",
      })
    } else {
      const value = description.value
      if (value.length > MAX_DESCRIPTION) {
        problems.push({
          ...span(description),
          severity: "error",
          message: "Description is over 1,024 characters, the limit outside Claude Code",
          field: "description",
        })
      }
      if (/[<>]/.test(value)) {
        const source = text.slice(description.from, description.to)
        const at = source.search(/[<>]/)
        const where = at >= 0 ? { from: description.from + at, to: description.from + at + 1 } : span(description)
        problems.push({ ...where, severity: "error", message: "Description can't contain < or >", field: "description" })
      }
      if (/^(?:I|You)\s/i.test(value.trimStart())) {
        problems.push({
          ...span(description),
          severity: "warning",
          message: "Write the description in the third person, not starting with I or You",
          field: "description",
        })
      }
      if (!/\bwhen|\buse for\b/i.test(value)) {
        problems.push({
          ...span(description),
          severity: "warning",
          message: "Say when to use the skill, as in “Use when…”",
          field: "description",
        })
      }
    }
  }

  if (read.kind === "ok") problems.push(...otherKeys(read.entries))

  const bodyStart = bodyFrom === 0 ? 0 : skipLineBreak(text, bodyFrom)
  problems.push(...bodyLength(text, bodyStart))
  problems.push(...missingPaths(text, bodyStart, context.files))

  return problems.sort((a, b) => a.from - b.from || a.to - b.to)
}

type Entry = Extract<ReturnType<typeof readFrontmatter>, { kind: "ok" }>["entries"][number]

/** The keys past name and description: unknown ones, values out of range, and fields that need another. */
function otherKeys(entries: Entry[]): Problem[] {
  const problems: Problem[] = []
  const byKey = new Map(entries.map((e) => [e.key, e]))
  const keySpan = (e: Entry) => ({ from: e.keyFrom, to: e.keyTo })
  const valueSpan = (e: Entry) => (e.to > e.from ? span(e) : keySpan(e))

  const description = byKey.get("description")?.value ?? ""
  const whenToUse = byKey.get("when_to_use")
  if (whenToUse?.value && description.length + whenToUse.value.length > MAX_LISTING) {
    problems.push({
      ...valueSpan(whenToUse),
      severity: "warning",
      message: "Description and when_to_use are over 1,536 characters together. Claude Code cuts off the rest",
      field: "when_to_use",
    })
  }

  for (const entry of entries) {
    const spec = fieldSpec(entry.key)
    if (!spec) {
      const near = nearestField(entry.key)
      problems.push({
        ...keySpan(entry),
        severity: "warning",
        message: near ? `Not a field Claude Code reads. Did you mean ${near}?` : "Not a field Claude Code reads",
        field: entry.key,
      })
      continue
    }
    if (spec.requires && byKey.get(spec.requires.key)?.value !== spec.requires.value) {
      problems.push({ ...keySpan(entry), severity: "warning", message: `Only applies with ${spec.requires.key}: ${spec.requires.value}`, field: entry.key })
    }
    // An empty value is a row still being filled in, not a mistake.
    if (entry.nested || entry.value === null || entry.value === "") continue
    if (spec.type === "enum" && spec.values && !spec.values.includes(entry.value)) {
      problems.push({ ...valueSpan(entry), severity: "error", message: `Should be one of ${spec.values.join(", ")}`, field: entry.key })
    }
    if (spec.type === "bool" && parseBool(entry.value) === null) {
      problems.push({ ...valueSpan(entry), severity: "error", message: "Should be true or false", field: entry.key })
    }
    if (spec.max && entry.value.length > spec.max) {
      problems.push({ ...valueSpan(entry), severity: "error", message: `Over ${spec.max} characters`, field: entry.key })
    }
  }
  return problems
}

function span(node: { from: number; to: number }) {
  return { from: node.from, to: node.to }
}

function lineEndAt(text: string, pos: number): number {
  const i = text.indexOf("\n", pos)
  const end = i < 0 ? text.length : i
  return text[end - 1] === "\r" ? end - 1 : end
}

function skipLineBreak(text: string, pos: number): number {
  if (text.startsWith("\r\n", pos)) return pos + 2
  if (text[pos] === "\n") return pos + 1
  return pos
}

function bodyLength(text: string, from: number): Problem[] {
  const body = text.slice(from)
  if (!body) return []
  const lines = body.replace(/\r?\n$/, "").split(/\r?\n/)
  if (lines.length <= MAX_BODY_LINES) return []
  let at = from
  for (let i = 0; i < MAX_BODY_LINES; i++) at = text.indexOf("\n", at) + 1
  return [
    {
      from: at,
      to: lineEndAt(text, at),
      severity: "warning",
      message: `Body is over ${MAX_BODY_LINES} lines. Move detail into reference files`,
    },
  ]
}

type Range = { from: number; to: number }

/** Fenced code blocks, where nothing is a link or a path. */
function fencedBlocks(text: string, from: number): Range[] {
  const blocks: Range[] = []
  const line = /^[ \t]{0,3}(`{3,}|~{3,}).*$/gm
  line.lastIndex = from
  let open: { at: number; fence: string } | null = null
  for (let m = line.exec(text); m; m = line.exec(text)) {
    const fence = m[1]
    if (!open) {
      if (fence[0] === "`" && m[0].slice(m[0].indexOf(fence) + fence.length).includes("`")) continue
      open = { at: m.index, fence }
    } else if (fence[0] === open.fence[0] && fence.length >= open.fence.length && m[0].trim() === fence) {
      blocks.push({ from: open.at, to: m.index + m[0].length })
      open = null
    }
  }
  if (open) blocks.push({ from: open.at, to: text.length })
  return blocks
}

const inside = (ranges: Range[], pos: number) => ranges.some((r) => pos >= r.from && pos < r.to)

function normalisePath(path: string): string {
  return path.replace(/^(\.\/)+/, "").replace(/\/{2,}/g, "/")
}

function decode(path: string): string {
  try {
    return decodeURI(path)
  } catch {
    return path
  }
}

/** A target that points outside the skill or isn't a file: a URL, an anchor, an absolute path or one that climbs out. */
function isExternal(target: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(target) ||
    target.startsWith("#") ||
    target.startsWith("/") ||
    target.startsWith("~") ||
    target.startsWith("$") ||
    target.startsWith("{") ||
    target.startsWith("../") ||
    target.startsWith("\\")
  )
}

function exists(path: string, files: Set<string>, folders: Set<string>): boolean {
  const clean = path.replace(/\/$/, "")
  return files.has(clean) || folders.has(clean)
}

function missingPaths(text: string, from: number, fileList: string[]): Problem[] {
  const files = new Set(fileList.map(normalisePath))
  const folders = new Set<string>()
  for (const f of files) {
    const parts = f.split("/")
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"))
  }
  const knownTop = new Set([...SKILL_FOLDERS, ...[...folders].filter((f) => !f.includes("/"))])

  const fences = fencedBlocks(text, from)
  const problems: Problem[] = []
  const report = (path: string, at: number) =>
    problems.push({
      from: at,
      to: at + path.length,
      severity: "warning",
      message: `${normalisePath(path)} isn't in this skill`,
    })

  const codeSpans: Range[] = []
  const code = /(`+)([^`\n]+?)\1(?!`)/g
  code.lastIndex = from
  for (let m = code.exec(text); m; m = code.exec(text)) {
    if (inside(fences, m.index)) continue
    codeSpans.push({ from: m.index, to: m.index + m[0].length })
    const raw = m[2]
    const path = raw.trim()
    if (!looksLikeSkillPath(path, knownTop)) continue
    if (!exists(normalisePath(path), files, folders)) report(path, m.index + m[1].length + raw.indexOf(path))
  }

  const link = /!?\[[^\]\n]*\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g
  link.lastIndex = from
  for (let m = link.exec(text); m; m = link.exec(text)) {
    if (inside(fences, m.index) || inside(codeSpans, m.index)) continue
    checkTarget(m[1], m.index + m[0].indexOf(m[1], m[0].indexOf("](")))
  }

  const definition = /^[ \t]{0,3}\[(?!\^)[^\]\n]+\]:[ \t]*(<[^>\n]*>|\S+)/gm
  definition.lastIndex = from
  for (let m = definition.exec(text); m; m = definition.exec(text)) {
    if (inside(fences, m.index)) continue
    checkTarget(m[1], m.index + m[0].length - m[1].length)
  }

  function checkTarget(rawTarget: string, at: number) {
    const angled = rawTarget.startsWith("<")
    const target = angled ? rawTarget.slice(1, -1) : rawTarget
    const start = at + (angled ? 1 : 0)
    if (!target || isExternal(target)) return
    const path = target.replace(/[?#].*$/, "")
    // A target with no dot or slash is rarely a file, so it's left alone.
    if (!/[./]/.test(path)) return
    if (!exists(normalisePath(decode(path)), files, folders)) report(path, start)
  }

  return problems
}

/**
 * A backtick span that names a file in the skill: a relative path whose first folder is one the
 * skill has or conventionally uses. Paths into the person's own project (`src/app.ts`), repo names
 * (`owner/repo`) and MIME types are left alone, since a wrong warning costs more than a missed one.
 */
function looksLikeSkillPath(path: string, knownTop: Set<string>): boolean {
  if (!/^(\.\/)?[\w.-]+(\/[\w.-]+)*\/?$/.test(path)) return false
  if (isExternal(path)) return false
  const clean = normalisePath(path)
  const slash = clean.indexOf("/")
  if (slash <= 0) return false
  return knownTop.has(clean.slice(0, slash))
}
