import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { openOverlay, shared, theme, watchFolder } from "herdr";
import { loadConfig } from "./config.js";
import { listSkills, openSkill, shownSkill, spaceFor } from "./skills.js";

const INSTALL_LABEL = { installed: "Installed", changed: "Changed since install" };

export function openNewSkill() {
  openOverlay({ mod: "spellbook", props: { view: "new" }, kind: "dialog", width: 440 });
}

export function newSkillButton(id, t) {
  return h_flex()
    .id(id)
    .h(28)
    .px(10)
    .items_center()
    .rounded(7)
    .border_1()
    .border_color(t.input)
    .bg(t.raised)
    .text_size(12.5)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click(() => openNewSkill())
    .child("New skill");
}

/** The skills sidebar: the person's drafts, newest first, each opening its own space. */
export class Library {
  init(props, cx) {
    this.brand = props?.part === "brand";
    this.items = [];
    this.loaded = false;
    this.error = null;
    this.installedAt = shared("spellbook.installed");
    if (this.brand) return;
    cx.spawn(async (cx) => {
      this.config = await loadConfig();
      this.reload(cx);
      this.watch(cx);
    });
  }

  reload(cx) {
    cx.spawn(async (cx) => {
      try {
        this.items = await listSkills(this.config);
        this.error = null;
      } catch (e) {
        this.error = String(e);
      }
      this.loaded = true;
      cx.notify();
    });
  }

  watch(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        try {
          await watchFolder(this.config.root);
        } catch {
          // The folder may not exist until the first skill is made; look again shortly.
          await new Promise((resolve) => cx.timer.after(5000, resolve));
        }
        this.reload(cx);
      }
    });
  }

  render(cx) {
    const t = theme();
    if (this.brand) {
      return h_flex()
        .size_full()
        .pl(84)
        .pr(12)
        .items_center()
        .justify_between()
        .text_color(t.muted)
        .text_size(13)
        .child("Spellbook")
        .child(newSkillButton("brand-new", t));
    }

    const stamp = shared("spellbook.installed");
    if (stamp !== this.installedAt && this.config) {
      this.installedAt = stamp;
      this.reload(cx);
    }

    const shown = this.config ? shownSkill(this.config) : null;
    const rows = this.items.map((item) => {
      const status = spaceFor(this.config, item.id)?.status;
      return h_flex()
          .id(`skill-${item.id}`)
          .h(30)
          .flex_none()
          .px(10)
          .gap(8)
          .items_center()
          .rounded(7)
          .cursor_pointer()
          .when(item.id === shown, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click(() => openSkill(this.config, item.id))
          .child(
            div()
              .size(6)
              .flex_none()
              .rounded(3)
              .when(Boolean(status) && status !== "idle", (el) => el.bg(t[status])),
          )
          .child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .text_color(item.id === shown ? t.foreground : t.muted)
              .child(item.id),
          )
          .when(item.install !== "draft", (el) =>
            el.child(
              div()
                .flex_none()
                .text_size(11.5)
                .text_color(item.install === "changed" ? t.ansi3 : t.dim)
                .child(INSTALL_LABEL[item.install]),
            ),
          );
    });

    const empty = this.loaded && !this.error && this.items.length === 0;
    return v_flex()
      .size_full()
      .text_size(13)
      .text_color(t.foreground)
      .child(div().px(16).pt(10).pb(6).text_size(11.5).text_color(t.dim).child("Skills"))
      .when(Boolean(this.error), (el) => el.child(div().px(16).text_size(12).text_color(t.ansi1).child(this.error)))
      .when(empty, (el) =>
        el.child(
          v_flex()
            .px(16)
            .pt(8)
            .gap(10)
            .items_start()
            .child(div().text_color(t.muted).child("No skills yet"))
            .child(newSkillButton("empty-new", t)),
        ),
      )
      .child(v_flex().id("skills").flex_1().min_h(0).overflow_y_scrollbar().px(6).py(4).gap(1).children(rows));
  }
}
