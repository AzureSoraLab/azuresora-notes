/* A lightweight reader-only paper selector that survives React header renders. */
(() => {
  const STORAGE_KEY = 'chengmo-paper-theme-v1';
  const themes = {
    sage: '豆沙绿',
    ivory: '暖米色',
    amber: '浅灰色'
  };
  let queued = false;

  const readTheme = () => {
    try { return themes[localStorage.getItem(STORAGE_KEY)] ? localStorage.getItem(STORAGE_KEY) : 'sage'; }
    catch { return 'sage'; }
  };
  const setTheme = theme => {
    const value = themes[theme] ? theme : 'sage';
    document.documentElement.classList.remove('paper-sage', 'paper-ivory', 'paper-amber');
    document.documentElement.classList.add(`paper-${value}`);
    try { localStorage.setItem(STORAGE_KEY, value); } catch {}
    document.querySelectorAll('[data-paper-theme-label]').forEach(label => { label.textContent = `纸张 · ${themes[value]}`; });
    document.querySelectorAll('[data-paper-theme-option]').forEach(option => {
      const selected = option.dataset.paperThemeOption === value;
      option.classList.toggle('is-selected', selected);
      option.setAttribute('aria-checked', String(selected));
    });
  };
  const closeMenu = control => {
    control?.classList.remove('is-open');
    control?.querySelector('[data-paper-theme-trigger]')?.setAttribute('aria-expanded', 'false');
  };
  const mount = () => {
    queued = false;
    const categoryAdd = document.querySelector('.library .category-add');
    if (categoryAdd) {
      categoryAdd.textContent = '＋ Add';
      categoryAdd.setAttribute('aria-label', '新建分类');
      categoryAdd.title = '新建分类';
    }
    const actions = document.querySelector('.reader-header .reader-actions');
    if (!actions || actions.querySelector('[data-paper-theme-control]')) return;
    const control = document.createElement('div');
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
    setTheme(readTheme());
  };
  const scheduleMount = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(mount);
  };
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-paper-theme-control]')) document.querySelectorAll('[data-paper-theme-control]').forEach(closeMenu);
  });
  setTheme(readTheme());
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
  window.addEventListener('load', scheduleMount, { once: true });
  scheduleMount();
})();
