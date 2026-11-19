import { Document, Scalar, isMap, isNode, isScalar, isSeq, parseDocument, type Node, type Pair, type YAMLMap } from "yaml"

export type FrontmatterField = "name" | "description"

/** What a key can be set to: text, a boolean, a list, or null to remove the key. */
export type FrontmatterInput = string | boolean | string[] | null

/** A key's value as the header shows it. */
export type FrontmatterValue =
  | { kind: "text"; text: string | null }
  | { kind: "list"; items: string[]; flow: boolean }
  | { kind: "map"; keys: string[]; json: unknown }

export type FrontmatterEntry = {
  key: string
  value: FrontmatterValue
  /** Where the key starts in the document. */
  at: number
}

export type Frontmatter = {
  /** False when the document has no frontmatter block, or the YAML doesn't parse. */
  ok: boolean
  name: string | null
  description: string | null
}

/** Where the frontmatter block sits in the document. */
export type FrontmatterRange = {
  /** The start of the opening `---`, always 0. */
  from: number
  /** The end of the closing `---` line, before its line break. */
  to: number
  /** The first character after the opening line. */
  contentFrom: number
  /** The start of the closing line; equal to contentFrom when the block is empty. */
  contentTo: number
}

const OPEN = /^---[ \t]*\r?\n/
const CLOSE = /^(?:---|\.\.\.)[ \t]*(?=\r?$)/gm

/** The frontmatter block's range, or null when the document doesn't start with a closed one. */
export function frontmatterRange(text: string): FrontmatterRange | null {
  const open = OPEN.exec(text)
  if (!open) return null
  const contentFrom = open[0].length
  CLOSE.lastIndex = contentFrom
  const close = CLOSE.exec(text)
  if (!close) return null
  return { from: 0, to: close.index + close[0].length, contentFrom, contentTo: close.index }
}

/** True when the first line opens a frontmatter block, closed or not. */
function opensFrontmatter(text: string): boolean {
  return /^---[ \t]*(\r?\n|$)/.test(text)
}

type FieldNode = {
  key: string
  /** The parsed value as text, or null when it's absent, empty or not a scalar. */
  value: string | null
  /** The key is in the map, whatever its value. */
  present: boolean
  /** The value's range in the whole document; an empty range just after the colon when it has none. */
  from: number
  to: number
  /** The value is a list or map rather than a single value. */
  nested: boolean
  node: Node | null
  /** The key's own range. */
  keyFrom: number
  keyTo: number
  /** Just past the pair's last line break, where the next key starts. */
  end: number
}

export type ReadFrontmatter =
  | { kind: "none" }
  | { kind: "invalid"; range: FrontmatterRange | null; errorAt: number; message: string }
  | {
      kind: "ok"
      range: FrontmatterRange
      map: YAMLMap | null
      fields: Record<FrontmatterField, FieldNode>
      /** Every key, in the file's order. */
      entries: FieldNode[]
      keys: number
    }

function scalarText(node: Scalar): string | null {
  const v = node.value
  if (v === null || v === undefined) return null
  const text = typeof v === "string" ? v : String(v)
  // Block scalars keep their final line break ("clip" chomping); a field doesn't want it.
  return node.type === Scalar.BLOCK_FOLDED || node.type === Scalar.BLOCK_LITERAL ? text.replace(/\r?\n+$/, "") : text
}

const keyName = (pair: Pair): string | null => (isScalar(pair.key) && pair.key.value !== null && pair.key.value !== undefined ? String(pair.key.value) : null)

/** Just past the line break at or after `pos`, or `limit` when the line runs into it. */
function lineEnd(text: string, pos: number, limit: number): number {
  if (text[pos - 1] === "\n") return pos
  const i = text.indexOf("\n", pos)
  return i < 0 || i >= limit ? limit : i + 1
}

function absent(key: string, offset: number): FieldNode {
  return { key, value: null, present: false, from: offset, to: offset, nested: false, node: null, keyFrom: offset, keyTo: offset, end: offset }
}

function readPair(text: string, pair: Pair, key: string, offset: number, limit: number): FieldNode {
  const keyRange = isScalar(pair.key) ? pair.key.range : null
  const keyFrom = offset + (keyRange?.[0] ?? 0)
  const keyTo = offset + (keyRange?.[1] ?? 0)
  const node = pair.value
  if (!isNode(node) || !node.range) {
    const colon = text.indexOf(":", keyTo)
    const after = colon < 0 ? keyTo : colon + 1
    return { key, value: null, present: true, from: after, to: after, nested: false, node: null, keyFrom, keyTo, end: lineEnd(text, after, limit) }
  }
  const [start, valueEnd, nodeEnd] = node.range
  const end = lineEnd(text, offset + nodeEnd, limit)
  const base = { key, present: true, from: offset + start, to: offset + valueEnd, node, keyFrom, keyTo, end }
  if (isScalar(node)) return { ...base, value: scalarText(node), nested: false }
  return { ...base, value: null, nested: true }
}

/** The frontmatter with its YAML nodes and their positions, for lint and for rewriting fields. */
export function readFrontmatter(text: string): ReadFrontmatter {
  const range = frontmatterRange(text)
  if (!range) {
    if (opensFrontmatter(text)) return { kind: "invalid", range: null, errorAt: 0, message: "Frontmatter has no closing ---" }
    return { kind: "none" }
  }
  const source = text.slice(range.contentFrom, range.contentTo)
  const doc = parseDocument(source)
  const error = doc.errors[0]
  if (error) {
    return { kind: "invalid", range, errorAt: range.contentFrom + error.pos[0], message: firstLine(error.message) }
  }
  const contents = doc.contents
  if (contents !== null && !isMap(contents)) {
    return { kind: "invalid", range, errorAt: range.contentFrom, message: "Frontmatter should be a list of keys and values" }
  }
  const map = contents
  const entries: FieldNode[] = []
  for (const pair of map?.items ?? []) {
    const key = keyName(pair)
    if (key !== null) entries.push(readPair(text, pair, key, range.contentFrom, range.contentTo))
  }
  const field = (key: string) => entries.find((e) => e.key === key) ?? absent(key, range.contentFrom)
  return {
    kind: "ok",
    range,
    map,
    keys: map?.items.length ?? 0,
    entries,
    fields: { name: field("name"), description: field("description") },
  }
}

function firstLine(message: string): string {
  return message.split("\n")[0].replace(/ at line \d+, column \d+:?$/, "")
}

/** Reads `name` and `description` from the document's frontmatter. */
export function parseFrontmatter(text: string): Frontmatter {
  const read = readFrontmatter(text)
  if (read.kind !== "ok") return { ok: false, name: null, description: null }
  return { ok: true, name: read.fields.name.value, description: read.fields.description.value }
}

const itemText = (item: unknown): string => {
  if (isScalar(item)) return scalarText(item) ?? ""
  if (isNode(item)) return JSON.stringify(item.toJSON())
  return String(item)
}

function valueOf(entry: FieldNode): FrontmatterValue {
  const node = entry.node
  if (isSeq(node)) return { kind: "list", items: node.items.map(itemText), flow: node.flow === true }
  if (isMap(node)) return { kind: "map", keys: node.items.map(keyName).filter((k) => k !== null), json: node.toJSON() }
  return { kind: "text", text: entry.value }
}

/** Every key in the frontmatter with its value, in the file's order; null when there's no block or it doesn't parse. */
export function frontmatterEntries(text: string): FrontmatterEntry[] | null {
  const read = readFrontmatter(text)
  if (read.kind !== "ok") return null
  return read.entries.map((e) => ({ key: e.key, value: valueOf(e), at: e.keyFrom }))
}

function needsQuotes(value: string): boolean {
  return /^["']/.test(new Document({ v: value }).toString({ lineWidth: 0 }).slice(3))
}

/** One scalar as YAML, keeping the old value's style where it still fits. */
function serialiseScalar(key: string, value: string | boolean, previous: Node | null): string {
  const doc = new Document({ [key]: value })
  const node = doc.get(key, true)
  let lineWidth = 0
  if (isScalar(node) && typeof value === "string") {
    // Quotes the old value needed (an empty "", a trailing space as it's typed) weren't a style choice.
    const chosen = isScalar(previous) && typeof previous.value === "string" && !needsQuotes(previous.value)
    const type = chosen ? previous.type : undefined
    if (value.includes("\n")) {
      node.type = type === Scalar.BLOCK_FOLDED ? Scalar.BLOCK_FOLDED : Scalar.BLOCK_LITERAL
    } else if (type === Scalar.QUOTE_SINGLE || type === Scalar.QUOTE_DOUBLE || type === Scalar.BLOCK_LITERAL) {
      node.type = type
    } else if (type === Scalar.BLOCK_FOLDED) {
      node.type = type
      lineWidth = 80
    }
  }
  const out = doc.toString({ lineWidth })
  return out.slice(key.length + 1).replace(/^ /, "").replace(/\n$/, "")
}

/**
 * A list as YAML, from its colon on: `: [a, b]` or `:\n  - a\n  - b`. A list already written in
 * flow style stays that way, an empty `[]` aside, and items line up under the key if they did.
 */
function serialiseList(key: string, items: string[], previous: Node | null, keyColumn: number, previousColumn: number | null): string {
  const doc = new Document({ [key]: items })
  const node = doc.get(key, true)
  const flow = items.length === 0 || (isSeq(previous) && previous.flow === true && previous.items.length > 0)
  if (isSeq(node)) node.flow = flow
  const indentSeq = previousColumn === null || previousColumn !== keyColumn
  const out = doc.toString({ lineWidth: 0, flowCollectionPadding: false, indentSeq })
  return out.slice(key.length).replace(/\n$/, "")
}

const columnOf = (text: string, pos: number) => pos - (text.lastIndexOf("\n", pos - 1) + 1)

/** Where a new key goes: name leads, description follows it, and everything else goes after the keys already there. */
function insertAt(read: Extract<ReadFrontmatter, { kind: "ok" }>, key: string): number {
  if (key === "name") return read.range.contentFrom
  if (key === "description") return read.fields.name.present ? read.fields.name.end : read.range.contentFrom
  return read.range.contentTo
}

/**
 * The document with one frontmatter key set, or removed when `value` is null. Comments and the
 * order of other keys survive; a new key goes after the ones there. Malformed YAML is left alone.
 */
export function setFrontmatterKey(text: string, key: string, value: FrontmatterInput): string {
  const read = readFrontmatter(text)
  if (read.kind === "invalid") return text
  const nl = text.includes("\r\n") ? "\r\n" : "\n"
  const withBreaks = (s: string) => (nl === "\n" ? s : s.replace(/\r?\n/g, nl))
  const line = (v: string | boolean | string[]) =>
    withBreaks(Array.isArray(v) ? `${key}${serialiseList(key, v, null, 0, null)}` : `${key}: ${serialiseScalar(key, v, null)}`)

  if (read.kind === "none") {
    if (value === null) return text
    const block = `---${nl}${line(value)}${nl}---${nl}`
    if (text === "") return block
    return block + (/^\r?\n/.test(text) ? text : nl + text)
  }

  const target = read.entries.find((e) => e.key === key)
  if (!target) {
    if (value === null || read.map?.flow) return text
    const at = insertAt(read, key)
    return text.slice(0, at) + line(value) + nl + text.slice(at)
  }

  if (value === null) {
    const from = text.lastIndexOf("\n", target.keyFrom - 1) + 1
    return text.slice(0, from) + text.slice(target.end)
  }

  if (Array.isArray(value) || target.nested) {
    // From the colon on, as a list can move to the lines below its key.
    const firstItem = isSeq(target.node) && !target.node.flow ? target.from : null
    const after = Array.isArray(value)
      ? serialiseList(key, value, target.node, columnOf(text, target.keyFrom), firstItem === null ? null : columnOf(text, firstItem))
      : `: ${serialiseScalar(key, value, null)}`
    const old = text.slice(target.keyTo, target.to)
    let next = withBreaks(after)
    const trailing = /\r?\n$/.exec(old)
    if (trailing) next += trailing[0]
    if (next === old) return text
    return text.slice(0, target.keyTo) + next + text.slice(target.to)
  }

  const old = text.slice(target.from, target.to)
  let next = withBreaks(serialiseScalar(key, value, target.node))
  // A block scalar's range runs through its last line break, which the next key needs.
  const trailing = /\r?\n$/.exec(old)
  if (trailing) next += trailing[0]
  if (old === "" && text[target.from - 1] === ":") next = " " + next
  if (next === old) return text
  return text.slice(0, target.from) + next + text.slice(target.to)
}

/** `setFrontmatterKey` for name and description, which are always text. */
export function setFrontmatterField(text: string, field: FrontmatterField, value: string): string {
  return setFrontmatterKey(text, field, value)
}

/**
 * Where to put the cursor to edit a key in the raw frontmatter. A key that isn't there yet is
 * added with nothing under it, and the cursor goes on the indented line below, ready for its
 * keys. Null when the frontmatter can't take it.
 */
export function frontmatterKeyCursor(text: string, key: string): { text: string; cursor: number } | null {
  const read = readFrontmatter(text)
  if (read.kind !== "ok") return null
  const target = read.entries.find((e) => e.key === key)
  if (target) return { text, cursor: target.keyFrom }
  if (read.map?.flow) return null
  const nl = text.includes("\r\n") ? "\r\n" : "\n"
  const at = read.range.contentTo
  const insert = `${key}:${nl}  `
  return { text: text.slice(0, at) + insert + nl + text.slice(at), cursor: at + insert.length }
}
