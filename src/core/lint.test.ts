import { describe, expect, test } from "bun:test"
import { lintSkill, type LintContext, type Problem } from "./lint"

const ctx: LintContext = { files: ["SKILL.md", "references/style.md", "scripts/split.sh", "forms.md"] }
const DESCRIPTION = "Splits a messy branch into small pull requests. Use when the person asks to tidy a branch."

function skill(fields: string, body = "# Tidy PRs\n\nSome text.\n"): string {
  return `---\n${fields}\n---\n\n${body}`
}

const valid = skill(`name: tidy-prs\ndescription: ${DESCRIPTION}`)

function messages(problems: Problem[]): string[] {
  return problems.map((p) => p.message)
}

function only(text: string, context: LintContext = ctx): Problem {
  const problems = lintSkill(text, context)
  expect(problems).toHaveLength(1)
  return problems[0]
}

describe("lintSkill: frontmatter", () => {
  test("a valid skill has no problems", () => {
    expect(lintSkill(valid, ctx)).toEqual([])
  })

  test("missing frontmatter", () => {
    const p = only("# Title\n\nBody\n")
    expect(p).toMatchObject({ severity: "error", from: 0, to: 7 })
    expect(p.field).toBeUndefined()
  })

  test("an empty document", () => {
    expect(only("", ctx)).toMatchObject({ severity: "error", from: 0, to: 0 })
  })

  test("invalid YAML points at the error", () => {
    const text = "---\nname: a\nname: b\n---\nBody\n"
    const p = only(text)
    expect(p.severity).toBe("error")
    expect(p.message.startsWith("Frontmatter isn't valid YAML")).toBe(true)
    expect(text.slice(p.from, p.to)).toBe("name: b")
  })

  test("a block that never closes", () => {
    expect(only("---\nname: a\nBody\n").severity).toBe("error")
  })

  test("missing name and description point at the fence and name their field", () => {
    const problems = lintSkill("---\nlicense: MIT\n---\nBody\n", ctx)
    expect(problems.map((p) => [p.field, p.severity, p.from, p.to])).toEqual([
      ["name", "error", 0, 3],
      ["description", "error", 0, 3],
    ])
  })

  test("empty values count as missing and point at the key", () => {
    const text = "---\nname:\ndescription: \"\"\n---\n"
    const problems = lintSkill(text, ctx)
    expect(messages(problems)).toEqual(["Name is missing", "Description is missing"])
    expect(problems[1].from).toBe(text.indexOf('""'))
  })

  test("bad names", () => {
    for (const name of ["Tidy-PRs", "tidy_prs", "tidy--prs", "-tidy", "tidy-", "tidy prs"]) {
      const text = skill(`name: ${name}\ndescription: ${DESCRIPTION}`)
      const problems = lintSkill(text, ctx).filter((p) => p.severity === "error")
      expect(problems).toHaveLength(1)
      expect(problems[0].field).toBe("name")
      expect(text.slice(problems[0].from, problems[0].to)).toBe(name)
    }
  })

  test("good names", () => {
    for (const name of ["a", "pdf", "tidy-prs", "v2-notes-3"]) {
      expect(lintSkill(skill(`name: ${name}\ndescription: ${DESCRIPTION}`), ctx)).toEqual([])
    }
  })

  test("a name over 64 characters", () => {
    const name = "a".repeat(65)
    const p = only(skill(`name: ${name}\ndescription: ${DESCRIPTION}`), ctx)
    expect(p).toMatchObject({ severity: "error", field: "name", message: "Name is over 64 characters" })
    expect(lintSkill(skill(`name: ${"a".repeat(64)}\ndescription: ${DESCRIPTION}`), ctx)).toEqual([])
  })

  test("a valid name that isn't the skill's id is fine: the id follows the name", () => {
    expect(lintSkill(skill(`name: tidy\ndescription: ${DESCRIPTION}`), ctx)).toEqual([])
  })

  test("a name that's a list", () => {
    expect(only(skill(`name: [a, b]\ndescription: ${DESCRIPTION}`))).toMatchObject({ severity: "error", field: "name" })
  })

  test("a description over 1024 characters", () => {
    const long = `Use when needed. ${"x".repeat(1010)}`
    expect(long.length).toBeGreaterThan(1024)
    const p = only(skill(`name: tidy-prs\ndescription: ${long}`))
    expect(p).toMatchObject({ severity: "error", field: "description", message: "Description is over 1,024 characters, the limit outside Claude Code" })
    const exact = `Use when needed. ${"x".repeat(1024 - 17)}`
    expect(exact.length).toBe(1024)
    expect(lintSkill(skill(`name: tidy-prs\ndescription: ${exact}`), ctx)).toEqual([])
  })

  test("angle brackets in the description point at the bracket", () => {
    const text = skill(`name: tidy-prs\ndescription: Use when a <branch> is messy.`)
    const p = only(text)
    expect(p).toMatchObject({ severity: "error", field: "description" })
    expect(text.slice(p.from, p.to)).toBe("<")
  })

  test("a description with no when clause warns", () => {
    const p = only(skill("name: tidy-prs\ndescription: Splits a messy branch into small pull requests."))
    expect(p).toMatchObject({ severity: "warning", field: "description" })
  })

  test("when clauses that count", () => {
    for (const d of ["Use when tidying.", "Use for tidying.", "Helps when a branch is messy.", "Whenever a PR is big."]) {
      expect(lintSkill(skill(`name: tidy-prs\ndescription: ${d}`), ctx)).toEqual([])
    }
  })

  test("a description in the first or second person warns", () => {
    for (const d of ["I split branches. Use when asked.", "You split branches. Use when asked."]) {
      expect(only(skill(`name: tidy-prs\ndescription: ${d}`))).toMatchObject({ severity: "warning", field: "description" })
    }
    expect(lintSkill(skill("name: tidy-prs\ndescription: Identifies branches. Use when asked."), ctx)).toEqual([])
    expect(lintSkill(skill("name: tidy-prs\ndescription: Youthful prose. Use when asked."), ctx)).toEqual([])
  })

  test("a multi-line description is read whole", () => {
    const text = skill("name: tidy-prs\ndescription: >\n  Splits branches.\n  Use when asked.")
    expect(lintSkill(text, ctx)).toEqual([])
  })

  test("CRLF", () => {
    expect(lintSkill(valid.replace(/\n/g, "\r\n"), ctx)).toEqual([])
    const text = "---\r\nname: Bad\r\ndescription: d. Use when.\r\n---\r\n"
    const p = only(text, ctx)
    expect(text.slice(p.from, p.to)).toBe("Bad")
  })
})

describe("lintSkill: body", () => {
  test("a body over 500 lines points at line 501", () => {
    const lines = Array.from({ length: 501 }, (_, i) => `line ${i + 1}`)
    const text = skill(`name: tidy-prs\ndescription: ${DESCRIPTION}`, lines.join("\n") + "\n").replace("---\n\n", "---\n")
    const p = only(text)
    expect(p.severity).toBe("warning")
    expect(text.slice(p.from, p.to)).toBe("line 501")
  })

  test("500 lines, with a final line break, is fine", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`)
    const text = `---\nname: tidy-prs\ndescription: ${DESCRIPTION}\n---\n${lines.join("\n")}\n`
    expect(lintSkill(text, ctx)).toEqual([])
  })

  test("a relative link that isn't in the skill", () => {
    const text = skill(`name: tidy-prs\ndescription: ${DESCRIPTION}`, "See [the guide](references/missing.md).\n")
    const p = only(text)
    expect(p.severity).toBe("warning")
    expect(text.slice(p.from, p.to)).toBe("references/missing.md")
    expect(p.message).toBe("references/missing.md isn't in this skill")
  })

  test("relative links that are in the skill", () => {
    const body = [
      "[a](references/style.md)",
      "[b](./scripts/split.sh)",
      "[c](forms.md#section)",
      "[d](<references/style.md>)",
      '[e](references/style.md "Title")',
      "[f](references/)",
      "![g](forms.md)",
      "[h]: references/style.md",
    ].join("\n\n")
    expect(lintSkill(skill(`name: tidy-prs\ndescription: ${DESCRIPTION}`, body), ctx)).toEqual([])
  })

  test("links that aren't skill files are ignored", () => {
    const body = [
      "[a](https://example.com/x.md)",
      "[b](mailto:a@b.c)",
      "[c](#heading)",
      "[d](/etc/hosts)",
      "[e](../other/SKILL.md)",
      "[f](~/notes.md)",
      "[g](label)",
      "[^1]: A footnote.",
      "[h]: https://example.com",
    ].join("\n\n")
    expect(lintSkill(skill(`name: tidy-prs\ndescription: ${DESCRIPTION}`, body), ctx)).toEqual([])
  })

  test("a link reference definition that isn't in the skill", () => {
    const text = skill(`name: tidy-prs\ndescription: ${DESCRIPTION}`, "[guide]: references/gone.md\n")
    expect(text.slice(only(text).from, only(text).to)).toBe("references/gone.md")
  })

  test("a backtick path under a skill folder that isn't there", () => {
    const text = skill(`name: tidy-prs\ndescription: ${DESCRIPTION}`, "Run `scripts/missing.py` first.\n")
    const p = only(text)
    expect(text.slice(p.from, p.to)).toBe("scripts/missing.py")
  })

  test("backtick paths that are there, or aren't skill paths", () => {
    const body = [
      "`scripts/split.sh`",
      "`./references/style.md`",
      "`references/`",
      "`src/app.ts`",
      "`owner/repo`",
      "`text/plain`",
      "`package.json`",
      "`missing.md`",
      "`https://example.com/scripts/x.sh`",
      "`/scripts/x.sh`",
      "`git log --oneline`",
      "`scripts/split.sh --dry-run`",
      "`a/b`",
    ].join("\n\n")
    expect(lintSkill(skill(`name: tidy-prs\ndescription: ${DESCRIPTION}`, body), ctx)).toEqual([])
  })

  test("a folder the skill has counts as a skill folder", () => {
    const context = { ...ctx, files: ["SKILL.md", "docs/a.md"] }
    const text = skill(`name: tidy-prs\ndescription: ${DESCRIPTION}`, "`docs/a.md` and `docs/b.md`\n")
    const p = only(text, context)
    expect(text.slice(p.from, p.to)).toBe("docs/b.md")
  })

  test("nothing in fenced code counts", () => {
    const body = "```bash\npython `scripts/missing.py`\n[x](references/missing.md)\n```\n\n~~~\n`scripts/gone.sh`\n~~~\n"
    expect(lintSkill(skill(`name: tidy-prs\ndescription: ${DESCRIPTION}`, body), ctx)).toEqual([])
  })

  test("a link inside a code span isn't a link", () => {
    const body = "Write `[x](references/missing.md)` like this.\n"
    expect(lintSkill(skill(`name: tidy-prs\ndescription: ${DESCRIPTION}`, body), ctx)).toEqual([])
  })

  test("paths in the frontmatter aren't checked", () => {
    const text = `---\nname: tidy-prs\ndescription: ${DESCRIPTION} See [x](references/missing.md).\n---\nBody\n`
    expect(lintSkill(text, ctx)).toEqual([])
  })

  test("problems come back in document order", () => {
    const text = "---\nname: Bad\ndescription: No clause.\n---\n[x](references/missing.md)\n"
    const problems = lintSkill(text, ctx)
    const froms = problems.map((p) => p.from)
    expect(froms).toEqual([...froms].sort((a, b) => a - b))
    expect(problems.length).toBe(3)
  })
})

describe("lintSkill: other fields", () => {
  const base = `name: tidy-prs\ndescription: ${DESCRIPTION}`
  const of = (fields: string) => lintSkill(skill(`${base}\n${fields}`), ctx)

  test("every documented field, well formed, is fine", () => {
    const fields = [
      "when_to_use: Before review",
      "argument-hint: '[branch]'",
      "arguments: [branch]",
      "disable-model-invocation: yes",
      "user-invocable: off",
      "allowed-tools: Read Grep",
      "disallowed-tools: [WebFetch]",
      "model: inherit",
      "effort: xhigh",
      "context: fork",
      "agent: Explore",
      "background: false",
      "hooks:\n  Stop: []",
      "paths: src/**",
      "shell: powershell",
      "license: MIT",
      "compatibility: Needs git",
      "metadata:\n  author: me",
    ]
    expect(of(fields.join("\n"))).toEqual([])
  })

  test("an unknown key is a warning on the key, with the nearest field", () => {
    const text = skill(`${base}\nallowed_tools: Read`)
    const p = only(text)
    expect(p).toMatchObject({ severity: "warning", field: "allowed_tools", message: "Not a field Claude Code reads. Did you mean allowed-tools?" })
    expect(text.slice(p.from, p.to)).toBe("allowed_tools")
    expect(only(skill(`${base}\nversion: 2`)).message).toBe("Not a field Claude Code reads")
  })

  test("agent and background need context: fork", () => {
    const problems = of("agent: Explore\nbackground: false")
    expect(problems.map((p) => [p.field, p.severity, p.message])).toEqual([
      ["agent", "warning", "Only applies with context: fork"],
      ["background", "warning", "Only applies with context: fork"],
    ])
    expect(of("context: fork\nagent: Explore")).toEqual([])
  })

  test("enum values out of range are errors on the value", () => {
    const text = skill(`${base}\neffort: extreme`)
    const p = only(text)
    expect(p).toMatchObject({ severity: "error", field: "effort", message: "Should be one of low, medium, high, xhigh, max" })
    expect(text.slice(p.from, p.to)).toBe("extreme")
    expect(only(skill(`${base}\ncontext: spawn`)).field).toBe("context")
  })

  test("an empty value is a row being filled in, not an error", () => {
    expect(of("effort:\nwhen_to_use: ''")).toEqual([])
  })

  test("a bool that isn't one", () => {
    expect(only(skill(`${base}\nuser-invocable: sometimes`))).toMatchObject({ severity: "error", field: "user-invocable", message: "Should be true or false" })
  })

  test("compatibility over 500 characters", () => {
    expect(of(`compatibility: ${"x".repeat(500)}`)).toEqual([])
    expect(only(skill(`${base}\ncompatibility: ${"x".repeat(501)}`))).toMatchObject({ severity: "error", field: "compatibility", message: "Over 500 characters" })
  })

  test("description and when_to_use over 1,536 together", () => {
    const when = "x".repeat(1536 - DESCRIPTION.length)
    expect(of(`when_to_use: ${when}`)).toEqual([])
    const p = only(skill(`${base}\nwhen_to_use: ${when}x`))
    expect(p).toMatchObject({ severity: "warning", field: "when_to_use" })
    expect(p.message).toContain("1,536")
  })
})
