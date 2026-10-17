#!/bin/bash
# Independent updater. All inputs are main-process argv in a private staging directory.
set -u
umask 077
owner="$1"; stage="$2"; target="$3"; result="$4"; ready="$5"; timeout="${6:-60}"
open_command="${7:-/usr/bin/open}"; move_command="${8:-/bin/mv}"; expected_manifest="${9:-}"; process_command="${10:-/bin/ps}"
work="${stage%/*}"; backup="$work/previous.app"; bundle="$stage/Multiterminal.app"
state() {
  # Fixed strings only: no user-controlled JSON interpolation.
  local code="$1" message
  case "$code" in
    installed) message="Multiterminal wurde aktualisiert und der Neustart angefordert.";;
    waiting_for_exit) message="Die Aktualisierung wartet auf das Beenden der App.";;
    parent_timeout) message="Die App wurde nicht rechtzeitig beendet. Die bisherige App bleibt erhalten.";;
    target_running) message="Die App wird noch verwendet. Die bisherige App bleibt erhalten.";;
    replacement_failed) message="Die Installation ist fehlgeschlagen. Die bisherige App wurde wiederhergestellt.";;
    relaunch_failed) message="Der Neustart ist fehlgeschlagen. Die bisherige App wurde wiederhergestellt.";;
    rollback_failed) message="Die Wiederherstellung ist fehlgeschlagen. Bitte die Sicherung im Update-Ordner verwenden.";;
    start_cancelled) message="Der Update-Start wurde abgebrochen. Die bisherige App bleibt erhalten.";;
    *) message="Die Update-Pruefung ist fehlgeschlagen. Die bisherige App bleibt erhalten.";;
  esac
  printf '{"state":"%s","message":"%s"}\n' "$code" "$message" > "$result.tmp.$$" && /bin/mv "$result.tmp.$$" "$result" || return 1
  printf '%s %s\n' "$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')" "$code"
}
fail() { state "$1"; exit 1; }
[[ "$owner" =~ ^[0-9]+$ && "$timeout" =~ ^[0-9]+$ ]] || exit 2
[ -d "$bundle" ] && [ -d "$target" ] && [ -s "$stage/CHECKSUMS.sha256" ] || fail invalid_stage
# Ready is emitted only after arguments and writable persistent status are established.
state waiting_for_exit || exit 1
: > "$ready" || exit 1
elapsed=0
while [ ! -f "$work/go" ]; do
  [ -d "$work" ] || exit 1
  [ ! -f "$work/cancelled" ] || fail start_cancelled
  [ "$elapsed" -lt 10 ] || fail start_cancelled
  /bin/sleep 1; elapsed=$((elapsed + 1))
done
elapsed=0
while /bin/kill -0 "$owner" 2>/dev/null; do
  [ "$elapsed" -lt "$timeout" ] || fail parent_timeout
  /bin/sleep 1; elapsed=$((elapsed + 1))
done
[ -d "$work" ] || exit 1
[ -f "$work/go" ] && [ ! -f "$work/cancelled" ] || fail start_cancelled
# Fail closed if any process executable belongs to the old target. No process is killed.
check_target_stopped() {
  local processes executable
  processes=$("$process_command" -axo comm=) || fail process_check_failed
  while IFS= read -r executable; do
    case "$executable" in "$target/"*) fail target_running;; esac
  done <<< "$processes"
}
check_target_stopped
cd "$stage" || fail invalid_stage
if [ -n "$expected_manifest" ]; then
  actual_manifest=$(/usr/bin/shasum -a 256 CHECKSUMS.sha256) || fail invalid_manifest
  [ "${actual_manifest%% *}" = "$expected_manifest" ] || fail invalid_manifest
fi
# Complete file inventory must match the checksummed files, before shasum consumes paths.
/usr/bin/awk 'length($1)!=64 || $1 !~ /^[0-9a-fA-F]+$/ || substr($0,65,2)!="  " {exit 1} {p=substr($0,67); if(p !~ /^Multiterminal.app\// || p ~ /(^|\/)\.\.?($|\/)/ || p ~ /\\/ || p ~ /\/\//) exit 1; print p}' CHECKSUMS.sha256 > "$work/expected" || fail invalid_manifest
/usr/bin/sort "$work/expected" > "$work/expected.sorted"
[ "$(/usr/bin/uniq -d "$work/expected.sorted" | /usr/bin/wc -l | /usr/bin/tr -d ' ')" = 0 ] || fail invalid_manifest
/usr/bin/find Multiterminal.app -type f | LC_ALL=C /usr/bin/sort > "$work/actual"
LC_ALL=C /usr/bin/sort "$work/expected" > "$work/expected.sorted"
/usr/bin/cmp -s "$work/expected.sorted" "$work/actual" || fail invalid_inventory
# Framework aliases are allowed only when their fully resolved destination stays inside bundle.
while IFS= read -r link; do
  resolved="$link"; n=0
  while [ -L "$resolved" ]; do
    n=$((n + 1)); [ "$n" -lt 40 ] || fail invalid_symlink
    dest=$(/usr/bin/readlink "$resolved") || fail invalid_symlink
    case "$dest" in /*) resolved="$dest";; *) resolved="$(/usr/bin/dirname "$resolved")/$dest";; esac
    parent=$(cd -P "$(/usr/bin/dirname "$resolved")" 2>/dev/null && pwd) || fail invalid_symlink
    resolved="$parent/$(/usr/bin/basename "$resolved")"
  done
  if [ -d "$resolved" ]; then resolved=$(cd -P "$resolved" && pwd) || fail invalid_symlink; fi
  case "$resolved" in "$bundle"|"$bundle/"*) [ -e "$resolved" ] || fail invalid_symlink;; *) fail invalid_symlink;; esac
done < <(/usr/bin/find "$bundle" -type l)
/usr/bin/shasum -a 256 -c CHECKSUMS.sha256 >/dev/null 2>&1 || fail invalid_checksums
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$bundle/Contents/Info.plist")" = de.joshua.multiterminal ] || fail invalid_identity
[ -d "$work" ] || exit 1
[ -f "$work/go" ] && [ ! -f "$work/cancelled" ] || fail start_cancelled
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$bundle/Contents/Info.plist") || fail invalid_version
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][a-zA-Z0-9_.-]+)?$ ]] || fail invalid_version
check_target_stopped
"$move_command" "$target" "$backup" || fail backup_failed
if ! "$move_command" "$bundle" "$target"; then
  "$move_command" "$backup" "$target" || fail rollback_failed
  "$open_command" "$target" || true
  fail replacement_failed
fi
if ! "$open_command" "$target"; then
  "$move_command" "$target" "$work/failed.app" && "$move_command" "$backup" "$target" || fail rollback_failed
  "$open_command" "$target" || true
  fail relaunch_failed
fi
state installed
