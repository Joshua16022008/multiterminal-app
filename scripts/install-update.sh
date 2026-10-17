#!/bin/bash
# Deliberately manual: never closes the running app. Invoke from macOS Terminal.
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
# Version comes from package.json, so the installer follows each new update build.
version="$(/usr/bin/sed -n 's/^  "version": *"\([^"]*\)".*/\1/p' "$repo_dir/package.json" | /usr/bin/head -1)"
[ -n "$version" ] || { echo "Version in package.json nicht gefunden." >&2; exit 1; }
update_dir="$repo_dir/dist/updates/Multiterminal-$version"
source_app="$update_dir/Multiterminal.app"
target_app="/Applications/Multiterminal.app"
stage_dir=""

fail() { echo "$*" >&2; exit 1; }
case "${1:-}" in
  ""|--check) ;;
  *) fail "Aufruf: bash scripts/install-update.sh [--check]" ;;
esac
[ "$#" -le 1 ] || fail "Zu viele Argumente."
[ -d "$source_app" ] && [ -s "$update_dir/CHECKSUMS.sha256" ] || fail "Geprüftes Update-Paket fehlt: $update_dir"
echo "Prüfe Update-Paket $version …"
(cd "$update_dir" && /usr/bin/shasum -a 256 -c CHECKSUMS.sha256 >/dev/null) || fail "Update-Prüfsummen stimmen nicht. Bitte Paket erneut erstellen und prüfen."
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$source_app/Contents/Info.plist")" = "$version" ] || fail "Unerwartete App-Version."
if [ "${1:-}" = --check ]; then
  echo "Update $version vollständig; keine Installation und kein App-Start ausgeführt."
  exit 0
fi

assert_closed() {
  local running
  running="$(/bin/ps -axo comm=)"
  if [[ "$running" == *"/Multiterminal.app/Contents/MacOS/Multiterminal"* ]]; then
    fail "Multiterminal läuft noch. Bitte mit ⌘Q schließen und diesen Befehl anschließend im macOS-Terminal ausführen."
  fi
}
assert_closed
[ -w /Applications ] || fail "Keine Schreibberechtigung für /Applications."
stage_dir="$(/usr/bin/mktemp -d /Applications/.multiterminal-update.XXXXXX)"
cleanup() { if [ -n "$stage_dir" ] && [ -d "$stage_dir" ]; then /bin/rm -rf "$stage_dir"; fi; }
trap cleanup EXIT
/usr/bin/ditto "$source_app" "$stage_dir/Multiterminal.app"
# Verify the copy before changing the installed app; keep the old app as backup.
(cd "$stage_dir" && /usr/bin/shasum -a 256 -c "$update_dir/CHECKSUMS.sha256" >/dev/null) || fail "Kopierprüfung fehlgeschlagen; installierte App unverändert."
assert_closed
backup_app="/Applications/Multiterminal.app.before-$version-$(/bin/date +%Y%m%d-%H%M%S)-$$"
if [ -e "$target_app" ]; then
  /bin/mv "$target_app" "$backup_app"
  if ! /bin/mv "$stage_dir/Multiterminal.app" "$target_app"; then
    /bin/mv "$backup_app" "$target_app"
    fail "Installation fehlgeschlagen; vorherige App wiederhergestellt."
  fi
  echo "Vorherige App gesichert: $backup_app"
else
  /bin/mv "$stage_dir/Multiterminal.app" "$target_app"
fi
echo "Multiterminal $version installiert. Projekt-, Konto- und Sitzungsdaten wurden nicht verändert."
/usr/bin/open "$target_app"
