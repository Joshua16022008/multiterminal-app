/* Projektanzeigen: einheitliche Erklärungen, auch wenn die Sidebar neu rendert. */
(function () {
  'use strict';
  const list = document.getElementById('project-list');
  if (!list) return;
  const popup = document.createElement('div');
  popup.id = 'sidebar-tooltip';
  popup.setAttribute('role', 'tooltip');
  popup.hidden = true;
  document.body.append(popup);
  let point = null, focused = null, described = null, frame = 0;

  function hide() {
    popup.hidden = true;
    if (described) {
      const ids = (described.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== popup.id);
      if (ids.length) described.setAttribute('aria-describedby', ids.join(' '));
      else described.removeAttribute('aria-describedby');
    }
    described = null;
  }
  function targetOf(node) {
    const target = node instanceof Element && node.closest('[data-tooltip]');
    return target && list.contains(target) ? target : null;
  }
  function render() {
    frame = 0;
    // Resolve the element again: renderSidebar replaces every project row.
    const target = focused && focused.isConnected ? focused : point && targetOf(document.elementFromPoint(point.x, point.y));
    if (!target || !target.dataset.tooltip) { hide(); return; }
    if (described !== target) {
      hide();
      described = target;
      target.setAttribute('aria-describedby', [target.getAttribute('aria-describedby'), popup.id].filter(Boolean).join(' '));
    }
    popup.textContent = target.dataset.tooltip;
    popup.hidden = false;
    const box = target.getBoundingClientRect();
    const size = popup.getBoundingClientRect();
    const margin = 8;
    let top = box.bottom + margin;
    if (top + size.height > innerHeight - margin) top = box.top - size.height - margin;
    popup.style.left = Math.max(margin, Math.min(box.left, innerWidth - size.width - margin)) + 'px';
    popup.style.top = Math.max(margin, top) + 'px';
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(render); }
  function dismiss() { point = null; focused = null; hide(); }
  list.addEventListener('pointermove', event => { focused = null; point = { x: event.clientX, y: event.clientY }; schedule(); });
  list.addEventListener('pointerleave', () => { point = null; schedule(); });
  list.addEventListener('focusin', event => { focused = targetOf(event.target); point = null; schedule(); });
  list.addEventListener('focusout', () => { focused = null; schedule(); });
  list.addEventListener('click', dismiss, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') dismiss(); });
  document.addEventListener('scroll', dismiss, true);
  window.addEventListener('blur', dismiss);
  window.addEventListener('resize', dismiss);
  // Only content/tooltip changes matter; aria-describedby changes must not loop.
  new MutationObserver(schedule).observe(list, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-tooltip'] });
})();
