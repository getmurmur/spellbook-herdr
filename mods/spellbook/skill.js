import { div } from "gpui-kit";
import { h_flex, v_flex, Editor, EditorState, Input, InputState, Textarea, TextareaState } from "gpui-base";
import { exec, nextCommand, notify, openOverlay, readTextFile, shared, theme, watchFolder, writeTextFile } from "herdr";
import { loadConfig } from "./config.js";
import { bodyProblems, headProblems, lintSkill, readFrontmatter, setFrontmatterField, splitSkill } from "./core.js";
import { newSkillButton } from "./library.js";
import { install, installStatus, shownSkill, skillFiles, skillFolder } from "./skills.js";

const SAVE_AFTER = 600;
const DESCRIPTION_LIMIT = 1024;
const SHOW_COUNT_FROM = 800;

const words = (text) => text.split(/\s+/).filter(Boolean).length;

/**
 * The shown space's skill: name and description bound to the frontmatter, the body in an
 * editor, lint as you type, autosave, and changes on disk (the agent's) picked up live.
 * The text on disk is the truth; `head` and the editor's body only ever add up to it.
 */
export class Skill {
  init(_props, cx) {
    this.id = null;
    this.installedAt = shared("spellbook.installed");
    cx.spawn(async (cx) => {
      this.config = await loadConfig();
      cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "install") this.install(cx, true);
      }
    });
  }

  async close() {
    if (this.dirty) await this.write().catch(() => null);
  }

  // Loading and showing

  open(id, cx) {
    this.release();
    this.id = id;
    this.loading = Boolean(id);
    if (!id) return;
    this.path = `${skillFolder(this.config, id)}/SKILL.md`;
    const path = this.path;
    cx.spawn(async (cx) => {
      const text = await readTextFile(path).catch(() => null);
      if (this.path !== path) return;
      this.loading = false;
      if (text === null) {
        this.missing = true;
        cx.notify();
        return;
      }
      this.files = await skillFiles(this.config, id).catch(() => ["SKILL.md"]);
      if (this.path !== path) return;
      this.build(text);
      this.watch(path, cx);
      this.refreshInstall(cx);
      cx.notify();
    });
  }

  release() {
    for (const state of [this.code, this.nameInput, this.descInput]) state?.release();
    this.code = this.nameInput = this.descInput = null;
    this.watching?.cancel();
    this.watching = null;
    this.disk = this.head = null;
    this.dirty = this.saving = this.missing = false;
    this.outside = this.conflict = null;
    this.path = null;
    this.installState = null;
    this.installing = false;
    this.version = 0;
    this.files = ["SKILL.md"];
  }

  build(text) {
    this.disk = text;
    const { head, body } = splitSkill(text);
    this.head = head;
    const fields = this.fields(text);

    this.nameInput = InputState.new({ value: fields.name, placeholder: "skill-name" });
    this.nameInput.on("change", (_e, cx) => this.setField("name", this.nameInput.value(), cx));

    this.descInput = TextareaState.new({ value: fields.description, placeholder: "What it does, and when to use it" });
    this.descInput.set_auto_grow(2, 6);
    this.descInput.on("change", (_e, cx) => this.setField("description", this.descInput.value(), cx));

    this.code = EditorState.new({
      language: "markdown",
      value: body,
      soft_wrap: true,
      line_numbers: false,
      folding: false,
      font_family: this.config.font,
      font_size: 15,
      syntax: this.syntax(),
    });
    this.code.on("change", (_e, cx) => {
      if (this.applying) return;
      this.edited(cx);
    });
    this.lint();
  }

  syntax() {
    const t = theme();
    // Markdown's marks recede so the words carry the page, as in Spellbook's editor.
    return { keyword: t.accent, punctuation: t.dim, string: t.foreground, comment: t.dim, constant: t.muted, type: t.accent };
  }

  fields(text) {
    const read = readFrontmatter(text);
    if (read.kind !== "ok") return { name: "", description: "" };
    return { name: read.fields.name.value ?? "", description: read.fields.description.value ?? "" };
  }

  text() {
    return this.head + this.code.value();
  }

  /** Puts text that came from elsewhere (disk) into the fields and editor without it counting as an edit. */
  apply(text) {
    this.applying = true;
    const { head, body } = splitSkill(text);
    this.head = head;
    const fields = this.fields(text);
    if (this.code.value() !== body) this.code.set_value(body);
    if (this.nameInput.value() !== fields.name) this.nameInput.set_value(fields.name);
    if (this.descInput.value() !== fields.description) this.descInput.set_value(fields.description);
    this.applying = false;
    this.lint();
  }

  // Editing and saving

  setField(field, value, cx) {
    if (this.applying) return;
    const next = setFrontmatterField(this.text(), field, value);
    const { head, body } = splitSkill(next);
    this.head = head;
    if (body !== this.code.value()) {
      this.applying = true;
      this.code.set_value(body);
      this.applying = false;
    }
    this.edited(cx);
  }

  edited(cx) {
    this.dirty = this.text() !== this.disk;
    this.lint();
    const version = ++this.version;
    cx.timer.after(SAVE_AFTER, (cx) => {
      if (version === this.version) this.save(cx);
    });
    cx.notify();
  }

  lint() {
    const text = this.text();
    this.problems = lintSkill(text, { files: this.files });
    this.body = bodyProblems(this.problems, text, this.head.length);
    this.headOnly = headProblems(this.problems, this.head.length);
  }

  async write() {
    const text = this.text();
    await writeTextFile(this.path, text, this.disk);
    this.disk = text;
    this.dirty = this.text() !== this.disk;
  }

  save(cx) {
    if (!this.dirty || this.saving || this.conflict !== null) return;
    this.saving = true;
    const path = this.path;
    cx.spawn(async (cx) => {
      try {
        await this.write();
      } catch {
        // Someone else wrote it since we last read it: show both rather than pick one.
        if (this.path === path) this.conflict = await readTextFile(path).catch(() => null);
      } finally {
        if (this.path === path) {
          this.saving = false;
          this.refreshInstall(cx);
        }
        cx.notify();
      }
    });
  }

  watch(path, cx) {
    cx.spawn(async (cx) => {
      while (this.path === path) {
        const watching = watchFolder(path.slice(0, path.lastIndexOf("/")));
        this.watching = watching;
        const changed = await watching.catch(() => []);
        if (this.path !== path) return;
        if (!changed.length) continue;
        const files = await skillFiles(this.config, this.id).catch(() => this.files);
        if (this.path !== path) return;
        if (files.join("\n") !== this.files.join("\n")) {
          this.files = files;
          this.lint();
          cx.notify();
        }
        const text = await readTextFile(path).catch(() => null);
        if (this.path !== path || text === null || text === this.disk) continue;
        if (this.dirty) {
          this.conflict = text;
        } else {
          this.outside = { before: this.disk };
          this.disk = text;
          this.apply(text);
        }
        this.refreshInstall(cx);
        cx.notify();
      }
    });
  }

  reload(cx) {
    const text = this.conflict;
    this.conflict = null;
    if (text === null) return;
    this.outside = { before: this.disk };
    this.disk = text;
    this.apply(text);
    this.dirty = false;
    cx.notify();
  }

  keepMine(cx) {
    this.disk = this.conflict;
    this.conflict = null;
    this.dirty = true;
    this.save(cx);
  }

  /** Puts back what was there before the last change from outside the editor. */
  revertOutside(cx) {
    const before = this.outside?.before;
    this.outside = null;
    if (before == null) return;
    this.apply(before);
    this.edited(cx);
  }

  // Install

  refreshInstall(cx) {
    const id = this.id;
    cx.spawn(async (cx) => {
      const state = await installStatus(this.config, id).catch(() => null);
      if (this.id !== id) return;
      this.installState = state;
      cx.notify();
    });
  }

  install(cx, confirmed) {
    if (!this.id || this.installing) return;
    if (this.installState === "changed" && !confirmed) {
      openOverlay({
        mod: "confirm",
        kind: "dialog",
        width: 420,
        props: {
          title: "Update the installed copy?",
          detail: `Claude Code's copy of ${this.id} is different from this draft. Installing replaces it with the draft.`,
          command: { name: "spellbook.install" },
        },
      });
      return;
    }
    const id = this.id;
    this.installing = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (this.dirty) await this.write();
        await install(this.config, id);
        notify({ title: `Installed ${id} in Claude Code`, level: "success", timeout: 3000 });
      } catch (e) {
        notify({ title: "Couldn't install", body: String(e), level: "error" });
      } finally {
        this.installing = false;
        if (this.id === id) this.refreshInstall(cx);
        cx.notify();
      }
    });
  }

  reveal() {
    if (this.id) exec("open", [skillFolder(this.config, this.id)]);
  }

  // Drawing

  render(cx) {
    const t = theme();
    if (!this.config) return div().size_full();
    const id = shownSkill(this.config);
    if (id !== this.id) this.open(id, cx);
    const stamp = shared("spellbook.installed");
    if (stamp !== this.installedAt) {
      this.installedAt = stamp;
      if (this.id) this.refreshInstall(cx);
    }

    const page = v_flex().size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13);
    if (!id) {
      return page.items_center().justify_center().gap(12)
        .child(div().text_color(t.muted).child("Pick a skill, or make a new one"))
        .child(newSkillButton("skill-empty-new", t));
    }
    if (this.missing) return page.items_center().justify_center().child(div().text_color(t.muted).child(`${id} has no SKILL.md`));
    if (this.loading || !this.code) return page;

    const fieldProblem = (field) => this.problems.find((p) => p.field === field && p.severity === "error") ?? this.problems.find((p) => p.field === field);
    const note = (problem, fallback) =>
      div()
        .pt(5)
        .min_h(20)
        .text_size(11.5)
        .text_color(problem ? (problem.severity === "error" ? t.ansi1 : t.ansi3) : t.dim)
        .child(problem?.message ?? fallback);
    const description = this.descInput.value();
    const count = description.length >= SHOW_COUNT_FROM ? `${description.length}/${DESCRIPTION_LIMIT}` : "";

    return page
      .child(this.header(t))
      .child(
        v_flex()
          .flex_none()
          .px(28)
          .pt(6)
          .child(this.label("Name", t))
          .child(Input.new(this.nameInput).h(34).px(10).rounded(8).border_1().border_color(t.input).bg(t.surface).text_size(13.5))
          .child(note(fieldProblem("name"), ""))
          .child(h_flex().justify_between().child(this.label("Description", t)).child(div().text_size(11.5).text_color(t.dim).child(count)))
          .child(Textarea.new(this.descInput).px(10).py(8).rounded(8).border_1().border_color(t.input).bg(t.surface).text_size(13.5))
          .child(note(fieldProblem("description"), ""))
          .when(this.headOnly.length > 0, (el) =>
            el.child(v_flex().gap(2).children(this.headOnly.map((p) => note(p, "")))),
          ),
      )
      .when(this.conflict !== null, (el) =>
        el.child(this.bar("SKILL.md changed on disk while you were typing", [["Reload", (cx) => this.reload(cx)], ["Keep mine", (cx) => this.keepMine(cx)]], t)),
      )
      .when(this.conflict === null && this.outside !== null, (el) =>
        el.child(this.bar("SKILL.md was changed outside the editor", [["Revert", (cx) => this.revertOutside(cx)], ["Keep", (cx) => { this.outside = null; cx.notify(); }]], t)),
      )
      .child(div().mx(28).mt(10).h(1).flex_none().bg(t.border))
      .child(h_flex().flex_1().min_h(0).justify_center().px(16).child(Editor.new(this.code).w_full().max_w(760).h_full()))
      .child(this.footer(t));
  }

  label(text, t) {
    return div().pb(6).text_size(11.5).text_color(t.dim).child(text);
  }

  header(t) {
    const state = this.installState;
    const text = this.installing ? "Installing…" : state === "installed" ? "Installed in Claude Code" : state === "changed" ? "Update in Claude Code" : "Install in Claude Code";
    const quiet = state === "installed" && !this.installing;
    return h_flex()
      .flex_none()
      .h(46)
      .px(28)
      .items_center()
      .justify_between()
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .min_w(0)
          .child(div().truncate().child(this.id))
          .child(div().text_size(11.5).text_color(t.dim).child(this.saving ? "Saving…" : this.dirty ? "Unsaved" : "Saved")),
      )
      .child(
        h_flex()
          .gap(6)
          .child(this.button("skill-reveal", "Show in Finder", false, () => this.reveal(), t))
          .child(this.button("skill-install", text, !quiet, (_e, cx) => this.install(cx, false), t)),
      );
  }

  button(id, text, primary, action, t) {
    return h_flex()
      .id(id)
      .h(28)
      .px(12)
      .items_center()
      .rounded(7)
      .border_1()
      .border_color(primary ? t.solid : t.input)
      .bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.muted)
      .text_size(12.5)
      .cursor_pointer()
      .hover((s) => s.opacity(0.88))
      .on_click(action)
      .child(text);
  }

  bar(message, actions, t) {
    return h_flex()
      .flex_none()
      .mx(28)
      .mt(8)
      .px(12)
      .h(34)
      .gap(12)
      .items_center()
      .rounded(8)
      .bg(t.raised)
      .border_1()
      .border_color(t.border)
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(message))
      .children(
        actions.map(([label, action]) =>
          div()
            .id(`bar-${label}`)
            .text_color(t.foreground)
            .cursor_pointer()
            .hover((s) => s.text_color(t.accent))
            .on_click((_e, cx) => action(cx))
            .child(label),
        ),
      );
  }

  footer(t) {
    const errors = this.problems.filter((p) => p.severity === "error").length;
    const warnings = this.problems.length - errors;
    const summary = this.problems.length === 0 ? "No problems" : [errors && `${errors} ${errors === 1 ? "error" : "errors"}`, warnings && `${warnings} ${warnings === 1 ? "warning" : "warnings"}`].filter(Boolean).join(", ");
    const first = this.body[0];
    return h_flex()
      .flex_none()
      .h(30)
      .px(28)
      .gap(14)
      .items_center()
      .border_t(1)
      .border_color(t.border)
      .text_size(11.5)
      .text_color(t.dim)
      .child(div().text_color(errors ? t.ansi1 : warnings ? t.ansi3 : t.dim).child(summary))
      .when(Boolean(first), (el) => el.child(div().flex_1().min_w(0).truncate().child(`Line ${first.line}: ${first.message}`)))
      .when(!first, (el) => el.child(div().flex_1()))
      .child(div().child(`${words(this.code.value())} words`));
  }
}
