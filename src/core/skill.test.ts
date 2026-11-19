import { describe, expect, test } from "bun:test"
import { lintSkill } from "./lint"
import { bodyProblems, headProblems, nameProblem, newSkillText, splitSkill } from "./skill"

describe("splitSkill", () => {
  test("puts the frontmatter and the blank lines after it in the head", () => {
    const text = "---\nname: a\ndescription: b\n---\n\n# A\n\nBody\n"
    const { head, body } = splitSkill(text)
    expect(body).toBe("# A\n\nBody\n")
    expect(head + body).toBe(text)
  })

  test("keeps CRLF files whole", () => {
    const text = "---\r\nname: a\r\n---\r\n\r\nBody"
    const { head, body } = splitSkill(text)
    expect(body).toBe("Body")
    expect(head + body).toBe(text)
  })

  test("gives the whole text to the body without frontmatter", () => {
    expect(splitSkill("# Just a body\n")).toEqual({ head: "", body: "# Just a body\n" })
  })

  test("treats an unclosed fence as body", () => {
    expect(splitSkill("---\nname: a\n").head).toBe("")
  })

  test("leaves an empty body when there's only frontmatter", () => {
    const text = newSkillText("tidy-prs")
    expect(splitSkill(text)).toEqual({ head: text, body: "" })
  })
})

describe("nameProblem", () => {
  test("accepts a kebab-case name", () => {
    expect(nameProblem("tidy-prs", [])).toBeNull()
  })

  test.each([
    ["", "Give it a name"],
    ["Tidy", "Lowercase letters, numbers and single hyphens"],
    ["a--b", "Lowercase letters, numbers and single hyphens"],
    ["-a", "Lowercase letters, numbers and single hyphens"],
    ["a".repeat(65), "64 characters at most"],
  ])("refuses %p", (name, message) => {
    expect(nameProblem(name, [])).toBe(message)
  })

  test("refuses a name that's taken", () => {
    expect(nameProblem("review", ["review"])).toBe("There's already a skill called this")
  })
})

describe("newSkillText", () => {
  test("lints with only the missing description", () => {
    const errors = lintSkill(newSkillText("tidy-prs"), { files: ["SKILL.md"] }).filter((p) => p.severity === "error")
    expect(errors.map((p) => p.message)).toEqual(["Description is missing"])
  })
})

describe("problem placement", () => {
  const text = "---\nname: a\ndescription: Use when testing\ncolour: red\n---\n\nSee `references/gone.md`.\n"
  const { head } = splitSkill(text)
  const problems = lintSkill(text, { files: ["SKILL.md"] })

  test("numbers body problems from the body's first line", () => {
    const body = bodyProblems(problems, text, head.length)
    expect(body.map((p) => [p.line, p.message])).toEqual([[1, "references/gone.md isn't in this skill"]])
  })

  test("keeps unknown keys' problems for the head", () => {
    expect(headProblems(problems, head.length).map((p) => p.field)).toEqual(["colour"])
  })
})
