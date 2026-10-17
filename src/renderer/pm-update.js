'use strict';

// Package paths and versions are display data only. Main owns validation and confirmation.
(function () {
  const pm = window.pm;
  const $ = id => document.getElementById('pm-update-' + id);
  const panel = document.getElementById('pm-update');
  const controls = ['open', 'select', 'install', 'close'].map($);
  let token = null, busy = false, supported = true, started = false;
  function sync() {
    for (const button of controls) button.disabled = busy || started;
    $('select').disabled = busy || started || !supported;
    $('install').disabled = busy || started || !supported || !token;
    panel.setAttribute('aria-busy', String(busy));
  }
  function feedback(text, error = false) {
    $('feedback').textContent = text;
    $('feedback').className = error ? 'pm-err' : '';
  }
  function clearSelection() { token = null; $('preview').hidden = true; }
  function showLast(result) {
    if (!result) return;
    const success = result.state === 'installed';
    const pending = result.state === 'waiting_for_exit';
    const messages = {
      installed: 'erfolgreich.', waiting_for_exit: 'wartet auf das Beenden der App.',
      parent_timeout: 'abgebrochen, weil die App nicht rechtzeitig beendet wurde.',
      invalid_checksums: 'abgebrochen, weil die Paketprüfung fehlgeschlagen ist.',
      relaunch_failed: 'Neustart fehlgeschlagen; die vorherige App wurde wiederhergestellt.',
      start_cancelled: 'vor dem Beenden der App abgebrochen.',
      start_failed: 'konnte nicht vorbereitet oder gestartet werden.',
      invalid_stage: 'abgebrochen, weil das vorbereitete Paket ungültig ist.',
      invalid_manifest: 'abgebrochen, weil die Prüfsummenliste ungültig ist.',
      invalid_inventory: 'abgebrochen, weil Dateien fehlen oder nicht geprüft sind.',
      invalid_symlink: 'abgebrochen, weil das Paket ungültige Dateiverknüpfungen enthält.',
      invalid_identity: 'abgebrochen, weil das Paket nicht zu Multiterminal gehört.',
      backup_failed: 'abgebrochen, weil die bisherige App nicht gesichert werden konnte.',
      target_running: 'abgebrochen, weil die Ziel-App noch läuft.',
      replacement_failed: 'fehlgeschlagen; die vorherige App wurde wiederhergestellt.',
      rollback_failed: 'fehlgeschlagen; die vorherige App konnte nicht wiederhergestellt werden.',
    };
    $('last').textContent = 'Letzte Installation: ' + (messages[result.state] || result.message || result.error || 'Ergebnis unbekannt.');
    $('last').className = success ? 'pm-update-success' : pending ? '' : 'pm-err';
    $('last').hidden = false;
  }
  async function request(action) {
    if (busy || started) return;
    busy = true; sync();
    try { await action(); }
    catch (error) { feedback((error && error.message) || 'Update konnte nicht ausgeführt werden.', true); }
    finally { busy = false; sync(); }
  }
  $('open').onclick = () => request(async () => {
    panel.hidden = false;
    $('open').setAttribute('aria-expanded', 'true');
    feedback('Update-Status wird geprüft…');
    if (!pm || typeof pm.updateStatus !== 'function') {
      supported = false; feedback('App-Updates sind in dieser App nicht verfügbar.', true); return;
    }
    const result = await pm.updateStatus();
    if (!result || !result.ok) { feedback((result && result.error) || 'Update-Status konnte nicht geladen werden.', true); return; }
    supported = result.supported !== false;
    showLast(result.lastResult);
    feedback(result.message || (result.busy ? 'In einem anderen Fenster wird bereits ein Update vorbereitet.' : supported ? 'Wähle ein lokales Update-Paket.' : 'Updates sind in dieser App nicht verfügbar.'));
  });
  $('close').onclick = () => {
    if (busy || started) return;
    clearSelection(); panel.hidden = true;
    $('open').setAttribute('aria-expanded', 'false'); $('open').focus(); sync();
  };
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !busy && !started) { event.preventDefault(); $('close').onclick(); }
  });
  $('select').onclick = () => {
    if (!supported) return;
    return request(async () => {
      clearSelection(); feedback('Update-Paket wird geprüft…');
      const result = await pm.updateSelect();
      if (result && result.cancelled) { feedback('Paketauswahl abgebrochen.'); return; }
      if (!result || !result.ok || !result.token) { feedback((result && result.error) || 'Update-Paket konnte nicht geprüft werden.', true); return; }
      token = result.token;
      for (const [id, value] of [['current', result.currentVersion], ['version', result.version], ['package', result.packagePath], ['target', result.targetPath]]) $(id).textContent = value || 'unbekannt';
      $('preview').hidden = false;
      feedback('Paket geprüft. „Installieren…“ öffnet die abschließende Bestätigung.');
    });
  };
  $('install').onclick = () => {
    if (!token || !supported) return;
    return request(async () => {
      const selected = token;
      clearSelection(); feedback('Installation wird bestätigt und vorbereitet…');
      const result = await pm.updateInstall(selected);
      if (result && result.cancelled) { feedback('Installation abgebrochen. Wähle das Paket erneut, um fortzufahren.'); return; }
      if (!result || !result.ok || !result.started) { feedback((result && result.error) || 'Installation konnte nicht gestartet werden. Wähle das Paket erneut.', true); return; }
      started = true;
      feedback('Die App wird beendet und nach dem Update wieder geöffnet.');
    });
  };
  sync();
})();
