/* A lightweight reader-only paper selector that survives React header renders. */
(() => {
  const STORAGE_KEY = 'chengmo-paper-theme-v1';
  const themes = {
    sage: '豆沙绿',
    ivory: '暖米色',
    amber: '浅灰色'
  };
  const themeClasses = Object.keys(themes).map(theme => `paper-${theme}`);
  let queued = false;
  let mountFrame = 0;
  let currentTheme = '';

  const normalizeTheme = theme => themes[theme] ? theme : 'sage';
  const readTheme = () => {
    try { return normalizeTheme(localStorage.getItem(STORAGE_KEY)); }
    catch { return 'sage'; }
  };
  const syncThemeControls = (scope = document) => {
    const value = currentTheme || readTheme();
    scope.querySelectorAll('[data-paper-theme-label]').forEach(label => {
      const labelText = `纸张 · ${themes[value]}`;
      if (label.textContent !== labelText) label.textContent = labelText;
    });
    scope.querySelectorAll('[data-paper-theme-option]').forEach(option => {
      const selected = option.dataset.paperThemeOption === value;
      if (option.classList.contains('is-selected') !== selected) option.classList.toggle('is-selected', selected);
      const pressed = String(selected);
      if (option.getAttribute('aria-checked') !== pressed) option.setAttribute('aria-checked', pressed);
    });
  };
  const setTheme = (theme, persist = true) => {
    const value = normalizeTheme(theme);
    const changed = currentTheme !== value;
    if (changed) {
      themeClasses.forEach(className => document.documentElement.classList.toggle(className, className === `paper-${value}`));
      currentTheme = value;
      if (persist) {
        try { if (localStorage.getItem(STORAGE_KEY) !== value) localStorage.setItem(STORAGE_KEY, value); } catch {}
      }
      document.dispatchEvent(new CustomEvent('chengmo:paper-theme-changed', { detail: { theme: value } }));
    }
    syncThemeControls();
  };
  const closeMenu = control => {
    control?.classList.remove('is-open');
    control?.querySelector('[data-paper-theme-trigger]')?.setAttribute('aria-expanded', 'false');
  };
  const mount = () => {
    queued = false; mountFrame = 0;
    const categoryAdd = document.querySelector('.library .category-add');
    if (categoryAdd) {
      categoryAdd.textContent = '＋ Add';
      categoryAdd.setAttribute('aria-label', '新建分类');
      categoryAdd.title = '新建分类';
    }
    const actions = document.querySelector('.reader-header .reader-actions');
    if (!actions) return;
    let control = actions.querySelector('[data-paper-theme-control]');
    if (control) { syncThemeControls(control); return; }
    control = document.createElement('div');
    control.className = 'paper-theme-control';
    control.dataset.paperThemeControl = '';
    control.innerHTML = '<button type="button" class="paper-theme-trigger" data-paper-theme-trigger aria-label="切换阅读纸张" aria-expanded="false"><span data-paper-theme-label></span><span class="paper-theme-chevron" aria-hidden="true">⌄</span></button><div class="paper-theme-menu" role="menu" aria-label="选择阅读纸张"><button type="button" role="menuitemradio" data-paper-theme-option="ivory">暖米色</button><button type="button" role="menuitemradio" data-paper-theme-option="sage">豆沙绿</button><button type="button" role="menuitemradio" data-paper-theme-option="amber">浅灰色</button></div>';
    const trigger = control.querySelector('[data-paper-theme-trigger]');
    trigger.addEventListener('click', event => {
      event.stopPropagation();
      const open = !control.classList.contains('is-open');
      document.querySelectorAll('[data-paper-theme-control]').forEach(closeMenu);
      if (open) {
        control.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
      }
    });
    control.querySelectorAll('[data-paper-theme-option]').forEach(option => {
      option.addEventListener('click', () => {
        setTheme(option.dataset.paperThemeOption);
        closeMenu(control);
      });
    });
    actions.append(control);
    syncThemeControls(control);
  };
  const scheduleMount = () => {
    if (queued) return;
    queued = true;
    mountFrame = requestAnimationFrame(mount);
  };
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-paper-theme-control]')) document.querySelectorAll('[data-paper-theme-control]').forEach(closeMenu);
  });
  setTheme(readTheme(), false);
  const root = document.getElementById('root') || document.body;
  new MutationObserver(records => {
    // Ignore canvas chunks and markdown changes; only a replaced reader header
    // needs the lightweight presence check again.
    if (records.some(record => {
      const target = record.target;
      const inHeader = target instanceof Element && (target.matches('.reader-header, .reader-actions') || target.closest('.reader-header'));
      const addsHeader = [...record.addedNodes].some(node => node instanceof Element && (node.matches('.reader-header, .reader-actions') || node.querySelector('.reader-header, .reader-actions')));
      return inHeader || addsHeader;
    })) scheduleMount();
  }).observe(root, { childList: true, subtree: true });
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY) setTheme(event.newValue, false);
  });
  window.addEventListener('load', scheduleMount, { once: true });
  scheduleMount();
})();
