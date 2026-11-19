import { frontmatterRange } from "./frontmatter"
import type { Problem } from "./lint"

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * SKILL.md split where the editor starts: the header fields own the frontmatter, so the editor
 * shows only the body. Blank lines after the closing fence stay with the head, so the body opens
 * on its first real line. `head + body` is always the original text.
 */
export function splitSkill(text: string): { head: string; body: string } {
  const range = frontmatterRange(text)
  if (!range) return { head: "", body: text }
  let end = range.to
  while (text[end] === "\n" || text[end] === "\r") end++
  return { head: text.slice(0, end), body: text.slice(end) }
}

/** Why a new skill's name can't be used, or null when it can. */
export function nameProblem(name: string, taken: readonly string[]): string | null {
  if (!name) return "Give it a name"
  if (!NAME.test(name)) return "Lowercase letters, numbers and single hyphens"
  if (name.length > 64) return "64 characters at most"
  if (taken.includes(name)) return "There's already a skill called this"
  return null
}

/** A blank SKILL.md: the frontmatter only, as Spellbook's Blank start makes it. */
export function newSkillText(name: string): string {
  return `---\nname: ${name}\ndescription: \n---\n\n`
}

/** A problem placed in the body, with its line counted from the body's first line (1-based). */
export type BodyProblem = Problem & { line: number }

/** Problems that belong under the editor rather than a header field, placed by body line. */
export function bodyProblems(problems: readonly Problem[], text: string, headLength: number): BodyProblem[] {
  return problems
    .filter((p) => !p.field && p.from >= headLength)
    .map((p) => ({ ...p, line: lineAt(text, p.from) - lineAt(text, headLength) + 1 }))
}

function lineAt(text: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++
  return line
}

/** The frontmatter problems that aren't name or description, which have no field to sit under. */
export function headProblems(problems: readonly Problem[], headLength: number): Problem[] {
  return problems.filter((p) => p.from < headLength && p.field !== "name" && p.field !== "description")
}
