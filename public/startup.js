(() => {
  const screen = document.getElementById('signaldesk-startup');
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const status = screen.querySelector('.boot-status');
  const steps = [...screen.querySelectorAll('.boot-stages li')];
  const retry = screen.querySelector('[data-boot-retry]');
  const skip = screen.querySelector('[data-boot-skip]');
  let preferences = {}, phase = -1, finished = false, previewing = false, started = 0;
  let readyTimer, closeTimer, watchdog, previousFocus;
  try { preferences = window.signaldeskDesktop?.savedPreferences ?? JSON.parse(localStorage.getItem('signaldesk.preferences.v1') || '{}'); } catch { /* Defaults work without storage access. */ }
  if (!preferences || typeof preferences !== 'object') preferences = {};
  const animated = () => preferences.motion !== false && !reduced.matches;
  const clearTimers = () => { clearTimeout(readyTimer); clearTimeout(closeTimer); clearTimeout(watchdog); };
  function applyPreferences(value) {
    preferences = value && typeof value === 'object' ? value : {};
    screen.dataset.motion = animated() ? 'on' : 'off';
    if (typeof preferences.accent === 'string' && /^#[a-f0-9]{6}$/i.test(preferences.accent)) screen.style.setProperty('--boot-accent', preferences.accent);
  }
  function close() {
    clearTimers();
    if (!screen.open) return;
    screen.close();
    root.dataset.boot = 'complete';
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    else document.querySelector('.global-search')?.focus({ preventScroll: true });
    window.dispatchEvent(new Event('signaldesk-startup-complete'));
  }
  function dismiss(immediate = false) {
    clearTimers();
    if (!screen.open) return;
    if (immediate || !animated()) { close(); return; }
    screen.dataset.state = 'leaving';
    closeTimer = setTimeout(close, 230);
  }
  function show(preview = false) {
    clearTimers(); previewing = preview; started = performance.now();
    previousFocus = document.activeElement;
    screen.dataset.state = preview ? 'ready' : 'loading';
    screen.dataset.desktop = String(Boolean(window.signaldeskDesktop?.integratedTitlebar));
    applyPreferences(preferences);
    status.textContent = preview ? '启动动画预览' : '正在加载工作台界面';
    retry.hidden = true; skip.textContent = preview ? '关闭预览' : '跳过动画';
    steps.forEach((step, index) => { step.dataset.done = String(preview || phase > index); });
    root.dataset.boot = 'loading';
    if (!screen.open) screen.showModal();
    if (preview) { readyTimer = setTimeout(() => dismiss(), 1700); return; }
    watchdog = setTimeout(() => {
      if (finished || !screen.open) return;
      screen.dataset.state = 'stalled';
      status.textContent = phase < 0 ? '界面加载较慢，可重试或进入工作区' : '本地服务尚未就绪，正在重试连接';
      retry.hidden = false; skip.textContent = '进入工作区';
    }, 12000);
  }
  function stage(next, version) {
    if (finished) return;
    const index = ['interface', 'service', 'workspace'].indexOf(next);
    if (index < phase) return;
    phase = index;
    if (version) screen.querySelector('.boot-version').textContent = `SignalDesk ${version}`;
    steps.forEach((step, position) => { step.dataset.done = String(index > position); });
    status.textContent = ['正在准备工作台界面', '正在连接本地服务', '正在读取设备与工程'][index] || '正在加载工作区';
  }
  function ready() {
    if (finished) return;
    finished = true; clearTimeout(watchdog);
    if (!screen.open || previewing) return;
    steps.forEach(step => { step.dataset.done = 'true'; });
    screen.dataset.state = 'ready'; status.textContent = '工作区已就绪';
    readyTimer = setTimeout(() => dismiss(), animated() ? Math.max(0, 1100 - (performance.now() - started)) : 0);
  }
  window.signaldeskBoot = {
    stage, ready,
    configure(value) { applyPreferences(value); if (screen.open && (!animated() || preferences.startupAnimation === false)) dismiss(true); },
    preview(value) { applyPreferences(value); if (animated()) show(true); },
  };
  skip.addEventListener('click', () => dismiss(true));
  retry.addEventListener('click', () => location.reload());
  screen.addEventListener('cancel', event => { event.preventDefault(); dismiss(true); });
  reduced.addEventListener('change', () => { applyPreferences(preferences); if (!animated()) dismiss(true); });
  window.addEventListener('pagehide', clearTimers);
  if (animated() && preferences.startupAnimation !== false && new URLSearchParams(location.search).get('detached') !== '1') show();
  else root.dataset.boot = 'complete';
})();
