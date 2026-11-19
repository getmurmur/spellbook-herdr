import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, Textarea, TextareaState } from "gpui-base";
import { closeOverlay, exec, notify, props, theme, writeTextFile } from "herdr";
import { loadConfig } from "./config.js";
import { nameProblem, newSkillText } from "./core.js";
import { listSkills, openSkill, skillFolder } from "./skills.js";

/**
 * The new skill dialog. A name makes a blank skill; a sentence about what it should do also
 * becomes the agent's first message, as Spellbook's Describe it does.
 */
export class NewSkill {
  init(_props, cx) {
    this.taken = [];
    this.touched = false;
    this.busy = false;
    this.name = InputState.new({ placeholder: "tidy-prs" });
    this.name.on("change", (_e, cx) => {
      this.touched = true;
      cx.notify();
    });
    this.name.on("submit", (_e, cx) => this.create(cx));
    this.about = TextareaState.new({ placeholder: "Optional. Splits a messy branch into small pull requests" });
    this.about.set_auto_grow(2, 5);
    this.name.focus();
    // The dialog takes a moment to be shown; focusing again then puts the caret in the field.
    cx.timer.after(300, () => this.name.focus());
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      this.config = await loadConfig();
      this.taken = (await listSkills(this.config).catch(() => [])).map((s) => s.id);
      cx.notify();
    });
  }

  problem() {
    return nameProblem(this.name.value().trim(), this.taken);
  }

  create(cx) {
    this.touched = true;
    if (this.busy || !this.config || this.problem()) {
      cx.notify();
      return;
    }
    const id = this.name.value().trim();
    const about = this.about.value().trim();
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const folder = skillFolder(this.config, id);
        // mkdir without -p on the skill itself, so a folder that appeared meanwhile isn't reused.
        const made = await exec("sh", ["-c", 'mkdir -p "$1" && mkdir "$2"', "spellbook", this.config.root, folder]);
        if (made.code !== 0) throw new Error(made.stderr.trim() || "Couldn't make the skill");
        await writeTextFile(`${folder}/SKILL.md`, newSkillText(id), null);
        closeOverlay(props().overlay);
        await openSkill(this.config, id, about || undefined);
      } catch (e) {
        notify({ title: "Couldn't make the skill", body: String(e), level: "error" });
        this.busy = false;
        cx.notify();
      }
    });
  }

  render() {
    const t = theme();
    const problem = this.touched ? this.problem() : null;
    const label = (text) => div().pt(14).pb(6).text_size(11.5).text_color(t.dim).child(text);
    const button = (id, text, primary, action) =>
      h_flex()
        .id(id)
        .h(32)
        .px(14)
        .items_center()
        .rounded(8)
        .border_1()
        .border_color(primary ? t.solid : t.input)
        .bg(primary ? t.solid : t.raised)
        .text_color(primary ? t.solid_foreground : t.foreground)
        .text_size(12.5)
        .cursor_pointer()
        .hover((s) => s.opacity(0.88))
        .on_click(action)
        .child(text);
    return v_flex()
      .id("new-skill")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        closeOverlay(props().overlay);
        cx.stop_propagation();
      })
      .w_full()
      .p(18)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(
        h_flex()
          .items_center()
          .child(div().flex_1().text_size(15).child("New skill"))
          .child(div().text_size(11).text_color(t.dim).child("Esc")),
      )
      .child(label("Name"))
      .child(
        Input.new(this.name)
          .h(36)
          .px(10)
          .rounded(9)
          .border_1()
          .border_color(problem ? t.ansi1 : t.input)
          .bg(t.background)
          .text_size(13),
      )
      .child(div().pt(6).h(22).text_size(11.5).text_color(problem ? t.ansi1 : t.dim).child(problem ?? "Lowercase, with hyphens"))
      .child(label("What should it do?"))
      .child(Textarea.new(this.about).px(10).py(8).rounded(9).border_1().border_color(t.input).bg(t.background).text_size(13))
      .child(div().pt(6).text_size(11.5).text_color(t.dim).child("Claude drafts it from this. Leave it empty for a blank skill."))
      .child(
        h_flex()
          .pt(18)
          .gap(8)
          .justify_end()
          .child(button("new-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
          .child(button("new-create", this.busy ? "Making…" : "Make skill", true, (_e, cx) => this.create(cx))),
      );
  }
}
