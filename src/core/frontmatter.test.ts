import { describe, expect, test } from "bun:test"
import { type FrontmatterInput, frontmatterEntries, frontmatterKeyCursor, frontmatterRange, parseFrontmatter, setFrontmatterField, setFrontmatterKey } from "./frontmatter"

describe("frontmatterRange", () => {
  test("finds a block at the top", () => {
    const text = "---\nname: a\n---\n\nBody"
    expect(frontmatterRange(text)).toEqual({ from: 0, to: 15, contentFrom: 4, contentTo: 12 })
  })

  test("an empty block", () => {
    expect(frontmatterRange("---\n---\n")).toEqual({ from: 0, to: 7, contentFrom: 4, contentTo: 4 })
  })

  test("CRLF", () => {
    const text = "---\r\nname: a\r\n---\r\nBody"
    const range = frontmatterRange(text)
    expect(range).toEqual({ from: 0, to: 17, contentFrom: 5, contentTo: 14 })
    expect(text.slice(range?.contentTo, range?.to)).toBe("---")
  })

  test("none without an opening line at the very top", () => {
    expect(frontmatterRange("\n---\nname: a\n---\n")).toBeNull()
    expect(frontmatterRange("# Title\n")).toBeNull()
  })

  test("none when it never closes", () => {
    expect(frontmatterRange("---\nname: a\n")).toBeNull()
  })
})

describe("parseFrontmatter", () => {
  test("reads both fields", () => {
    expect(parseFrontmatter("---\nname: tidy-prs\ndescription: Splits PRs. Use when asked.\n---\nBody")).toEqual({
      ok: true,
      name: "tidy-prs",
      description: "Splits PRs. Use when asked.",
    })
  })

  test("no frontmatter", () => {
    expect(parseFrontmatter("# Hello")).toEqual({ ok: false, name: null, description: null })
  })

  test("an empty block parses with no fields", () => {
    expect(parseFrontmatter("---\n---\nBody")).toEqual({ ok: true, name: null, description: null })
  })

  test("a key with no value is null", () => {
    expect(parseFrontmatter("---\nname:\ndescription: x\n---\n")).toEqual({ ok: true, name: null, description: "x" })
  })

  test("CRLF", () => {
    expect(parseFrontmatter("---\r\nname: a\r\ndescription: b\r\n---\r\n")).toEqual({ ok: true, name: "a", description: "b" })
  })

  test("folded and literal block scalars, without their final line break", () => {
    const folded = "---\nname: a\ndescription: >\n  One line\n  and more.\n---\n"
    expect(parseFrontmatter(folded).description).toBe("One line and more.")
    const literal = "---\ndescription: |\n  One\n  Two\nname: a\n---\n"
    expect(parseFrontmatter(literal)).toEqual({ ok: true, name: "a", description: "One\nTwo" })
  })

  test("quoted values", () => {
    expect(parseFrontmatter("---\nname: 'a'\ndescription: \"Says: hi # not a comment\"\n---\n")).toEqual({
      ok: true,
      name: "a",
      description: "Says: hi # not a comment",
    })
  })

  test("comments are ignored", () => {
    expect(parseFrontmatter("---\n# top\nname: a # trailing\n---\n").name).toBe("a")
  })

  test("numbers and booleans read as text", () => {
    expect(parseFrontmatter("---\nname: 123\ndescription: true\n---\n")).toEqual({ ok: true, name: "123", description: "true" })
  })

  test("malformed YAML", () => {
    expect(parseFrontmatter("---\nname: [a\n---\n").ok).toBe(false)
    expect(parseFrontmatter("---\nname: a\nname: b\n---\n").ok).toBe(false)
    expect(parseFrontmatter("---\nname: a\n").ok).toBe(false)
  })

  test("a block that isn't a map", () => {
    expect(parseFrontmatter("---\n- a\n- b\n---\n").ok).toBe(false)
  })
})

describe("setFrontmatterField", () => {
  test("replaces only the value", () => {
    const text = "---\nname: old\ndescription: Keep me\n---\nBody"
    expect(setFrontmatterField(text, "name", "new")).toBe("---\nname: new\ndescription: Keep me\n---\nBody")
  })

  test("keeps comments, other keys and their order", () => {
    const text = "---\n# A comment\nlicense: MIT\nname: old # trailing\nallowed-tools: [Read, Write]\ndescription: d\n---\nBody\n"
    expect(setFrontmatterField(text, "name", "new")).toBe(
      "---\n# A comment\nlicense: MIT\nname: new # trailing\nallowed-tools: [Read, Write]\ndescription: d\n---\nBody\n",
    )
  })

  test("creates a block when there is none", () => {
    expect(setFrontmatterField("# Title\n", "name", "a")).toBe("---\nname: a\n---\n\n# Title\n")
    expect(setFrontmatterField("", "description", "d")).toBe("---\ndescription: d\n---\n")
    expect(setFrontmatterField("\nBody", "name", "a")).toBe("---\nname: a\n---\n\nBody")
  })

  test("adds a missing key: name first, description after it", () => {
    const text = "---\nlicense: MIT\n---\nBody"
    const withName = setFrontmatterField(text, "name", "a")
    expect(withName).toBe("---\nname: a\nlicense: MIT\n---\nBody")
    expect(setFrontmatterField(withName, "description", "d")).toBe("---\nname: a\ndescription: d\nlicense: MIT\n---\nBody")
    expect(setFrontmatterField(text, "description", "d")).toBe("---\ndescription: d\nlicense: MIT\n---\nBody")
  })

  test("fills an empty block", () => {
    expect(setFrontmatterField("---\n---\nBody", "name", "a")).toBe("---\nname: a\n---\nBody")
  })

  test("fills a key with no value", () => {
    expect(setFrontmatterField("---\nname:\ndescription: d\n---\n", "name", "a")).toBe("---\nname: a\ndescription: d\n---\n")
  })

  test("keeps CRLF line endings", () => {
    const text = "---\r\nname: a\r\ndescription: d\r\n---\r\nBody\r\n"
    expect(setFrontmatterField(text, "description", "new")).toBe("---\r\nname: a\r\ndescription: new\r\n---\r\nBody\r\n")
    expect(setFrontmatterField("Body\r\n", "name", "a")).toBe("---\r\nname: a\r\n---\r\n\r\nBody\r\n")
  })

  test("quotes values that need it", () => {
    const text = "---\nname: a\ndescription: d\n---\n"
    for (const value of ["Note: this has a colon", "#hashtag", "- dash", "true", "123", "", "[x]", "a # b", "'quoted'"]) {
      const next = setFrontmatterField(text, "description", value)
      expect(parseFrontmatter(next)).toEqual({ ok: true, name: "a", description: value === "" ? "" : value })
    }
  })

  test("keeps the existing quote style", () => {
    const text = "---\nname: 'a'\ndescription: \"d\"\n---\n"
    expect(setFrontmatterField(text, "name", "b")).toBe("---\nname: 'b'\ndescription: \"d\"\n---\n")
    expect(setFrontmatterField(text, "description", "e")).toBe("---\nname: 'a'\ndescription: \"e\"\n---\n")
  })

  test("rewrites a folded block scalar and keeps the key after it", () => {
    const text = "---\nname: a\ndescription: >\n  Old\n  text.\nlicense: MIT\n---\n"
    const long = "Splits a messy branch into small pull requests. Use when the person asks to tidy up a branch before review."
    const next = setFrontmatterField(text, "description", long)
    expect(next.startsWith("---\nname: a\ndescription: >-\n  Splits")).toBe(true)
    expect(next.endsWith("\nlicense: MIT\n---\n")).toBe(true)
    expect(parseFrontmatter(next).description).toBe(long)
  })

  test("a multi-line value becomes a block scalar", () => {
    const text = "---\nname: a\ndescription: d\nlicense: MIT\n---\n"
    const next = setFrontmatterField(text, "description", "One\nTwo")
    expect(next).toBe("---\nname: a\ndescription: |-\n  One\n  Two\nlicense: MIT\n---\n")
    expect(parseFrontmatter(next).description).toBe("One\nTwo")
  })

  test("leaves malformed YAML alone", () => {
    for (const text of ["---\nname: [a\n---\nBody", "---\nname: a\nname: b\n---\n", "---\nname: a\nBody", "---\n- a\n---\n"]) {
      expect(setFrontmatterField(text, "name", "b")).toBe(text)
    }
  })

  test("the same value leaves the text as it is", () => {
    const text = "---\nname:   a   \n---\n"
    expect(setFrontmatterField(text, "name", "a")).toBe(text)
  })

  test("round-trips through parse", () => {
    let text = "Body only\n"
    text = setFrontmatterField(text, "name", "tidy-prs")
    text = setFrontmatterField(text, "description", "Splits PRs: small ones. Use when asked.")
    expect(parseFrontmatter(text)).toEqual({ ok: true, name: "tidy-prs", description: "Splits PRs: small ones. Use when asked." })
    expect(text.endsWith("\n\nBody only\n")).toBe(true)
  })
})

const SKILL = "---\n# Who and what\nname: tidy-prs # the command\ndescription: Splits PRs. Use when asked.\n---\n\nBody\n"

describe("setFrontmatterKey: adding", () => {
  test("a new key goes after the ones there, keeping comments", () => {
    expect(setFrontmatterKey(SKILL, "when_to_use", "Before review")).toBe(
      "---\n# Who and what\nname: tidy-prs # the command\ndescription: Splits PRs. Use when asked.\nwhen_to_use: Before review\n---\n\nBody\n",
    )
  })

  test("booleans are written as true and false", () => {
    const next = setFrontmatterKey(SKILL, "disable-model-invocation", true)
    expect(next).toContain("\ndisable-model-invocation: true\n---")
    expect(setFrontmatterKey(next, "disable-model-invocation", false)).toContain("\ndisable-model-invocation: false\n---")
  })

  test("a list defaults to a block list", () => {
    expect(setFrontmatterKey(SKILL, "allowed-tools", ["Read", "Bash(git status *)"])).toContain(
      "\nallowed-tools:\n  - Read\n  - Bash(git status *)\n---",
    )
  })

  test("an empty list is written as []", () => {
    expect(setFrontmatterKey(SKILL, "paths", [])).toContain("\npaths: []\n---")
  })

  test("values that need quoting are quoted", () => {
    const next = setFrontmatterKey(SKILL, "argument-hint", "[issue-number]")
    expect(next).toContain('\nargument-hint: "[issue-number]"\n')
    expect(frontmatterEntries(next)?.find((e) => e.key === "argument-hint")?.value).toEqual({ kind: "text", text: "[issue-number]" })
  })

  test("removing a key that isn't there changes nothing", () => {
    expect(setFrontmatterKey(SKILL, "model", null)).toBe(SKILL)
    expect(setFrontmatterKey("Body\n", "model", null)).toBe("Body\n")
  })

  test("a flow map is left alone", () => {
    const text = "---\n{name: a}\n---\n"
    expect(setFrontmatterKey(text, "model", "opus")).toBe(text)
  })
})

describe("setFrontmatterKey: removing", () => {
  test("removes the line and keeps the rest", () => {
    const text = "---\nname: a\nmodel: opus # fast\ndescription: d\n---\nBody"
    expect(setFrontmatterKey(text, "model", null)).toBe("---\nname: a\ndescription: d\n---\nBody")
  })

  test("removes a block list, all its lines", () => {
    const text = "---\nname: a\nallowed-tools:\n  - Read # first\n  - Grep\ndescription: d\n---\n"
    expect(setFrontmatterKey(text, "allowed-tools", null)).toBe("---\nname: a\ndescription: d\n---\n")
  })

  test("removes a block scalar and a nested map", () => {
    const text = "---\nwhen_to_use: |\n  One\n  Two\nhooks:\n  Stop:\n    - hooks:\n        - type: command\nname: a\n---\n"
    expect(setFrontmatterKey(setFrontmatterKey(text, "when_to_use", null), "hooks", null)).toBe("---\nname: a\n---\n")
  })

  test("removes a key with no value", () => {
    expect(setFrontmatterKey("---\nname: a\nmodel:\n---\n", "model", null)).toBe("---\nname: a\n---\n")
  })

  test("removing the last key leaves an empty block that still parses", () => {
    const next = setFrontmatterKey("---\nmodel: opus\n---\nBody", "model", null)
    expect(next).toBe("---\n---\nBody")
    expect(parseFrontmatter(next).ok).toBe(true)
  })

  test("the last key with no line break before the fence", () => {
    expect(setFrontmatterKey("---\nname: a\nshell: bash\n---", "shell", null)).toBe("---\nname: a\n---")
  })

  test("CRLF", () => {
    const text = "---\r\nname: a\r\nmodel: opus\r\n---\r\nBody\r\n"
    expect(setFrontmatterKey(text, "model", null)).toBe("---\r\nname: a\r\n---\r\nBody\r\n")
  })

  test("adding then removing gives back the text", () => {
    const cases: [string, FrontmatterInput][] = [["when_to_use", "x: y"], ["background", false], ["paths", ["src/**"]]]
    for (const [key, value] of cases) {
      const added = setFrontmatterKey(SKILL, key, value)
      expect(added).not.toBe(SKILL)
      expect(setFrontmatterKey(added, key, null)).toBe(SKILL)
    }
  })
})

describe("setFrontmatterKey: lists", () => {
  test("keeps a flow list in flow style", () => {
    const text = "---\nname: a\nallowed-tools: [Read, Write] # safe ones\n---\n"
    expect(setFrontmatterKey(text, "allowed-tools", ["Read", "Write", "Grep"])).toBe("---\nname: a\nallowed-tools: [Read, Write, Grep] # safe ones\n---\n")
  })

  test("keeps a block list in block style, with its indent", () => {
    const indented = "---\nallowed-tools:\n  - Read\nname: a\n---\n"
    expect(setFrontmatterKey(indented, "allowed-tools", ["Read", "Grep"])).toBe("---\nallowed-tools:\n  - Read\n  - Grep\nname: a\n---\n")
    const flush = "---\nallowed-tools:\n- Read\nname: a\n---\n"
    expect(setFrontmatterKey(flush, "allowed-tools", ["Read", "Grep"])).toBe("---\nallowed-tools:\n- Read\n- Grep\nname: a\n---\n")
  })

  test("an empty [] grows into a block list", () => {
    const text = "---\nname: a\npaths: []\n---\n"
    expect(setFrontmatterKey(text, "paths", ["src/**"])).toBe("---\nname: a\npaths:\n  - src/**\n---\n")
  })

  test("a block list emptied becomes []", () => {
    const text = "---\npaths:\n  - a\nname: a\n---\n"
    expect(setFrontmatterKey(text, "paths", [])).toBe("---\npaths: []\nname: a\n---\n")
  })

  test("a string value becomes a list, and a list a string", () => {
    const text = "---\nallowed-tools: Read Grep\nname: a\n---\n"
    const list = setFrontmatterKey(text, "allowed-tools", ["Read"])
    expect(list).toBe("---\nallowed-tools:\n  - Read\nname: a\n---\n")
    expect(setFrontmatterKey(list, "allowed-tools", "Read Grep")).toBe(text)
  })

  test("fills a key with no value", () => {
    expect(setFrontmatterKey("---\nname: a\npaths:\n---\n", "paths", ["x"])).toBe("---\nname: a\npaths:\n  - x\n---\n")
  })

  test("quotes items that need it", () => {
    const next = setFrontmatterKey(SKILL, "arguments", ["a: b", "#c"])
    expect(frontmatterEntries(next)?.find((e) => e.key === "arguments")?.value).toEqual({ kind: "list", items: ["a: b", "#c"], flow: false })
  })

  test("CRLF", () => {
    const text = "---\r\nname: a\r\npaths: [a]\r\n---\r\n"
    expect(setFrontmatterKey(text, "paths", ["a", "b"])).toBe("---\r\nname: a\r\npaths: [a, b]\r\n---\r\n")
    expect(setFrontmatterKey("---\r\nname: a\r\n---\r\n", "paths", ["a"])).toBe("---\r\nname: a\r\npaths:\r\n  - a\r\n---\r\n")
  })
})

describe("setFrontmatterKey: changing", () => {
  test("a folded block scalar keeps its style", () => {
    const text = "---\nname: a\nwhen_to_use: >\n  Old\n  text.\nlicense: MIT\n---\n"
    const next = setFrontmatterKey(text, "when_to_use", "New text")
    expect(next).toBe("---\nname: a\nwhen_to_use: >-\n  New text\nlicense: MIT\n---\n")
  })

  test("an empty \"\" doesn't make what's typed into it quoted", () => {
    const added = setFrontmatterKey(SKILL, "when_to_use", "")
    expect(added).toContain('\nwhen_to_use: ""\n')
    expect(setFrontmatterKey(added, "when_to_use", "Before review")).toContain("\nwhen_to_use: Before review\n")
    const spaced = setFrontmatterKey(added, "when_to_use", "Before ")
    expect(spaced).toContain('\nwhen_to_use: "Before "\n')
    expect(setFrontmatterKey(spaced, "when_to_use", "Before a")).toContain("\nwhen_to_use: Before a\n")
  })

  test("yes becomes a boolean, comment kept", () => {
    expect(setFrontmatterKey("---\nuser-invocable: yes # hidden\n---\n", "user-invocable", false)).toBe("---\nuser-invocable: false # hidden\n---\n")
  })

  test("leaves malformed YAML alone", () => {
    for (const text of ["---\nname: [a\n---\nBody", "---\nname: a\nname: b\n---\n", "---\nname: a\nBody", "---\n- a\n---\n"]) {
      expect(setFrontmatterKey(text, "model", "opus")).toBe(text)
      expect(setFrontmatterKey(text, "name", null)).toBe(text)
      expect(setFrontmatterKey(text, "paths", ["a"])).toBe(text)
    }
  })
})

describe("frontmatterEntries", () => {
  test("every key in order, with its value", () => {
    const text = "---\nname: a\nuser-invocable: no\nallowed-tools: [Read, Grep]\npaths:\n  - src/**\nmetadata:\n  author: me\n  version: 2\nmodel:\n---\n"
    expect(frontmatterEntries(text)).toEqual([
      { key: "name", value: { kind: "text", text: "a" }, at: 4 },
      { key: "user-invocable", value: { kind: "text", text: "no" }, at: 12 },
      { key: "allowed-tools", value: { kind: "list", items: ["Read", "Grep"], flow: true }, at: 31 },
      { key: "paths", value: { kind: "list", items: ["src/**"], flow: false }, at: 59 },
      { key: "metadata", value: { kind: "map", keys: ["author", "version"], json: { author: "me", version: 2 } }, at: 77 },
      { key: "model", value: { kind: "text", text: null }, at: 113 },
    ])
  })

  test("null without a readable block", () => {
    expect(frontmatterEntries("Body")).toBeNull()
    expect(frontmatterEntries("---\nname: [a\n---\n")).toBeNull()
  })
})

describe("frontmatterKeyCursor", () => {
  test("on the key when it's there", () => {
    const text = "---\nname: a\nhooks:\n  Stop: []\n---\n"
    expect(frontmatterKeyCursor(text, "hooks")).toEqual({ text, cursor: 12 })
  })

  test("adds an empty key with the cursor indented below it", () => {
    const result = frontmatterKeyCursor("---\nname: a\n---\nBody", "metadata")
    expect(result).toEqual({ text: "---\nname: a\nmetadata:\n  \n---\nBody", cursor: 24 })
    expect(parseFrontmatter(result?.text ?? "").ok).toBe(true)
  })

  test("null when the YAML doesn't parse", () => {
    expect(frontmatterKeyCursor("---\nname: [a\n---\n", "hooks")).toBeNull()
  })
})
