// Spellbook: write agent skills beside the agent that helps. One mod, three views by props.view:
// "library" (the skills sidebar, or its brand strip with part: "brand"), "skill" (the shown
// space's skill) and "new" (the new skill dialog).
import { View } from "gpui-kit";
import { props } from "herdr";
import { Library } from "./library.js";
import { NewSkill } from "./new.js";
import { Skill } from "./skill.js";

const VIEWS = { library: Library, skill: Skill, new: NewSkill };

export default class Spellbook extends View {
  init(initial, cx) {
    const View = VIEWS[(initial ?? props())?.view] ?? Skill;
    this.view = new View();
    this.view.init(initial ?? props(), cx);
  }

  async close(cx) {
    await this.view.close?.(cx);
  }

  render(cx) {
    return this.view.render(cx);
  }
}
