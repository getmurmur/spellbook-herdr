import { appHome, home, notify, readTextFile } from "herdr";

const DEFAULTS = { root: "~/Skills", claude: "~/.claude/skills", agent: ["claude"], font: "Geist" };

const expand = (path) => (path === "~" ? home() : path.startsWith("~/") ? home() + path.slice(1) : path);
const strings = (value) => Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string");

/**
 * The person's choices, from spellbook.json in Herdr's home: where skills are drafted, where
 * Claude Code reads them, the agent to start and the editor's font. Anything missing or the
 * wrong type falls back to Spellbook's defaults.
 */
export async function loadConfig() {
  let saved = {};
  const text = await readTextFile(`${appHome()}/spellbook.json`).catch(() => null);
  if (text) {
    try {
      saved = JSON.parse(text) ?? {};
    } catch {
      notify({ title: "spellbook.json isn't valid JSON", body: "Using the defaults until it's fixed", level: "warning" });
    }
  }
  const pick = (key) => (typeof saved[key] === "string" && saved[key] ? saved[key] : DEFAULTS[key]);
  return {
    root: expand(pick("root")).replace(/\/+$/, ""),
    claude: expand(pick("claude")).replace(/\/+$/, ""),
    agent: strings(saved.agent) ? saved.agent : DEFAULTS.agent,
    font: pick("font"),
  };
}
