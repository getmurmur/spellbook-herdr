#!/bin/sh
# Links this checkout's mod and layout into Herdr's home, so Herdr runs them from here.
# HERDR_APP_HOME picks another home, as it does for Herdr itself.
set -e
repo=$(cd "$(dirname "$0")/.." && pwd)
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
[ -d "$home" ] || { echo "No Herdr home at $home. Open Herdr once first."; exit 1; }

link() {
  if [ -L "$2" ]; then rm "$2"
  elif [ -e "$2" ]; then echo "$2 already exists and isn't a link. Move it aside first."; exit 1; fi
  ln -s "$1" "$2"
  echo "Linked $2"
}

mkdir -p "$home/mods" "$home/layouts"
link "$repo/mods/spellbook" "$home/mods/spellbook"
link "$repo/layouts/spellbook.json" "$home/layouts/spellbook.json"
echo "Switch to it with ctrl-shift-l, or: herdr-app do layout.switch '{\"name\":\"spellbook\"}'"
