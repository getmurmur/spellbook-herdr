import { describe, expect, test } from "bun:test"
import { addableFields, chipGroups, FIELDS, fieldSpec, fieldTooltip, listInput, listItems, nearestField, nonPortableKeys, parseBool, portabilityWarning, splitList, summarise } from "./frontmatterFields"

describe("the field table", () => {
  test("every documented field, once, in the docs' order", () => {
    expect(FIELDS.map((f) => f.key)).toEqual([
      "name",
      "description",
      "when_to_use",
      "argument-hint",
      "arguments",
      "disable-model-invocation",
      "user-invocable",
      "allowed-tools",
      "disallowed-tools",
      "model",
      "effort",
      "context",
      "agent",
      "background",
      "hooks",
      "paths",
      "shell",
      "license",
      "compatibility",
      "metadata",
    ])
  })

  test("only six fields are portable", () => {
    expect(FIELDS.filter((f) => f.portable).map((f) => f.key)).toEqual(["name", "description", "allowed-tools", "license", "compatibility", "metadata"])
  })

  test("bools say their default, enums their values", () => {
    for (const f of FIELDS) {
      if (f.type === "bool") expect(typeof f.boolDefault).toBe("boolean")
      if (f.type === "enum") expect(f.values?.length).toBeGreaterThan(0)
      if (f.type === "list") expect(f.separator).toBeDefined()
    }
    expect(fieldSpec("effort")?.values).toEqual(["low", "medium", "high", "xhigh", "max"])
    expect(fieldSpec("compatibility")?.max).toBe(500)
  })

  test("copy has no em dashes or exclamation marks", () => {
    for (const f of FIELDS) expect(`${f.hint}${f.placeholder}${f.default ?? ""}`).not.toMatch(/[—!]/)
  })
})

describe("addableFields", () => {
  const keys = (present: Record<string, string | null>) => addableFields(new Map(Object.entries(present))).map((f) => f.key)

  test("never name or description, and nothing already there", () => {
    const list = keys({ name: "a", description: "d", model: "opus" })
    expect(list).not.toContain("name")
    expect(list).not.toContain("description")
    expect(list).not.toContain("model")
    expect(list[0]).toBe("when_to_use")
  })

  test("agent and background only with context: fork", () => {
    expect(keys({})).not.toContain("agent")
    expect(keys({ context: "nope" })).not.toContain("background")
    const forked = keys({ context: "fork" })
    expect(forked).toContain("agent")
    expect(forked).toContain("background")
    expect(forked.indexOf("agent")).toBeGreaterThan(forked.indexOf("effort"))
  })
})

describe("parseBool", () => {
  test("the spellings Claude Code accepts", () => {
    for (const v of ["true", "yes", "on", "1", "True", " YES "]) expect(parseBool(v)).toBe(true)
    for (const v of ["false", "no", "off", "0"]) expect(parseBool(v)).toBe(false)
    expect(parseBool("maybe")).toBeNull()
    expect(parseBool(null)).toBeNull()
  })
})

describe("splitList", () => {
  test("spaces and commas, but not inside parentheses", () => {
    expect(splitList(fieldSpec("allowed-tools"), "Read, Grep Bash(git add *)")).toEqual(["Read", "Grep", "Bash(git add *)"])
  })

  test("paths split on commas only", () => {
    expect(splitList(fieldSpec("paths"), "src/**/*.ts, docs/my notes/*.md")).toEqual(["src/**/*.ts", "docs/my notes/*.md"])
  })

  test("nothing in, nothing out", () => {
    expect(splitList(fieldSpec("arguments"), "  ")).toEqual([])
  })
})

describe("nearestField", () => {
  test("underscores, hyphens and case", () => {
    expect(nearestField("allowed_tools")).toBe("allowed-tools")
    expect(nearestField("when-to-use")).toBe("when_to_use")
    expect(nearestField("Model")).toBe("model")
  })

  test("small typos", () => {
    expect(nearestField("descripton")).toBe("description")
    expect(nearestField("argument-hints")).toBe("argument-hint")
    expect(nearestField("disable-model-invokation")).toBe("disable-model-invocation")
  })

  test("nothing close", () => {
    expect(nearestField("version")).toBeNull()
    expect(nearestField("x")).toBeNull()
  })
})

describe("portability", () => {
  test("anything outside the six fails an upload, typos too", () => {
    expect(nonPortableKeys(["name", "description", "license", "model", "allowed_tools"])).toEqual(["model", "allowed_tools"])
  })

  test("the warning names the offending keys", () => {
    expect(portabilityWarning(["name", "description", "allowed-tools"])).toBeNull()
    const warning = portabilityWarning(["name", "context", "agent"])
    expect(warning?.keys).toEqual(["context", "agent"])
    expect(warning?.title).toContain("uploading this zip there will fail")
  })
})

describe("fieldTooltip", () => {
  test("hint, default, what it needs and where it works", () => {
    const spec = fieldSpec("background")
    if (!spec) throw new Error("background is in the table")
    expect(fieldTooltip(spec)).toEqual([spec.hint, "Default: true", "Only applies with context: fork", "Claude Code only"])
    const license = fieldSpec("license")
    if (!license) throw new Error("license is in the table")
    expect(fieldTooltip(license)).toEqual([license.hint])
  })
})

describe("lists", () => {
  const tools = fieldSpec("allowed-tools")
  const paths = fieldSpec("paths")

  test("items from a YAML list or a string", () => {
    expect(listItems(tools, { kind: "list", items: ["Read"], flow: true })).toEqual(["Read"])
    expect(listItems(tools, { kind: "text", text: "Read Grep" })).toEqual(["Read", "Grep"])
    expect(listItems(tools, { kind: "text", text: null })).toEqual([])
  })

  test("a list stays a list; a string stays a string, with its separator", () => {
    expect(listInput(tools, { kind: "list", items: [], flow: true }, ["Read"])).toEqual(["Read"])
    expect(listInput(tools, { kind: "text", text: null }, ["Read"])).toEqual(["Read"])
    expect(listInput(tools, { kind: "text", text: "Read" }, ["Read", "Grep"])).toBe("Read Grep")
    expect(listInput(tools, { kind: "text", text: "Read, Write" }, ["Read", "Grep"])).toBe("Read, Grep")
    expect(listInput(paths, { kind: "text", text: "src/**" }, ["src/**", "lib/**"])).toBe("src/**, lib/**")
    expect(listInput(paths, { kind: "text", text: "src/**" }, [])).toEqual([])
  })
})

describe("summarise", () => {
  test("hooks count their commands", () => {
    const json = { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command" }, { type: "command" }] }], Stop: [{ hooks: [{ type: "command" }] }] }
    expect(summarise("hooks", { kind: "map", keys: ["PreToolUse", "Stop"], json })).toBe("3 hooks on PreToolUse, Stop")
    expect(summarise("hooks", { kind: "map", keys: ["Stop"], json: { Stop: "odd" } })).toBe("Stop")
  })

  test("maps list their keys, and empty says so", () => {
    expect(summarise("metadata", { kind: "map", keys: ["author", "version"], json: {} })).toBe("author, version")
    expect(summarise("metadata", { kind: "map", keys: [], json: {} })).toBe("Empty")
    expect(summarise("hooks", { kind: "text", text: null })).toBe("Empty")
    expect(summarise("x", { kind: "list", items: ["a", "b"], flow: false })).toBe("a, b")
  })
})

describe("chipGroups", () => {
  const group = (present: Record<string, string | null>) => {
    const { featured, more } = chipGroups(addableFields(new Map(Object.entries(present))))
    return { featured: featured.map((f) => f.key), more: more.map((f) => f.key) }
  }

  test("five featured chips in their own order, the rest behind More fields", () => {
    const { featured, more } = group({ name: "a", description: "d" })
    expect(featured).toEqual(["when_to_use", "allowed-tools", "argument-hint", "disable-model-invocation", "model"])
    expect(more).not.toContain("model")
    expect(more[0]).toBe("arguments")
  })

  test("a featured field already there leaves the other four", () => {
    expect(group({ "allowed-tools": null }).featured).toEqual(["when_to_use", "argument-hint", "disable-model-invocation", "model"])
  })

  test("featured fields are exactly the five, with unique places", () => {
    const ranks = FIELDS.filter((f) => f.featured !== undefined).map((f) => f.featured)
    expect(ranks.sort()).toEqual([1, 2, 3, 4, 5])
  })
})
