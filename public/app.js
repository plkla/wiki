/**
 * WikiKurekk - Kompletna aplikacja SPA Frontend (Vanilla JS)
 * Właściciel: public/app.js
 */

(function () {
  'use strict';

  function getInitialTheme() {
    try {
      const saved = localStorage.getItem('wiki_theme');
      if (saved === 'dark' || saved === 'light') return saved;
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch (_) {}
    return 'light';
  }

  // --- Stan aplikacji ---
  const state = {
    token: localStorage.getItem('wiki_token') || '',
    currentUser: null,
    settings: {
      site_name: 'WikiKurekk',
      site_tagline: 'Wolna encyklopedia',
      announcement_banner: '',
      allow_anonymous_edits: '0'
    },
    stats: {
      articlesCount: 0,
      usersCount: 0,
      totalViews: 0,
      revisionsCount: 0
    },
    categories: [],
    allSlugs: [],
    articleTitlesBySlug: {},
    activeSlug: null,
    adminActiveTab: 'kpi',
    currentRoute: null,
    theme: getInitialTheme()
  };

  let activeEditorGuard = null;
  let isBypassingHashGuard = false;
  let isPromptingLeave = false;
  let lastAuthExpiredToastAt = 0;
  let lastAuthTriggerEl = null;

  // --- Motyw jasny / ciemny ---
  function applyTheme(theme) {
    const clean = theme === 'dark' ? 'dark' : 'light';
    state.theme = clean;
    document.documentElement.setAttribute('data-theme', clean);
    try {
      localStorage.setItem('wiki_theme', clean);
    } catch (_) {}
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      btn.textContent = clean === 'dark' ? 'Jasny motyw' : 'Ciemny motyw';
      btn.setAttribute('aria-pressed', clean === 'dark' ? 'true' : 'false');
    }
  }

  // Uprawnienia edycji encyklopedii
  function canEditWiki() {
    if (state.currentUser && state.currentUser.role === 'blocked') return false;
    if (state.currentUser && (state.currentUser.role === 'admin' || state.currentUser.role === 'editor')) {
      return true;
    }
    if (String(state.settings.allow_anonymous_edits) === '1') {
      return true;
    }
    return false;
  }

  // --- Pomocnicze funkcje tekstowe, URL i formatowania ---
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function isSafeUrl(url) {
    const str = String(url || '').trim();
    if (!str) return false;
    if (/^\/(?!\/)/.test(str)) return true;
    try {
      const parsed = new URL(str);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function slugifyTitle(text) {
    if (text == null) return '';
    const str = String(text).trim();
    if (!str) return '';
    const polishMap = {
      'ą': 'a', 'Ą': 'a',
      'ć': 'c', 'Ć': 'c',
      'ę': 'e', 'Ę': 'e',
      'ł': 'l', 'Ł': 'l',
      'ń': 'n', 'Ń': 'n',
      'ó': 'o', 'Ó': 'o',
      'ś': 's', 'Ś': 's',
      'ź': 'z', 'Ź': 'z',
      'ż': 'z', 'Ż': 'z'
    };
    const replaced = str.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, ch => polishMap[ch] || ch);
    return replaced
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString('pl-PL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // --- Pomocnicze funkcje kategorii ---
  function getCatName(c) {
    return (!c) ? '' : (typeof c === 'object' ? String(c.name || '') : String(c));
  }

  function getCatCount(c) {
    return (c && typeof c === 'object' && typeof c.count === 'number') ? c.count : null;
  }

  function parseCategories(raw) {
    if (Array.isArray(raw)) {
      return raw.map(c => getCatName(c).trim()).filter(Boolean);
    }
    if (!raw) return [];
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.map(c => getCatName(c).trim()).filter(Boolean);
        }
      } catch {
        return raw.split(',').map(s => s.trim()).filter(Boolean);
      }
    }
    return [];
  }

  function stripSnippetFootnotes(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    tmp.querySelectorAll('sup.wiki-ref, .wiki-references').forEach(el => el.remove());
    return tmp.innerHTML;
  }

  // --- System powiadomień Toast ---
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };
    const icon = icons[type] || 'ℹ️';

    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-message">${escapeHtml(message)}</span>
      <button class="toast-close" type="button" aria-label="Zamknij">&times;</button>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    let timer = null;

    const removeToast = () => {
      if (timer) clearTimeout(timer);
      toast.classList.add('toast-fade-out');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    };

    closeBtn.addEventListener('click', removeToast);
    container.appendChild(toast);
    timer = setTimeout(removeToast, 3500);
  }

  window.showToast = showToast;

  // --- Niestandardowy modal potwierdzenia (.modal-backdrop / .modal-card) ---
  function showConfirmModal({
    title = 'Potwierdzenie',
    message = '',
    confirmText = 'Potwierdź',
    cancelText = 'Anuluj',
    danger = false
  } = {}) {
    return new Promise((resolve) => {
      const previousActive = document.activeElement;
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop confirm-modal-backdrop';
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');
      backdrop.setAttribute('aria-labelledby', 'confirm-modal-title');

      backdrop.innerHTML = `
        <div class="modal-card confirm-modal-card">
          <div class="modal-header">
            <h3 id="confirm-modal-title" class="modal-title">${escapeHtml(title)}</h3>
            <button type="button" class="modal-close confirm-close-x" aria-label="Zamknij okno">&times;</button>
          </div>
          <div class="modal-body">
            <p class="confirm-modal-message">${escapeHtml(message)}</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline confirm-cancel-btn">${escapeHtml(cancelText)}</button>
            <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'} confirm-ok-btn">${escapeHtml(confirmText)}</button>
          </div>
        </div>
      `;

      let resolved = false;
      const cleanup = (result) => {
        if (resolved) return;
        resolved = true;
        document.removeEventListener('keydown', onKeyDown, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        if (previousActive && typeof previousActive.focus === 'function' && document.contains(previousActive)) {
          previousActive.focus();
        }
        resolve(result);
      };

      const onKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cleanup(false);
        }
      };

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) cleanup(false);
      });
      backdrop.querySelector('.confirm-close-x').addEventListener('click', () => cleanup(false));
      backdrop.querySelector('.confirm-cancel-btn').addEventListener('click', () => cleanup(false));
      backdrop.querySelector('.confirm-ok-btn').addEventListener('click', () => cleanup(true));

      document.addEventListener('keydown', onKeyDown, true);
      document.body.appendChild(backdrop);
      backdrop.querySelector(danger ? '.confirm-cancel-btn' : '.confirm-ok-btn').focus();
    });
  }

  // --- Komunikacja z API ---
  async function api(path, options = {}) {
    const fetchOpts = Object.assign({}, options);
    const headers = Object.assign({}, options.headers || {});

    if (fetchOpts.body && typeof fetchOpts.body === 'object' && !(fetchOpts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(fetchOpts.body);
    }

    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
      headers['X-Wiki-Token'] = state.token;
    }
    fetchOpts.headers = headers;

    const res = await fetch(path, fetchOpts);
    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json().catch(() => null);
    } else {
      data = await res.text().catch(() => null);
    }

    if (!res.ok) {
      if (
        res.status === 401 &&
        state.token &&
        !options.suppressAuthExpiry &&
        !path.startsWith('/api/auth/login') &&
        !path.startsWith('/api/auth/register')
      ) {
        clearAuthToken();
        const now = Date.now();
        if (now - lastAuthExpiredToastAt > 3000) {
          lastAuthExpiredToastAt = now;
          showToast('Sesja wygasła. Zaloguj się ponownie.', 'warning');
        }
      }

      const errorMsg = (data && data.error) ? data.error : `Błąd serwera (${res.status})`;
      const error = new Error(errorMsg);
      error.status = res.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  function setAuthToken(token, user = null) {
    state.token = token;
    state.currentUser = user;
    localStorage.setItem('wiki_token', token);
    updateHeaderAndSidebar();
  }

  function clearAuthToken() {
    state.token = '';
    state.currentUser = null;
    localStorage.removeItem('wiki_token');
    resetAuthForms();
    updateHeaderAndSidebar();
  }

  function resetAuthForms() {
    document.getElementById('login-form')?.reset();
    document.getElementById('register-form')?.reset();
    ['login-error', 'register-error'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = '';
        el.classList.add('hidden');
      }
    });
  }

  async function refreshBootstrapMetadata() {
    try {
      const boot = await api('/api/bootstrap', { suppressAuthExpiry: true });
      state.settings = boot.settings || state.settings;
      state.stats = boot.stats || state.stats;
      state.categories = boot.categories || state.categories;
      state.allSlugs = boot.allSlugs || state.allSlugs;
      if (boot.currentUser !== undefined) {
        state.currentUser = boot.currentUser;
      }
      if (Array.isArray(boot.recentArticles)) {
        boot.recentArticles.forEach(a => {
          if (a && a.slug && a.title) state.articleTitlesBySlug[a.slug] = a.title;
        });
      }
      updateHeaderAndSidebar();
    } catch (_) {}
  }

  // --- Szuflada boczna na urządzeniach mobilnych ---
  function setSidebarOpen(open) {
    const sidebar = document.getElementById('wiki-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const isOpen = Boolean(open);
    if (sidebar) sidebar.classList.toggle('is-open', isOpen);
    if (backdrop) {
      backdrop.classList.toggle('is-open', isOpen);
      backdrop.classList.toggle('hidden', !isOpen);
    }
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
  }

  function initSidebarDrawer() {
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const backdrop = document.getElementById('sidebar-backdrop');
    const sidebar = document.getElementById('wiki-sidebar');

    if (toggleBtn && sidebar) {
      toggleBtn.addEventListener('click', () => {
        setSidebarOpen(!sidebar.classList.contains('is-open'));
      });
    }
    if (backdrop) {
      backdrop.addEventListener('click', () => setSidebarOpen(false));
    }
    if (sidebar) {
      sidebar.addEventListener('click', (e) => {
        if (e.target.closest('a, button')) {
          setSidebarOpen(false);
        }
      });
    }
  }

  // --- Aktualizacja Nagłówka, Paska bocznego i Banera ---
  function updateHeaderAndSidebar() {
    const siteNameEl = document.getElementById('site-name-label');
    const siteTaglineEl = document.getElementById('site-tagline-label');
    if (siteNameEl) siteNameEl.textContent = state.settings.site_name || 'WikiKurekk';
    if (siteTaglineEl) siteTaglineEl.textContent = state.settings.site_tagline || 'Wolna encyklopedia';

    // Baner ogłoszeniowy
    const bannerEl = document.getElementById('announcement-banner');
    if (bannerEl) {
      const bannerText = (state.settings.announcement_banner || '').trim();
      if (bannerText) {
        bannerEl.innerHTML = `<span class="announcement-icon" aria-hidden="true">📢</span> <span class="announcement-text">${escapeHtml(bannerText)}</span>`;
        bannerEl.classList.remove('hidden');
      } else {
        bannerEl.innerHTML = '';
        bannerEl.classList.add('hidden');
      }
    }

    // Odznaka użytkownika i przyciski auth
    const userBadgeEl = document.getElementById('user-badge');
    const logoutBtn = document.getElementById('logout-btn');
    const authModalBtn = document.getElementById('auth-modal-btn');
    const registerModalBtn = document.getElementById('register-modal-btn');
    const navAdminTop = document.getElementById('nav-admin-top');

    if (userBadgeEl) {
      if (state.currentUser) {
        userBadgeEl.textContent = state.currentUser.username;
        userBadgeEl.classList.remove('hidden');
        if (logoutBtn) logoutBtn.classList.remove('hidden');
        if (authModalBtn) authModalBtn.classList.add('hidden');
        if (registerModalBtn) registerModalBtn.classList.add('hidden');
      } else {
        userBadgeEl.textContent = '';
        userBadgeEl.classList.add('hidden');
        if (logoutBtn) logoutBtn.classList.add('hidden');
        if (authModalBtn) authModalBtn.classList.remove('hidden');
        if (registerModalBtn) registerModalBtn.classList.remove('hidden');
      }
    }

    if (navAdminTop) {
      const isAdmin = !!(state.currentUser && state.currentUser.role === 'admin');
      navAdminTop.classList.toggle('hidden', !isAdmin);
    }

    const createLink = document.querySelector('.wiki-sidebar .nav-link-create');
    if (createLink) {
      const canEdit = canEditWiki();
      createLink.classList.toggle('hidden', !canEdit);
      const prevTitle = createLink.previousElementSibling;
      if (prevTitle && prevTitle.classList.contains('sidebar-section-title')) {
        prevTitle.classList.toggle('hidden', !canEdit);
      }
    }

    const sidebarStatsEl = document.getElementById('sidebar-stats');
    if (sidebarStatsEl) {
      sidebarStatsEl.innerHTML = `
        <div class="stat-row"><span>Hasła</span><span class="stat-number">${state.stats.articlesCount || 0}</span></div>
        <div class="stat-row"><span>Wersje</span><span class="stat-number">${state.stats.revisionsCount || 0}</span></div>
        <div class="stat-row"><span>Wyświetlenia</span><span class="stat-number">${state.stats.totalViews || 0}</span></div>
      `;
    }

    const sidebarCategoriesEl = document.getElementById('sidebar-categories');
    if (sidebarCategoriesEl && state.categories) {
      if (state.categories.length === 0) {
        sidebarCategoriesEl.innerHTML = '<span class="sidebar-empty">Brak kategorii</span>';
      } else {
        const topCategories = state.categories.slice(0, 8);
        const moreCount = state.categories.length - topCategories.length;
        sidebarCategoriesEl.innerHTML = topCategories.map(cat => {
          const name = getCatName(cat);
          const count = getCatCount(cat);
          return `
            <a href="#/categories/${encodeURIComponent(name)}" class="sidebar-cat-link">
              <span class="sidebar-cat-name">${escapeHtml(name)}</span>
              ${count !== null ? `<span class="sidebar-cat-count">${count}</span>` : ''}
            </a>
          `;
        }).join('') + (moreCount > 0
          ? `<a href="#/categories" class="sidebar-cat-more">Wszystkie kategorie (${state.categories.length}) &rarr;</a>`
          : '');
      }
    }

    const currentHash = window.location.hash || '#/';
    document.querySelectorAll('.wiki-sidebar .nav-link').forEach(link => {
      const href = link.getAttribute('href');
      if (href === currentHash || (href !== '#/' && currentHash.startsWith(href))) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }

  // --- Pasek zakładek artykułu ---
  function updateArticleTabs(slug, activeTab = 'read', revCount, talkCount) {
    const tabsBar = document.getElementById('article-tabs-bar');
    if (!tabsBar) return;

    if (!slug) {
      state.activeSlug = null;
      tabsBar.classList.add('hidden');
      return;
    }

    state.activeSlug = slug;
    tabsBar.classList.remove('hidden');

    const tabRead = document.getElementById('tab-btn-read');
    const tabTalk = document.getElementById('tab-btn-talk');
    const tabEdit = document.getElementById('tab-btn-edit');
    const tabHistory = document.getElementById('tab-btn-history');

    const allTabs = [tabRead, tabTalk, tabEdit, tabHistory].filter(Boolean);
    allTabs.forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });

    if (tabEdit) {
      tabEdit.classList.toggle('hidden', !canEditWiki());
    }

    const activeMap = {
      read: tabRead,
      talk: tabTalk,
      edit: tabEdit,
      history: tabHistory
    };
    const activeEl = activeMap[activeTab];
    if (activeEl) {
      activeEl.classList.add('active');
      activeEl.setAttribute('aria-selected', 'true');
    }

    const revBadge = document.getElementById('rev-count-badge');
    if (revBadge && revCount !== undefined) {
      revBadge.textContent = revCount;
    }
    const talkBadge = document.getElementById('talk-count-badge');
    if (talkBadge && talkCount !== undefined) {
      talkBadge.textContent = talkCount;
    }
  }

  // --- Normalizacja i renderowanie Infoboxu ---
  /**
   * Normalizes raw infobox payloads (null, JSON string, legacy flat object, or { title, image, items }).
   */
  function normalizeInfobox(rawInfobox) {
    const result = { title: '', image: '', items: {} };
    if (!rawInfobox) return result;

    let parsed = rawInfobox;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return result;
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return result;
    }

    result.title = (parsed.title !== undefined && parsed.title !== null && typeof parsed.title !== 'object')
      ? String(parsed.title)
      : '';
    result.image = (parsed.image !== undefined && parsed.image !== null && typeof parsed.image !== 'object')
      ? String(parsed.image)
      : '';

    const sourceItems = (parsed.items && typeof parsed.items === 'object' && !Array.isArray(parsed.items))
      ? parsed.items
      : parsed;

    for (const [key, val] of Object.entries(sourceItems)) {
      if (key === 'title' || key === 'image' || key === 'items') continue;
      if (val !== undefined && val !== null && val !== '') {
        result.items[key] = typeof val === 'object' ? JSON.stringify(val) : String(val);
      }
    }

    return result;
  }

  function renderInfobox(infoboxData, fallbackTitle = '') {
    const normalized = normalizeInfobox(infoboxData);
    const title = normalized.title || fallbackTitle;
    const image = isSafeUrl(normalized.image) ? normalized.image.trim() : '';

    let rowsHtml = '';
    for (const [key, val] of Object.entries(normalized.items)) {
      if (val !== undefined && val !== null && val !== '') {
        rowsHtml += `
          <tr>
            <th scope="row" class="infobox-label">${escapeHtml(key)}</th>
            <td class="infobox-data">${escapeHtml(String(val))}</td>
          </tr>
        `;
      }
    }

    if (!rowsHtml && !image) return '';

    return `
      <aside class="wiki-infobox">
        ${title ? `<div class="infobox-title">${escapeHtml(title)}</div>` : ''}
        ${image ? `<div class="infobox-image"><img src="${escapeHtml(image)}" alt="${escapeHtml(title || 'Ilustracja')}" loading="lazy" /></div>` : ''}
        ${rowsHtml ? `
          <table class="infobox-table">
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        ` : ''}
      </aside>
    `;
  }

  // --- Renderowanie spisu treści TOC ---
  function renderToc(toc) {
    if (!toc || !Array.isArray(toc) || toc.length === 0) return '';
    return `
      <nav class="wiki-toc" aria-label="Spis treści">
        <div class="wiki-toc-header">
          <div class="toc-title">Spis treści</div>
          <button type="button" class="wiki-toc-toggle" aria-expanded="true">Ukryj</button>
        </div>
        <ul class="toc-list">
          ${toc.map(item => `
            <li class="toc-item toc-level-${item.level || 2}">
              <a href="#${escapeHtml(item.id)}" class="toc-link">${escapeHtml(item.text)}</a>
            </li>
          `).join('')}
        </ul>
      </nav>
    `;
  }

  // --- Nawigacja z ochroną niezapisanych zmian w edytorze ---
  async function confirmLeaveEditorIfDirty() {
    if (!activeEditorGuard || !activeEditorGuard.isDirty()) return true;
    if (isPromptingLeave) return false;
    isPromptingLeave = true;
    try {
      const ok = await showConfirmModal({
        title: 'Niezapisane zmiany',
        message: 'Masz niezapisane zmiany w edytorze. Czy na pewno chcesz opuścić tę stronę i je utracić?',
        confirmText: 'Opuść bez zapisywania',
        cancelText: 'Zostań w edytorze',
        danger: true
      });
      if (ok && activeEditorGuard) {
        activeEditorGuard.cleanup();
        activeEditorGuard = null;
      }
      return ok;
    } finally {
      isPromptingLeave = false;
    }
  }

  async function navigateWithGuard(targetHash) {
    const canLeave = await confirmLeaveEditorIfDirty();
    if (!canLeave) return;
    if (window.location.hash === targetHash) {
      handleRoute();
    } else {
      window.location.hash = targetHash;
    }
  }

  // --- WIDOK 1: Strona Główna (#/) ---
  async function renderHomePage() {
    updateArticleTabs(null);
    const viewRoot = document.getElementById('view-root');
    viewRoot.innerHTML = '<div class="wiki-loading">Ładowanie encyklopedii...</div>';

    try {
      const data = await api('/api/bootstrap');
      state.settings = data.settings || state.settings;
      state.stats = data.stats || state.stats;
      state.categories = data.categories || state.categories;
      state.allSlugs = data.allSlugs || state.allSlugs;
      if (data.currentUser !== undefined) state.currentUser = data.currentUser;
      updateHeaderAndSidebar();

      const featured = data.featuredArticle;
      const recentArticles = data.recentArticles || [];
      recentArticles.forEach(a => {
        if (a && a.slug && a.title) state.articleTitlesBySlug[a.slug] = a.title;
      });
      if (featured && featured.slug && featured.title) {
        state.articleTitlesBySlug[featured.slug] = featured.title;
      }

      const featuredSnippetHtml = featured && featured.renderedHtml
        ? stripSnippetFootnotes(featured.renderedHtml.split(/<h[23]\b/i)[0] || '')
        : '';

      const didYouKnowFacts = [
        '…że Mikołaj Kopernik w dziele <em>De revolutionibus orbium coelestium</em> sformułował heliocentryczną teorię Układu Słonecznego, wywołując przełom w nowożytnej nauce?',
        '…że Maria Skłodowska-Curie jest jedyną kobietą wyróżnioną dwiema Nagrodami Nobla w dwóch różnych dziedzinach nauk ścisłych: fizyce i chemii?',
        '…że Warszawa stała się stolicą Polski pod koniec XVI wieku po decyzji króla Zygmunta III Wazy o przeniesieniu dworu z Krakowa?',
        '…że język JavaScript powstał w maju 1995 roku w laboratoriach firmy Netscape w zaledwie 10 dni dzięki Brendanowi Eichowi?',
        '…że Polska była jednym z pierwszych krajów na świecie, które wprowadziły konstytucję pisaną (Konstytucja 3 maja z 1791 r.)?'
      ];

      viewRoot.innerHTML = `
        <div class="main-page-welcome">
          <div class="welcome-banner">
            <div class="welcome-banner-main">
              <h1>Witaj w ${escapeHtml(state.settings.site_name)}</h1>
              <p class="welcome-lead">${escapeHtml(state.settings.site_tagline || 'Otwarta encyklopedia tworzona przez redaktorów.')}</p>
            </div>
            <div class="welcome-banner-aside">
              <div class="welcome-stat-count"><strong>${state.stats.articlesCount || 0}</strong> haseł encyklopedycznych · <strong>${state.stats.revisionsCount || 0}</strong> wersji</div>
              <div class="welcome-links">
                <a href="#/articles">Indeks haseł</a>
                <span class="welcome-sep">&middot;</span>
                <a href="#/categories">Kategorie</a>
                <span class="welcome-sep">&middot;</span>
                <button type="button" id="main-random-btn" class="welcome-link-btn">Losowy artykuł</button>
                ${canEditWiki() ? `<span class="welcome-sep">&middot;</span><a href="#/new">Utwórz hasło</a>` : ''}
              </div>
            </div>
          </div>
        </div>

        <div class="main-page-grid">
          <div class="main-col-left">
            <section class="main-card card-featured">
              <div class="card-header">
                <h2>Artykuł wyróżniony</h2>
                ${featured ? `<a href="#/wiki/${featured.slug}" class="card-header-link">${escapeHtml(featured.title)} &rarr;</a>` : ''}
              </div>
              <div class="card-body clearfix">
                ${featured ? `
                  ${renderInfobox(featured.infobox, featured.title)}
                  <h3 class="featured-article-heading"><a href="#/wiki/${featured.slug}">${escapeHtml(featured.title)}</a></h3>
                  ${featured.summary ? `<p class="featured-summary">${escapeHtml(featured.summary)}</p>` : ''}
                  <div class="featured-content-snippet">
                    ${featuredSnippetHtml}
                  </div>
                  <div class="card-footer-link">
                    <a href="#/wiki/${featured.slug}">Czytaj cały artykuł &rarr;</a>
                  </div>
                ` : `
                  <p>Obecnie żaden artykuł nie jest oznaczony jako wyróżniony.</p>
                `}
              </div>
            </section>

            <section class="main-card card-categories">
              <div class="card-header">
                <h2>Działy tematyczne</h2>
                <a href="#/categories" class="card-header-link">Pełny wykaz &rarr;</a>
              </div>
              <div class="card-body">
                <div class="categories-index-list">
                  ${state.categories.map(cat => {
                    const name = getCatName(cat);
                    const count = getCatCount(cat);
                    return `
                      <a href="#/categories/${encodeURIComponent(name)}" class="category-index-item">
                        <span class="category-index-name">${escapeHtml(name)}</span>
                        ${count !== null ? `<span class="category-index-count">(${count})</span>` : ''}
                      </a>
                    `;
                  }).join('')}
                </div>
              </div>
            </section>
          </div>

          <div class="main-col-right">
            <section class="main-card card-did-you-know">
              <div class="card-header">
                <h2>Czy wiesz, że…</h2>
              </div>
              <div class="card-body">
                <ul class="did-you-know-list">
                  ${didYouKnowFacts.map(fact => `<li>${fact}</li>`).join('')}
                </ul>
              </div>
            </section>

            <section class="main-card card-recent-edits">
              <div class="card-header">
                <h2>Ostatnio zmieniane</h2>
              </div>
              <div class="card-body">
                <ul class="recent-list">
                  ${recentArticles.slice(0, 6).map(art => {
                    const slug = art.slug || art.article_slug;
                    const title = art.title || slug;
                    return `
                      <li class="recent-item">
                        <a href="#/wiki/${slug}" class="recent-title">${escapeHtml(title)}</a>
                        <span class="recent-meta">${formatDate(art.updated_at || art.created_at)}</span>
                      </li>
                    `;
                  }).join('')}
                </ul>
                <div class="card-footer-link">
                  <a href="#/recent-changes">Wszystkie ostatnie zmiany &rarr;</a>
                </div>
              </div>
            </section>
          </div>
        </div>
      `;

      const mainRandomBtn = document.getElementById('main-random-btn');
      if (mainRandomBtn) {
        mainRandomBtn.addEventListener('click', async () => {
          try {
            const r = await api('/api/articles/random');
            if (r.slug) window.location.hash = `#/wiki/${r.slug}`;
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      }
    } catch (err) {
      viewRoot.innerHTML = `<div class="wiki-error">Nie udało się załadować danych strony głównej: ${escapeHtml(err.message)}</div>`;
    }
  }

  // --- WIDOK 2: Artykuł (#/wiki/:slug) ---
  async function renderArticleView(slug) {
    const viewRoot = document.getElementById('view-root');
    viewRoot.innerHTML = '<div class="wiki-loading">Ładowanie artykułu...</div>';

    try {
      const data = await api(`/api/articles/${encodeURIComponent(slug)}`);
      const art = data.article;
      if (art && art.slug && art.title) {
        state.articleTitlesBySlug[art.slug] = art.title;
      }
      updateArticleTabs(slug, 'read', data.revisionsCount, data.talkCount);

      const badgesHtml = [];
      if (art.is_locked) badgesHtml.push('<span class="status-pill badge-locked">🔒 Zabezpieczony</span>');
      if (art.is_featured) badgesHtml.push('<span class="status-pill badge-featured">⭐ Wyróżniony</span>');
      if (!art.is_published) badgesHtml.push('<span class="status-pill badge-unpublished">⚠️ Szkic (Nieopublikowany)</span>');

      const cats = parseCategories(art.categories);
      const lastEditor = art.last_editor || art.editor || '';

      viewRoot.innerHTML = `
        <article class="wiki-article">
          <header class="wiki-article-header">
            <div class="title-row">
              <h1 class="wiki-article-title">${escapeHtml(art.title)}</h1>
              <div class="wiki-badges">${badgesHtml.join(' ')}</div>
            </div>
            <div class="wiki-article-meta">
              <span>👁️ Wyświetlenia: <strong>${art.views || 0}</strong></span>
              <span>🕒 Ostatnia modyfikacja: <strong>${formatDate(art.updated_at)}</strong></span>
              ${lastEditor ? `<span>✍️ Autor ostatniej edycji: <strong>${escapeHtml(lastEditor)}</strong></span>` : ''}
            </div>
            ${art.summary ? `<p class="wiki-article-summary"><em>${escapeHtml(art.summary)}</em></p>` : ''}
          </header>

          <div class="wiki-article-body-wrapper">
            ${renderInfobox(art.infobox, art.title)}
            ${renderToc(data.toc)}
            <div class="wiki-article-body">
              ${data.renderedHtml || '<p><em>Ten artykuł jest pusty.</em></p>'}
            </div>
          </div>

          ${cats.length > 0 ? `
            <footer class="wiki-categories-bar">
              <span class="cat-label">Kategorie:</span>
              <ul class="cat-list">
                ${cats.map(cName => `<li><a href="#/categories/${encodeURIComponent(cName)}">${escapeHtml(cName)}</a></li>`).join('')}
              </ul>
            </footer>
          ` : ''}
        </article>
      `;
    } catch (err) {
      updateArticleTabs(null);
      if (err.status === 404) {
        viewRoot.innerHTML = `
          <div class="wiki-not-found">
            <h2>Strona nie została odnaleziona</h2>
            <p>Artykuł o identyfikatorze <code>${escapeHtml(slug)}</code> jeszcze nie istnieje w WikiKurekk.</p>
            ${canEditWiki() ? `
              <p>Możesz go teraz utworzyć i podzielić się wiedzą z innymi!</p>
              <a href="#/new?title=${encodeURIComponent(slug.replace(/-/g, ' '))}" class="btn btn-primary">➕ Utwórz ten artykuł</a>
            ` : `
              <a href="#/" class="btn btn-secondary">Powrót na stronę główną</a>
            `}
          </div>
        `;
      } else {
        viewRoot.innerHTML = `<div class="wiki-error">Błąd wczytywania artykułu: ${escapeHtml(err.message)}</div>`;
      }
    }
  }

  // --- WIDOK 3 i 4: Edytor Artykułu (#/wiki/:slug/edit oraz #/new) ---
  async function renderArticleEditor(slug = null, initialTitle = '') {
    const isNew = !slug;
    const viewRoot = document.getElementById('view-root');

    if (!canEditWiki()) {
      updateArticleTabs(slug || null, 'read');
      viewRoot.innerHTML = `
        <div class="admin-auth-guard">
          <h2>🔒 Edycja dostępna dla redaktorów</h2>
          <p>Tworzenie i edytowanie artykułów jest dostępne wyłącznie dla użytkowników z rolą <strong>redaktora</strong> lub <strong>administratora</strong>${String(state.settings.allow_anonymous_edits) === '1' ? ' (lub niezalogowanych, gdy edycje anonimowe są włączone)' : ''}.</p>
          ${state.currentUser
            ? '<p>Twoje konto nie posiada uprawnień do edycji haseł.</p>'
            : '<button type="button" id="editor-guard-login-btn" class="btn btn-primary">Zaloguj się</button>'}
        </div>
      `;
      document.getElementById('editor-guard-login-btn')?.addEventListener('click', () => openAuthModal('login'));
      return;
    }

    viewRoot.innerHTML = '<div class="wiki-loading">Przygotowywanie edytora...</div>';

    let currentArticle = {
      title: initialTitle,
      summary: '',
      content: '',
      infobox: null,
      categories: [],
      is_locked: 0,
      updated_at: null
    };

    if (!isNew) {
      try {
        const data = await api(`/api/articles/${encodeURIComponent(slug)}?noView=1`);
        if (!data || !data.article) {
          throw new Error('Nie znaleziono danych artykułu.');
        }
        currentArticle = data.article;
        if (currentArticle.slug && currentArticle.title) {
          state.articleTitlesBySlug[currentArticle.slug] = currentArticle.title;
        }
        updateArticleTabs(slug, 'edit', data.revisionsCount, data.talkCount);
      } catch (err) {
        showToast(err.message, 'error');
        window.location.hash = '#/';
        return;
      }
    } else {
      updateArticleTabs(null);
    }

    // Dociągnij słownik tytułów artykułów w tle dla wyszukiwarki linków (Link Picker)
    api('/api/articles?includeUnpublished=1', { suppressAuthExpiry: true })
      .then(res => {
        if (res && Array.isArray(res.articles)) {
          res.articles.forEach(a => {
            if (a && a.slug && a.title) state.articleTitlesBySlug[a.slug] = a.title;
          });
        }
      })
      .catch(() => {});

    // Normalizacja infoboxu
    const infoboxObj = normalizeInfobox(currentArticle.infobox);

    let selectedCategories = parseCategories(currentArticle.categories);
    const isLockedAndNotAdmin = Boolean(!isNew && currentArticle.is_locked && (!state.currentUser || state.currentUser.role !== 'admin'));
    const isAnonMode = !state.currentUser && String(state.settings.allow_anonymous_edits) === '1';
    const draftKey = `wikikurekk_draft_${slug || 'new'}`;
    let baseUpdatedAt = currentArticle.updated_at || null;
    let editorMode = window.innerWidth > 960 ? 'split' : 'edit';
    let scrollSyncEnabled = true;
    let previewAbortController = null;
    let previewRequestSeq = 0;
    let previewDebounceTimer = null;
    let autosaveTimer = null;
    let activePopoverType = null;

    const editSummaryPresets = [
      'Rozbudowa treści',
      'Korekta stylu i literówek',
      'Aktualizacja danych',
      'Dodanie przypisów',
      'Formatowanie i linki wewnętrzne'
    ];

    viewRoot.innerHTML = `
      <div class="editor-container">
        <header class="editor-header">
          <h1>${isNew ? '➕ Tworzenie nowego artykułu' : `✏️ Edycja: ${escapeHtml(currentArticle.title)}`}</h1>
          <p class="editor-lead">Formatuj treść w składni wikikodu (<code>== Nagłówek ==</code>, <code>'''pogrubienie'''</code>, <code>[[Link]]</code>, <code>&lt;ref&gt;źródło&lt;/ref&gt;</code>, tabele, ramki <code>:::note</code>).</p>
          ${isLockedAndNotAdmin ? `
            <div class="alert alert-warning" role="status">
              🔒 <strong>Artykuł zabezpieczony:</strong> Ten artykuł jest chroniony i może go edytować wyłącznie administrator. Pola edycji zostały zablokowane (tryb podglądu źródła).
            </div>
          ` : ''}
          ${isAnonMode ? `
            <div class="alert alert-info" role="status">
              ℹ️ <strong>Tryb edycji anonimowej:</strong> Wprowadzone zmiany zostaną zapisane jako edycja gościa (Anonim).
            </div>
          ` : ''}
        </header>

        <div id="editor-draft-banner" class="editor-draft-banner hidden" role="region" aria-label="Odzyskiwanie szkicu"></div>
        <div id="editor-conflict-banner" class="alert alert-danger hidden" role="alert"></div>

        <form id="article-editor-form" class="editor-form">
          <div class="editor-meta-grid">
            <div class="form-group">
              <label for="edit-title">Tytuł hasła:</label>
              <input type="text" id="edit-title" class="form-control" value="${escapeHtml(currentArticle.title)}" placeholder="Np. Komputer kwantowy" required ${isLockedAndNotAdmin ? 'disabled' : ''} />
              ${isNew ? '<div id="editor-slug-preview" class="editor-slug-preview"></div>' : ''}
            </div>

            <div class="form-group">
              <label for="edit-summary">Krótkie podsumowanie (zajawka):</label>
              <input type="text" id="edit-summary" class="form-control" value="${escapeHtml(currentArticle.summary || '')}" placeholder="Jednozdaniowe podsumowanie artykułu" ${isLockedAndNotAdmin ? 'disabled' : ''} />
            </div>
          </div>

          <div class="form-group">
            <label for="edit-category-input">Kategorie:</label>
            <div id="category-picker" class="category-picker">
              <div id="category-chips" class="category-chips"></div>
              <input type="text" id="edit-category-input" class="form-control category-picker-input" placeholder="Wpisz nazwę kategorii i naciśnij Enter (lub kliknij podpowiedź)" ${isLockedAndNotAdmin ? 'disabled' : ''} />
              <div id="category-suggestions" class="category-suggestions"></div>
            </div>
          </div>

          <div class="editor-mode-bar">
            <div id="editor-mode-tabs" class="editor-mode-tabs" role="tablist" aria-label="Tryb edytora">
              <button type="button" class="editor-mode-btn ${editorMode === 'edit' ? 'active' : ''}" data-mode="edit" role="tab" aria-selected="${editorMode === 'edit'}">Edycja</button>
              <button type="button" class="editor-mode-btn ${editorMode === 'split' ? 'active' : ''}" data-mode="split" role="tab" aria-selected="${editorMode === 'split'}">Podział 50/50</button>
              <button type="button" class="editor-mode-btn ${editorMode === 'preview' ? 'active' : ''}" data-mode="preview" role="tab" aria-selected="${editorMode === 'preview'}">Podgląd</button>
            </div>
            <div class="editor-mode-tools">
              <button type="button" id="editor-scroll-sync-btn" class="editor-sync-btn is-active" aria-pressed="true" title="Synchronizuj przewijanie edytora i podglądu">⇅ Sync przewijania</button>
              <span id="editor-dirty-badge" class="editor-dirty-badge is-clean">Bez zmian</span>
              <span id="editor-autosave-status" class="editor-autosave-status">Szkic lokalny gotowy</span>
            </div>
          </div>

          <!-- Pasek narzędzi formatowania i popovery -->
          <div class="editor-toolbar-wrap">
            <div class="editor-toolbar" role="toolbar" aria-label="Narzędzia formatowania wikikodu">
              <div class="toolbar-group">
                <button type="button" class="toolbar-btn" data-action="heading" title="Nagłówek sekcji (== ==)" ${isLockedAndNotAdmin ? 'disabled' : ''}><strong>H2</strong></button>
                <button type="button" class="toolbar-btn" data-action="subheading" title="Podnagłówek (=== ===)" ${isLockedAndNotAdmin ? 'disabled' : ''}><strong>H3</strong></button>
              </div>
              <span class="toolbar-sep" aria-hidden="true"></span>
              <div class="toolbar-group">
                <button type="button" class="toolbar-btn" data-action="bold" title="Pogrubienie (Ctrl+B)" ${isLockedAndNotAdmin ? 'disabled' : ''}><strong>B</strong></button>
                <button type="button" class="toolbar-btn" data-action="italic" title="Kursywa (Ctrl+I)" ${isLockedAndNotAdmin ? 'disabled' : ''}><em>I</em></button>
                <button type="button" class="toolbar-btn" data-action="bold-italic" title="Pogrubienie i kursywa (''''')" ${isLockedAndNotAdmin ? 'disabled' : ''}><strong><em>BI</em></strong></button>
                <button type="button" class="toolbar-btn" data-action="strike" title="Przekreślenie (~~ ~~)" ${isLockedAndNotAdmin ? 'disabled' : ''}><s>S</s></button>
                <button type="button" class="toolbar-btn" data-action="code" title="Kod w linii (\`kod\`)" ${isLockedAndNotAdmin ? 'disabled' : ''}><code>&lt;/&gt;</code></button>
              </div>
              <span class="toolbar-sep" aria-hidden="true"></span>
              <div class="toolbar-group">
                <button type="button" class="toolbar-btn" data-action="bullet" title="Lista punktowana (*)" ${isLockedAndNotAdmin ? 'disabled' : ''}>• Lista</button>
                <button type="button" class="toolbar-btn" data-action="ordered" title="Lista numerowana (1.)" ${isLockedAndNotAdmin ? 'disabled' : ''}>1. Lista</button>
                <button type="button" class="toolbar-btn" data-action="quote" title="Cytat blokowy (>)" ${isLockedAndNotAdmin ? 'disabled' : ''}>❝ Cytat</button>
                <button type="button" class="toolbar-btn" data-action="codeblock" title="Blok kodu (\`\`\`)" ${isLockedAndNotAdmin ? 'disabled' : ''}>&#96;&#96;&#96; Kod</button>
                <button type="button" class="toolbar-btn" data-action="hr" title="Linia pozioma (----)" ${isLockedAndNotAdmin ? 'disabled' : ''}>― Linia</button>
              </div>
              <span class="toolbar-sep" aria-hidden="true"></span>
              <div class="toolbar-group">
                <button type="button" class="toolbar-btn" data-action="link" title="Wstaw link wewnętrzny lub zewnętrzny (Ctrl+K)" ${isLockedAndNotAdmin ? 'disabled' : ''}>🔗 Link</button>
                <button type="button" class="toolbar-btn" data-action="ref" title="Wstaw przypis (<ref>)" ${isLockedAndNotAdmin ? 'disabled' : ''}>📑 Przypis</button>
                <button type="button" class="toolbar-btn" data-action="table" title="Generator tabeli wiki" ${isLockedAndNotAdmin ? 'disabled' : ''}>📊 Tabela</button>
                <button type="button" class="toolbar-btn" data-action="image" title="Wstaw ilustrację / obraz" ${isLockedAndNotAdmin ? 'disabled' : ''}>🖼️ Obraz</button>
                <button type="button" class="toolbar-btn" data-action="callout" title="Wstaw ramkę informacyjną (:::note)" ${isLockedAndNotAdmin ? 'disabled' : ''}>💡 Ramka</button>
                <button type="button" class="toolbar-btn" data-action="infobox-helper" title="Dodaj pole do infoboxu" ${isLockedAndNotAdmin ? 'disabled' : ''}>ℹ️ +Infobox</button>
              </div>
            </div>
            <div id="editor-popover-host" class="editor-popover hidden" role="dialog" aria-label="Pomocnik wstawiania"></div>
          </div>

          <!-- Obszar roboczy: Źródło + Podgląd na żywo -->
          <div id="editor-workspace" class="editor-workspace mode-${editorMode}">
            <div class="editor-pane-source">
              <textarea id="edit-content" aria-label="Treść artykułu (wikikod)" class="editor-textarea form-control" rows="18" placeholder="Wpisz treść artykułu w składni wikikodu..." ${isLockedAndNotAdmin ? 'disabled' : ''}>${escapeHtml(currentArticle.content || '')}</textarea>
              <div id="editor-status-bar" class="editor-status-bar"></div>
            </div>

            <div id="preview-wrapper" class="editor-pane-preview">
              <div class="preview-pane-header">
                <span>👁️ Podgląd na żywo</span>
                <span id="preview-meta-stats" class="preview-meta-stats"></span>
              </div>
              <div id="preview-box" class="preview-box wiki-article-body-wrapper"></div>
            </div>
          </div>

          <!-- Sekcja edytora infoboxu -->
          <fieldset class="infobox-editor-fieldset">
            <legend>ℹ️ Infobox (tabela boczna artykułu)</legend>
            <div class="editor-meta-grid">
              <div class="form-group">
                <label for="infobox-title">Tytuł infoboxu (opcjonalny):</label>
                <input type="text" id="infobox-title" class="form-control" value="${escapeHtml(infoboxObj.title || '')}" placeholder="Domyślnie tytuł artykułu" ${isLockedAndNotAdmin ? 'disabled' : ''} />
              </div>
              <div class="form-group">
                <label for="infobox-image">Adres URL obrazka (http://, https:// lub /...):</label>
                <input type="text" id="infobox-image" class="form-control" value="${escapeHtml(infoboxObj.image || '')}" placeholder="https://..." ${isLockedAndNotAdmin ? 'disabled' : ''} />
                <div id="infobox-image-error" class="form-error hidden"></div>
              </div>
            </div>
            <div class="infobox-rows-label">Wiersze klucz – wartość:</div>
            <div id="infobox-rows-container" class="infobox-editor-grid"></div>
            <button type="button" id="infobox-add-row-btn" class="btn btn-sm btn-outline" ${isLockedAndNotAdmin ? 'disabled' : ''}>+ Dodaj pole infoboxu</button>
          </fieldset>

          <div class="form-group">
            <label for="edit-comment">Opis zmian (komentarz do historii wersji):</label>
            <input type="text" id="edit-comment" class="form-control" placeholder="Np. Rozbudowa sekcji historycznej, korekta literówki" value="${isNew ? 'Utworzenie artykułu' : ''}" ${isLockedAndNotAdmin ? 'disabled' : ''} />
            <div class="edit-summary-presets" aria-label="Szybkie podpowiedzi opisu zmian">
              ${editSummaryPresets.map(preset => `
                <button type="button" class="summary-chip-btn" data-summary="${escapeHtml(preset)}" ${isLockedAndNotAdmin ? 'disabled' : ''}>${escapeHtml(preset)}</button>
              `).join('')}
            </div>
          </div>

          <div class="editor-actions">
            <button type="submit" id="editor-save-btn" class="btn btn-primary" ${isLockedAndNotAdmin ? 'disabled' : ''}>💾 ${isNew ? 'Utwórz artykuł' : 'Zapisz zmiany'}</button>
            <a href="${isNew ? '#/' : `#/wiki/${encodeURIComponent(slug)}`}" id="editor-cancel-link" class="btn btn-outline">Anuluj</a>
          </div>
        </form>
      </div>
    `;

    // Referencje DOM
    const formEl = document.getElementById('article-editor-form');
    const titleInput = document.getElementById('edit-title');
    const summaryInput = document.getElementById('edit-summary');
    const textarea = document.getElementById('edit-content');
    const commentInput = document.getElementById('edit-comment');
    const infoboxTitleInput = document.getElementById('infobox-title');
    const infoboxImageInput = document.getElementById('infobox-image');
    const infoboxImageErrorEl = document.getElementById('infobox-image-error');
    const infoboxContainer = document.getElementById('infobox-rows-container');
    const categoryInput = document.getElementById('edit-category-input');
    const categoryChipsEl = document.getElementById('category-chips');
    const categorySuggestionsEl = document.getElementById('category-suggestions');
    const workspaceEl = document.getElementById('editor-workspace');
    const previewWrapper = document.getElementById('preview-wrapper');
    const previewBox = document.getElementById('preview-box');
    const previewMetaStatsEl = document.getElementById('preview-meta-stats');
    const statusBarEl = document.getElementById('editor-status-bar');
    const dirtyBadgeEl = document.getElementById('editor-dirty-badge');
    const autosaveStatusEl = document.getElementById('editor-autosave-status');
    const draftBannerEl = document.getElementById('editor-draft-banner');
    const conflictBannerEl = document.getElementById('editor-conflict-banner');
    const popoverHost = document.getElementById('editor-popover-host');
    const slugPreviewEl = document.getElementById('editor-slug-preview');
    const scrollSyncBtn = document.getElementById('editor-scroll-sync-btn');

    // --- Pomocniki formularza (kategorie, infobox, slug, stan brudny) ---
    function updateSlugPreview() {
      if (!slugPreviewEl) return;
      const val = titleInput.value.trim();
      const s = slugifyTitle(val);
      if (!val) {
        slugPreviewEl.innerHTML = 'Adres artykułu: <code>#/wiki/...</code>';
        slugPreviewEl.classList.remove('is-invalid');
      } else if (!s) {
        slugPreviewEl.innerHTML = '<span class="editor-slug-warning">⚠️ Tytuł nie zawiera liter ani cyfr pozwalających utworzyć adres URL (slug).</span>';
        slugPreviewEl.classList.add('is-invalid');
      } else {
        const exists = (state.allSlugs || []).includes(s);
        slugPreviewEl.innerHTML = `Adres artykułu: <code>#/wiki/${escapeHtml(s)}</code>${exists ? ' <span class="editor-slug-warning">(taki artykuł już istnieje)</span>' : ''}`;
        slugPreviewEl.classList.toggle('is-invalid', exists);
      }
    }

    function renderCategoryPicker() {
      categoryChipsEl.innerHTML = selectedCategories.map((cat, idx) => `
        <span class="category-chip-tag">
          <span>${escapeHtml(cat)}</span>
          ${isLockedAndNotAdmin ? '' : `<button type="button" class="category-chip-remove" data-index="${idx}" aria-label="Usuń kategorię ${escapeHtml(cat)}">&times;</button>`}
        </span>
      `).join('');

      categoryChipsEl.querySelectorAll('.category-chip-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.index);
          selectedCategories.splice(idx, 1);
          renderCategoryPicker();
          onEditorDataChanged();
        });
      });

      const filterText = categoryInput.value.trim().toLocaleLowerCase('pl');
      const selectedLower = new Set(selectedCategories.map(c => c.toLocaleLowerCase('pl')));
      const suggestions = (state.categories || [])
        .map(c => getCatName(c))
        .filter(name => name && !selectedLower.has(name.toLocaleLowerCase('pl')))
        .filter(name => !filterText || name.toLocaleLowerCase('pl').includes(filterText))
        .slice(0, 10);

      if (suggestions.length === 0 || isLockedAndNotAdmin) {
        categorySuggestionsEl.innerHTML = '';
        categorySuggestionsEl.classList.add('hidden');
      } else {
        categorySuggestionsEl.classList.remove('hidden');
        categorySuggestionsEl.innerHTML = `
          <span class="category-suggestions-label">Podpowiedzi:</span>
          ${suggestions.map(name => `
            <button type="button" class="category-suggestion-btn" data-cat="${escapeHtml(name)}">+ ${escapeHtml(name)}</button>
          `).join('')}
        `;
        categorySuggestionsEl.querySelectorAll('.category-suggestion-btn').forEach(btn => {
          btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
          });
          btn.addEventListener('click', () => {
            addCategoryChip(btn.dataset.cat);
          });
        });
      }
    }

    function addCategoryChip(rawName) {
      const clean = String(rawName || '').trim();
      if (!clean) return;
      const exists = selectedCategories.some(c => c.toLocaleLowerCase('pl') === clean.toLocaleLowerCase('pl'));
      if (!exists) {
        selectedCategories.push(clean);
      }
      categoryInput.value = '';
      renderCategoryPicker();
      onEditorDataChanged();
    }

    categoryInput.addEventListener('input', () => renderCategoryPicker());
    categoryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const raw = categoryInput.value.replace(/,/g, '').trim();
        if (raw) addCategoryChip(raw);
      } else if (e.key === 'Backspace' && !categoryInput.value && selectedCategories.length > 0) {
        selectedCategories.pop();
        renderCategoryPicker();
        onEditorDataChanged();
      }
    });
    categoryInput.addEventListener('blur', () => {
      const raw = categoryInput.value.replace(/,/g, '').trim();
      if (raw) addCategoryChip(raw);
    });

    function getEffectiveCategories() {
      const pending = categoryInput.value.replace(/,/g, '').trim();
      if (!pending) return [...selectedCategories];
      const exists = selectedCategories.some(c => c.toLocaleLowerCase('pl') === pending.toLocaleLowerCase('pl'));
      return exists ? [...selectedCategories] : [...selectedCategories, pending];
    }

    // --- Wiersze infoboxu z przesuwaniem i walidacją ---
    function refreshInfoboxRowButtons() {
      const rows = Array.from(infoboxContainer.querySelectorAll('.infobox-row-item'));
      rows.forEach((row, idx) => {
        const upBtn = row.querySelector('.info-up');
        const downBtn = row.querySelector('.info-down');
        if (upBtn) upBtn.disabled = isLockedAndNotAdmin || idx === 0;
        if (downBtn) downBtn.disabled = isLockedAndNotAdmin || idx === rows.length - 1;
      });
    }

    function addInfoboxRow(key = '', val = '', focusKey = false) {
      const row = document.createElement('div');
      row.className = 'infobox-row-item';
      row.innerHTML = `
        <input type="text" class="form-control info-key" placeholder="Etykieta (np. Stolica)" value="${escapeHtml(key)}" ${isLockedAndNotAdmin ? 'disabled' : ''} />
        <input type="text" class="form-control info-val" placeholder="Wartość (np. Warszawa)" value="${escapeHtml(val)}" ${isLockedAndNotAdmin ? 'disabled' : ''} />
        <div class="infobox-row-actions">
          <button type="button" class="btn btn-outline btn-sm info-up" title="Przesuń w górę" aria-label="Przesuń wiersz w górę">&uarr;</button>
          <button type="button" class="btn btn-outline btn-sm info-down" title="Przesuń w dół" aria-label="Przesuń wiersz w dół">&darr;</button>
          <button type="button" class="btn btn-danger btn-sm info-del" title="Usuń wiersz" aria-label="Usuń wiersz" ${isLockedAndNotAdmin ? 'disabled' : ''}>&times;</button>
        </div>
      `;

      row.querySelector('.info-key').addEventListener('input', onEditorDataChanged);
      row.querySelector('.info-val').addEventListener('input', onEditorDataChanged);
      row.querySelector('.info-up').addEventListener('click', () => {
        const prev = row.previousElementSibling;
        if (prev) {
          infoboxContainer.insertBefore(row, prev);
          refreshInfoboxRowButtons();
          onEditorDataChanged();
        }
      });
      row.querySelector('.info-down').addEventListener('click', () => {
        const next = row.nextElementSibling;
        if (next) {
          infoboxContainer.insertBefore(next, row);
          refreshInfoboxRowButtons();
          onEditorDataChanged();
        }
      });
      row.querySelector('.info-del').addEventListener('click', () => {
        row.remove();
        refreshInfoboxRowButtons();
        onEditorDataChanged();
      });

      infoboxContainer.appendChild(row);
      refreshInfoboxRowButtons();
      if (focusKey) {
        row.querySelector('.info-key')?.focus();
      }
    }

    const existingEntries = Object.entries(infoboxObj.items || {});
    if (existingEntries.length > 0) {
      existingEntries.forEach(([k, v]) => addInfoboxRow(k, v));
    } else {
      addInfoboxRow('', '');
    }

    document.getElementById('infobox-add-row-btn').addEventListener('click', () => {
      addInfoboxRow('', '', true);
    });

    function validateInfoboxImageField() {
      const raw = infoboxImageInput.value.trim();
      if (!raw || isSafeUrl(raw)) {
        infoboxImageErrorEl.textContent = '';
        infoboxImageErrorEl.classList.add('hidden');
        return true;
      }
      infoboxImageErrorEl.textContent = 'Dozwolone są wyłącznie adresy http://, https:// lub ścieżki względne zaczynające się od /.';
      infoboxImageErrorEl.classList.remove('hidden');
      return false;
    }

    function collectInfoboxData({ strict = false } = {}) {
      const title = infoboxTitleInput.value.trim();
      const imageRaw = infoboxImageInput.value.trim();

      if (imageRaw && !isSafeUrl(imageRaw)) {
        if (strict) {
          showToast('Nieprawidłowy adres URL obrazka infoboxu. Użyj http://, https:// lub /.', 'warning');
          infoboxImageInput.focus();
          return { error: true };
        }
      }

      const image = imageRaw && isSafeUrl(imageRaw) ? imageRaw : '';
      const collectedItems = {};
      const rows = infoboxContainer.querySelectorAll('.infobox-row-item');

      for (const row of rows) {
        const keyInput = row.querySelector('.info-key');
        const valInput = row.querySelector('.info-val');
        const k = keyInput.value.trim();
        const v = valInput.value.trim();

        if ((k && !v) || (!k && v)) {
          if (strict) {
            showToast('Uzupełnij zarówno etykietę, jak i wartość wiersza infoboxu (lub usuń pusty wiersz).', 'warning');
            (k ? valInput : keyInput).focus();
            return { error: true };
          }
          continue;
        }
        if (k && v) {
          collectedItems[k] = v;
        }
      }

      if (!image && Object.keys(collectedItems).length === 0) {
        return null;
      }

      return {
        title: title || titleInput.value.trim(),
        image: image || undefined,
        items: collectedItems
      };
    }

    function getSnapshot() {
      return {
        title: titleInput.value,
        summary: summaryInput.value,
        content: textarea.value,
        categories: getEffectiveCategories(),
        infobox: collectInfoboxData()
      };
    }

    const initialSnapshotJson = JSON.stringify(getSnapshot());

    function isEditorDirty() {
      if (isLockedAndNotAdmin) return false;
      return JSON.stringify(getSnapshot()) !== initialSnapshotJson;
    }

    function updateDirtyBadge() {
      const dirty = isEditorDirty();
      if (dirtyBadgeEl) {
        dirtyBadgeEl.textContent = dirty ? '● Niezapisane zmiany' : 'Bez zmian';
        dirtyBadgeEl.classList.toggle('is-dirty', dirty);
        dirtyBadgeEl.classList.toggle('is-clean', !dirty);
      }
    }

    // --- Pasek statusu edytora ---
    function updateEditorStatusBar() {
      if (!statusBarEl) return;
      const val = textarea.value;
      const trimmed = val.trim();
      const words = trimmed ? trimmed.split(/\s+/).length : 0;
      const chars = val.length;
      const readMin = words === 0 ? '0 min' : `~${Math.max(1, Math.ceil(words / 200))} min`;

      const pos = textarea.selectionStart || 0;
      const upToCursor = val.slice(0, pos);
      const line = upToCursor.split('\n').length;
      const col = pos - upToCursor.lastIndexOf('\n');

      statusBarEl.innerHTML = `
        <span>Słowa: <strong>${words}</strong></span>
        <span class="status-sep">&middot;</span>
        <span>Znaki: <strong>${chars}</strong></span>
        <span class="status-sep">&middot;</span>
        <span>Czas czytania: <strong>${readMin}</strong></span>
        <span class="status-sep">&middot;</span>
        <span>Wiersz <strong>${line}</strong>, kol. <strong>${col}</strong></span>
      `;
    }

    // --- Podgląd na żywo i tryby edytora ---
    function setEditorMode(mode) {
      if (!['edit', 'split', 'preview'].includes(mode)) return;
      editorMode = mode;
      workspaceEl.classList.remove('mode-edit', 'mode-split', 'mode-preview');
      workspaceEl.classList.add(`mode-${mode}`);

      document.querySelectorAll('#editor-mode-tabs .editor-mode-btn').forEach(btn => {
        const active = btn.dataset.mode === mode;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });

      if (scrollSyncBtn) {
        scrollSyncBtn.classList.toggle('hidden', mode !== 'split');
      }

      if (mode === 'split' || mode === 'preview') {
        scheduleLivePreview(true);
      }
    }

    document.querySelectorAll('#editor-mode-tabs .editor-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => setEditorMode(btn.dataset.mode));
    });

    if (scrollSyncBtn) {
      scrollSyncBtn.classList.toggle('hidden', editorMode !== 'split');
      scrollSyncBtn.addEventListener('click', () => {
        scrollSyncEnabled = !scrollSyncEnabled;
        scrollSyncBtn.classList.toggle('is-active', scrollSyncEnabled);
        scrollSyncBtn.setAttribute('aria-pressed', scrollSyncEnabled ? 'true' : 'false');
      });
    }

    async function runLivePreview() {
      if (editorMode === 'edit') return;

      const seq = ++previewRequestSeq;
      if (previewAbortController) previewAbortController.abort();
      previewAbortController = new AbortController();

      const title = titleInput.value.trim();
      const summary = summaryInput.value.trim();
      const content = textarea.value;
      const categories = getEffectiveCategories();
      const infobox = collectInfoboxData();

      try {
        const res = await api('/api/preview', {
          method: 'POST',
          body: { title, summary, content, infobox, categories },
          signal: previewAbortController.signal,
          suppressAuthExpiry: true
        });
        if (seq !== previewRequestSeq || !document.contains(previewBox)) return;

        const safeInfobox = res.infobox !== undefined ? res.infobox : infobox;
        const bodyHtml = res.renderedHtml && res.renderedHtml.trim()
          ? res.renderedHtml
          : '<p class="preview-empty-hint"><em>Zacznij pisać treść artykułu, aby zobaczyć podgląd na żywo...</em></p>';

        previewBox.innerHTML = `
          <header class="wiki-article-header preview-article-header">
            <h1 class="wiki-article-title">${escapeHtml(title || 'Bez tytułu')}</h1>
            ${summary ? `<p class="wiki-article-summary"><em>${escapeHtml(summary)}</em></p>` : ''}
          </header>
          <div class="wiki-article-body-wrapper">
            ${renderInfobox(safeInfobox, title)}
            ${renderToc(res.toc)}
            <div class="wiki-article-body">${bodyHtml}</div>
          </div>
          ${categories.length > 0 ? `
            <footer class="wiki-categories-bar">
              <span class="cat-label">Kategorie:</span>
              <ul class="cat-list">
                ${categories.map(c => `<li><a href="#/categories/${encodeURIComponent(c)}">${escapeHtml(c)}</a></li>`).join('')}
              </ul>
            </footer>
          ` : ''}
        `;

        if (previewMetaStatsEl) {
          if (typeof res.wordCount === 'number') {
            previewMetaStatsEl.textContent = `${res.wordCount} słów · ~${res.readingTimeMinutes || 1} min`;
          } else {
            previewMetaStatsEl.textContent = '';
          }
        }
      } catch (err) {
        if (err.name === 'AbortError' || !document.contains(previewBox)) return;
        previewBox.innerHTML = `<div class="wiki-error">Błąd podglądu: ${escapeHtml(err.message)}</div>`;
      }
    }

    function scheduleLivePreview(immediate = false) {
      if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
      if (editorMode === 'edit') return;
      if (immediate) {
        runLivePreview();
      } else {
        previewDebounceTimer = setTimeout(runLivePreview, 250);
      }
    }

    // Proporcjonalna synchronizacja przewijania w trybie podziału
    let isSyncingScroll = false;
    function getScrollablePreviewTarget() {
      if (previewBox.scrollHeight > previewBox.clientHeight + 4) return previewBox;
      if (previewWrapper.scrollHeight > previewWrapper.clientHeight + 4) return previewWrapper;
      return previewBox;
    }

    function syncScroll(fromEl, toEl) {
      if (!scrollSyncEnabled || editorMode !== 'split' || isSyncingScroll) return;
      const maxFrom = fromEl.scrollHeight - fromEl.clientHeight;
      const maxTo = toEl.scrollHeight - toEl.clientHeight;
      if (maxFrom <= 0 || maxTo <= 0) return;
      isSyncingScroll = true;
      const ratio = fromEl.scrollTop / maxFrom;
      toEl.scrollTop = ratio * maxTo;
      requestAnimationFrame(() => {
        isSyncingScroll = false;
      });
    }

    textarea.addEventListener('scroll', () => {
      syncScroll(textarea, getScrollablePreviewTarget());
    });
    previewBox.addEventListener('scroll', () => {
      if (getScrollablePreviewTarget() === previewBox) syncScroll(previewBox, textarea);
    });
    previewWrapper.addEventListener('scroll', () => {
      if (getScrollablePreviewTarget() === previewWrapper) syncScroll(previewWrapper, textarea);
    });

    // Przechwytywanie kliknięć wewnątrz podglądu, aby nie stracić edycji
    previewBox.addEventListener('click', (e) => {
      const tocToggle = e.target.closest('.wiki-toc-toggle');
      if (tocToggle) {
        e.preventDefault();
        e.stopPropagation();
        const tocNav = tocToggle.closest('.wiki-toc');
        const list = tocNav?.querySelector('.toc-list');
        if (tocNav && list) {
          const collapsed = list.classList.toggle('hidden');
          tocNav.classList.toggle('is-collapsed', collapsed);
          tocToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
          tocToggle.textContent = collapsed ? 'Pokaż' : 'Ukryj';
        }
        return;
      }

      const anchorLink = e.target.closest('a[href^="#sekcja-"], a[href^="#ref-"], a[href^="#cite_"]');
      if (anchorLink) {
        e.preventDefault();
        e.stopPropagation();
        const targetId = anchorLink.getAttribute('href').slice(1);
        const el = previewBox.querySelector(`[id="${targetId.replace(/"/g, '\\"')}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }

      const link = e.target.closest('a');
      if (!link) return;
      if (link.classList.contains('wiki-link-external')) {
        return; // target="_blank" otwiera w nowej karcie
      }

      e.preventDefault();
      e.stopPropagation();
      if (link.classList.contains('wiki-link-red') || link.hasAttribute('data-missing-title')) {
        const missingTitle = link.dataset.missingTitle || link.textContent.trim();
        showToast(`Podgląd: brakujący artykuł „${missingTitle}” (nawigacja wyłączona w edytorze).`, 'info');
      } else {
        const targetText = link.textContent.trim();
        showToast(`Podgląd: link do „${targetText}” (zapisz zmiany przed przejściem).`, 'info');
      }
    });

    // --- Autozapis i przywracanie szkicu z localStorage ---
    function saveLocalDraft() {
      if (isLockedAndNotAdmin) return;
      if (!isEditorDirty()) return;
      try {
        const payload = {
          title: titleInput.value,
          summary: summaryInput.value,
          content: textarea.value,
          categories: getEffectiveCategories(),
          infobox: collectInfoboxData(),
          edit_comment: commentInput.value,
          savedAt: new Date().toISOString()
        };
        localStorage.setItem(draftKey, JSON.stringify(payload));
        if (autosaveStatusEl) {
          const t = new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          autosaveStatusEl.textContent = `Szkic zapisany lokalnie (${t})`;
        }
      } catch (_) {}
    }

    function clearLocalDraft() {
      try {
        localStorage.removeItem(draftKey);
      } catch (_) {}
    }

    function checkExistingDraft() {
      if (isLockedAndNotAdmin) return;
      try {
        const raw = localStorage.getItem(draftKey);
        if (!raw) return;
        const draft = JSON.parse(raw);
        if (!draft || typeof draft !== 'object') return;
        const draftSnap = JSON.stringify({
          title: draft.title || '',
          summary: draft.summary || '',
          content: draft.content || '',
          categories: Array.isArray(draft.categories) ? draft.categories : [],
          infobox: draft.infobox || null
        });
        if (draftSnap === initialSnapshotJson) return;
        if (!String(draft.title || '').trim() && !String(draft.content || '').trim()) return;

        const savedAtText = formatDate(draft.savedAt);
        draftBannerEl.classList.remove('hidden');
        draftBannerEl.innerHTML = `
          <div class="draft-banner-text">
            📝 <strong>Znaleziono zapisany szkic lokalny</strong>${savedAtText ? ` (${escapeHtml(savedAtText)})` : ''}. Czy chcesz go przywrócić?
          </div>
          <div class="editor-draft-actions">
            <button type="button" id="restore-draft-btn" class="btn btn-sm btn-primary">Przywróć szkic</button>
            <button type="button" id="discard-draft-btn" class="btn btn-sm btn-outline">Odrzuć</button>
          </div>
        `;

        document.getElementById('restore-draft-btn')?.addEventListener('click', () => {
          titleInput.value = draft.title || '';
          summaryInput.value = draft.summary || '';
          textarea.value = draft.content || '';
          if (draft.edit_comment !== undefined) commentInput.value = draft.edit_comment || '';
          selectedCategories = parseCategories(draft.categories);
          categoryInput.value = '';
          renderCategoryPicker();

          // Przywrócenie infoboxu
          infoboxContainer.innerHTML = '';
          const restoredInfobox = normalizeInfobox(draft.infobox);
          infoboxTitleInput.value = restoredInfobox.title;
          infoboxImageInput.value = restoredInfobox.image;
          const entries = Object.entries(restoredInfobox.items);
          if (entries.length > 0) {
            entries.forEach(([k, v]) => addInfoboxRow(k, v));
          } else {
            addInfoboxRow('', '');
          }

          draftBannerEl.classList.add('hidden');
          updateSlugPreview();
          validateInfoboxImageField();
          updateEditorStatusBar();
          updateToolbarActiveStates();
          updateDirtyBadge();
          scheduleLivePreview(true);
          showToast('Przywrócono lokalny szkic artykułu.', 'success');
        });

        document.getElementById('discard-draft-btn')?.addEventListener('click', () => {
          clearLocalDraft();
          draftBannerEl.classList.add('hidden');
          showToast('Odrzucono zapisany szkic.', 'info');
        });
      } catch (_) {}
    }

    function onEditorDataChanged() {
      updateSlugPreview();
      validateInfoboxImageField();
      updateDirtyBadge();
      updateEditorStatusBar();
      updateToolbarActiveStates();
      scheduleLivePreview(false);

      if (autosaveTimer) clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(saveLocalDraft, 800);
    }

    // --- Silnik zaznaczania i wstawiania z zachowaniem natywnego Ctrl+Z oraz scrollTop ---
    function replaceTextareaRange(start, end, replacement, selectStartOffset = null, selectEndOffset = null) {
      if (isLockedAndNotAdmin) return;
      const prevScrollTop = textarea.scrollTop;
      const prevScrollLeft = textarea.scrollLeft;

      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(start, end);

      let execOk = false;
      try {
        execOk = document.execCommand('insertText', false, replacement);
      } catch {
        execOk = false;
      }

      if (!execOk) {
        textarea.setRangeText(replacement, start, end, 'end');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }

      const offStart = selectStartOffset !== null ? selectStartOffset : replacement.length;
      const offEnd = selectEndOffset !== null ? selectEndOffset : offStart;
      textarea.setSelectionRange(start + offStart, start + offEnd);
      textarea.scrollTop = prevScrollTop;
      textarea.scrollLeft = prevScrollLeft;

      onEditorDataChanged();
    }

    function countCharRunBackward(str, pos, ch) {
      let count = 0;
      for (let i = pos - 1; i >= 0 && str[i] === ch; i--) count++;
      return count;
    }

    function countCharRunForward(str, pos, ch) {
      let count = 0;
      for (let i = pos; i < str.length && str[i] === ch; i++) count++;
      return count;
    }

    function isWrappedByApostrophes(val, start, end, len) {
      const leftCount = countCharRunBackward(val, start, "'");
      const rightCount = countCharRunForward(val, end, "'");
      if (len === 2) {
        return (leftCount === 2 && rightCount === 2) || (leftCount >= 5 && rightCount >= 5);
      }
      if (len === 3) {
        return (leftCount === 3 && rightCount === 3) || (leftCount >= 5 && rightCount >= 5);
      }
      if (len === 5) {
        return leftCount >= 5 && rightCount >= 5;
      }
      return false;
    }

    function toggleInlineWrap(markerStart, markerEnd, placeholder) {
      const val = textarea.value;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const sel = val.slice(start, end);
      const lenS = markerStart.length;
      const lenE = markerEnd.length;

      // 1. Zaznaczenie samo zawiera znaczniki (np. '''tekst''')
      if (sel.length >= lenS + lenE && sel.startsWith(markerStart) && sel.endsWith(markerEnd)) {
        const inner = sel.slice(lenS, sel.length - lenE);
        replaceTextareaRange(start, end, inner, 0, inner.length);
        return;
      }

      // 2. Zaznaczenie otoczone przez znaczniki bezpośrednio na zewnątrz
      const isApostropheMarker = markerStart === "''" || markerStart === "'''" || markerStart === "'''''";
      const wrappedOutside = isApostropheMarker
        ? isWrappedByApostrophes(val, start, end, lenS)
        : (val.slice(start - lenS, start) === markerStart && val.slice(end, end + lenE) === markerEnd);

      if (wrappedOutside) {
        replaceTextareaRange(start - lenS, end + lenE, sel, 0, sel.length);
        return;
      }

      // 3. Brak zaznaczenia lub nowe owinięcie
      if (start !== end) {
        const replacement = markerStart + sel + markerEnd;
        replaceTextareaRange(start, end, replacement, lenS, lenS + sel.length);
      } else {
        const replacement = markerStart + placeholder + markerEnd;
        replaceTextareaRange(start, end, replacement, lenS, lenS + placeholder.length);
      }
    }

    function getSelectedLineBounds() {
      const val = textarea.value;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const lineStart = val.lastIndexOf('\n', start - 1) + 1;
      const effectiveEnd = (end > start && val[end - 1] === '\n') ? end - 1 : end;
      const nextNl = val.indexOf('\n', effectiveEnd);
      const lineEnd = nextNl === -1 ? val.length : nextNl;
      return { lineStart, lineEnd, blockText: val.slice(lineStart, lineEnd) };
    }

    function toggleHeading(level) {
      const eq = level === 3 ? '===' : '==';
      const defaultTitle = level === 3 ? 'Podsekcja' : 'Nagłówek sekcji';
      const { lineStart, lineEnd, blockText } = getSelectedLineBounds();
      const firstLine = blockText.split('\n')[0];
      const match = firstLine.match(/^(={2,6})\s*(.*?)\s*\1$/);

      if (match) {
        const currentEq = match[1];
        const cleanTitle = match[2].trim();
        if (currentEq === eq) {
          // Przełącz wyłączenie nagłówka
          replaceTextareaRange(lineStart, lineStart + firstLine.length, cleanTitle, 0, cleanTitle.length);
        } else {
          // Zmień poziom nagłówka
          const nextText = `${eq} ${cleanTitle} ${eq}`;
          replaceTextareaRange(lineStart, lineStart + firstLine.length, nextText, eq.length + 1, eq.length + 1 + cleanTitle.length);
        }
        return;
      }

      const trimmed = firstLine.trim();
      if (!trimmed) {
        const nextText = `${eq} ${defaultTitle} ${eq}`;
        replaceTextareaRange(lineStart, lineStart + firstLine.length, nextText, eq.length + 1, eq.length + 1 + defaultTitle.length);
      } else {
        const nextText = `${eq} ${trimmed} ${eq}`;
        replaceTextareaRange(lineStart, lineStart + firstLine.length, nextText, eq.length + 1, eq.length + 1 + trimmed.length);
      }
    }

    function toggleLinePrefix(mode) {
      const { lineStart, lineEnd, blockText } = getSelectedLineBounds();
      const lines = blockText.split('\n');
      const nonEmptyLines = lines.filter(l => l.trim().length > 0);

      if (nonEmptyLines.length === 0) {
        if (mode === 'bullet') {
          replaceTextareaRange(lineStart, lineEnd, '* Element listy', 2, 15);
        } else if (mode === 'ordered') {
          replaceTextareaRange(lineStart, lineEnd, '1. Element listy', 3, 16);
        } else if (mode === 'quote') {
          replaceTextareaRange(lineStart, lineEnd, '> Cytat', 2, 7);
        }
        return;
      }

      const testRegex = mode === 'bullet'
        ? /^\*\s+/
        : mode === 'ordered'
          ? /^\d+\.\s+/
          : /^>\s?/;

      const allHavePrefix = nonEmptyLines.every(l => testRegex.test(l.trimStart()));
      let counter = 1;
      const transformed = lines.map(line => {
        if (!line.trim()) return line;
        if (allHavePrefix) {
          return line.replace(/^(\s*)(?:\*\s+|\d+\.\s+|>\s?)/, '$1');
        }
        const stripped = line.replace(/^(\s*)(?:[\*\-]\s+|\d+\.\s+|>\s?)/, '$1');
        const indent = stripped.match(/^\s*/)[0];
        const body = stripped.slice(indent.length);
        if (mode === 'bullet') return `${indent}* ${body}`;
        if (mode === 'ordered') return `${indent}${counter++}. ${body}`;
        return `${indent}> ${body}`;
      });

      const nextBlock = transformed.join('\n');
      replaceTextareaRange(lineStart, lineEnd, nextBlock, 0, nextBlock.length);
    }

    function insertCodeBlock() {
      const { lineStart, lineEnd, blockText } = getSelectedLineBounds();
      const trimmed = blockText.trim();
      if (!trimmed) {
        const snippet = '```\nkod\n```';
        replaceTextareaRange(lineStart, lineEnd, snippet, 4, 7);
      } else if (/^```[\s\S]*```$/.test(trimmed)) {
        const unwrapped = trimmed.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '');
        replaceTextareaRange(lineStart, lineEnd, unwrapped, 0, unwrapped.length);
      } else {
        const wrapped = '```\n' + blockText + '\n```';
        replaceTextareaRange(lineStart, lineEnd, wrapped, 4, 4 + blockText.length);
      }
    }

    function insertHorizontalRule() {
      const { lineStart, lineEnd, blockText } = getSelectedLineBounds();
      const val = textarea.value;
      if (!blockText.trim()) {
        const suffix = lineEnd === val.length ? '\n' : '';
        replaceTextareaRange(lineStart, lineEnd, '----' + suffix, 4 + suffix.length, 4 + suffix.length);
      } else {
        const insertStr = '\n\n----\n';
        replaceTextareaRange(lineEnd, lineEnd, insertStr, insertStr.length, insertStr.length);
      }
    }

    function indentSelectedLines(outdent = false) {
      const val = textarea.value;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      if (!outdent && start === end) {
        const lineStart = val.lastIndexOf('\n', start - 1) + 1;
        const lineEndRaw = val.indexOf('\n', start);
        const lineEnd = lineEndRaw === -1 ? val.length : lineEndRaw;
        const currentLine = val.slice(lineStart, lineEnd);
        if (!/^(\s*[\*\-]|\s*\d+\.|\s*>)/.test(currentLine)) {
          replaceTextareaRange(start, end, '  ', 2, 2);
          return;
        }
      }

      const { lineStart, lineEnd, blockText } = getSelectedLineBounds();
      const lines = blockText.split('\n');
      const transformed = lines.map(line => {
        if (outdent) {
          if (line.startsWith('  ')) return line.slice(2);
          if (line.startsWith('\t') || line.startsWith(' ')) return line.slice(1);
          return line;
        }
        return line.length > 0 ? '  ' + line : line;
      });
      const nextBlock = transformed.join('\n');
      replaceTextareaRange(lineStart, lineEnd, nextBlock, 0, nextBlock.length);
    }

    function updateToolbarActiveStates() {
      const val = textarea.value;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const { blockText } = getSelectedLineBounds();
      const line = blockText.split('\n')[0].trim();

      const activeMap = {
        heading: /^==[^=]/.test(line) && /[^=]==$/.test(line),
        subheading: /^===[^=]/.test(line) && /[^=]===$/.test(line),
        bold: isWrappedByApostrophes(val, start, end, 3),
        italic: isWrappedByApostrophes(val, start, end, 2),
        'bold-italic': isWrappedByApostrophes(val, start, end, 5),
        strike: val.slice(start - 2, start) === '~~' && val.slice(end, end + 2) === '~~',
        code: val.slice(start - 1, start) === '`' && val.slice(end, end + 1) === '`',
        bullet: /^\*\s+/.test(line),
        ordered: /^\d+\.\s+/.test(line),
        quote: /^>\s?/.test(line)
      };

      document.querySelectorAll('.editor-toolbar .toolbar-btn').forEach(btn => {
        const action = btn.dataset.action;
        btn.classList.toggle('is-active', Boolean(activeMap[action]));
      });
    }

    // --- Interaktywne popovery narzędzi (.editor-popover) ---
    function closePopover(restoreFocus = false) {
      if (!popoverHost) return;
      activePopoverType = null;
      popoverHost.classList.add('hidden');
      popoverHost.innerHTML = '';
      if (restoreFocus) textarea.focus({ preventScroll: true });
    }

    function insertBlockOnLineBoundary(snippet) {
      const val = textarea.value;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = val.slice(0, start);
      const after = val.slice(end);
      const needLeadingNl = before.length > 0 && !before.endsWith('\n\n')
        ? (before.endsWith('\n') ? '\n' : '\n\n')
        : '';
      const needTrailingNl = after.length > 0 && !after.startsWith('\n\n')
        ? (after.startsWith('\n') ? '\n' : '\n\n')
        : '';
      const full = needLeadingNl + snippet + needTrailingNl;
      replaceTextareaRange(start, end, full, full.length, full.length);
    }

    function openPopover(type) {
      if (isLockedAndNotAdmin) return;
      if (activePopoverType === type && !popoverHost.classList.contains('hidden')) {
        closePopover(true);
        return;
      }

      const selStart = textarea.selectionStart;
      const selEnd = textarea.selectionEnd;
      const selectedText = textarea.value.slice(selStart, selEnd).trim();
      activePopoverType = type;
      popoverHost.classList.remove('hidden');

      if (type === 'link') {
        let linkMode = 'internal';
        popoverHost.innerHTML = `
          <div class="editor-popover-header">
            <strong>🔗 Wstaw link</strong>
            <button type="button" class="modal-close popover-close-btn" aria-label="Zamknij">&times;</button>
          </div>
          <div class="editor-popover-tabs" role="tablist">
            <button type="button" class="editor-popover-tab active" data-link-tab="internal">Artykuł wiki [[...]]</button>
            <button type="button" class="editor-popover-tab" data-link-tab="external">Link zewnętrzny [https://...]</button>
          </div>
          <div class="editor-popover-body">
            <div id="popover-link-internal">
              <div class="form-group">
                <label for="popover-link-target">Cel (artykuł lub nazwa nowego hasła):</label>
                <input type="text" id="popover-link-target" class="form-control" placeholder="Wyszukaj lub wpisz nazwę artykułu..." autocomplete="off" />
              </div>
              <div id="popover-link-list" class="link-picker-list"></div>
              <div class="form-group">
                <label for="popover-link-label">Wyświetlana etykieta (opcjonalnie):</label>
                <input type="text" id="popover-link-label" class="form-control" value="${escapeHtml(selectedText)}" placeholder="Domyślnie nazwa celu" />
              </div>
            </div>
            <div id="popover-link-external" class="hidden">
              <div class="form-group">
                <label for="popover-ext-url">Adres URL (http:// lub https://):</label>
                <input type="url" id="popover-ext-url" class="form-control" placeholder="https://example.com" />
              </div>
              <div class="form-group">
                <label for="popover-ext-label">Tekst linku (opcjonalnie):</label>
                <input type="text" id="popover-ext-label" class="form-control" value="${escapeHtml(selectedText)}" placeholder="Opis odnośnika" />
              </div>
              <div id="popover-ext-error" class="form-error hidden"></div>
            </div>
          </div>
          <div class="editor-popover-footer">
            <button type="button" class="btn btn-sm btn-outline popover-cancel-btn">Anuluj</button>
            <button type="button" id="popover-link-insert" class="btn btn-sm btn-primary">Wstaw link</button>
          </div>
        `;

        const targetInput = document.getElementById('popover-link-target');
        const labelInput = document.getElementById('popover-link-label');
        const listEl = document.getElementById('popover-link-list');
        const extUrlInput = document.getElementById('popover-ext-url');
        const extLabelInput = document.getElementById('popover-ext-label');
        const extErrEl = document.getElementById('popover-ext-error');

        function renderSlugList() {
          const q = targetInput.value.trim().toLocaleLowerCase('pl');
          const matches = (state.allSlugs || [])
            .map(s => ({ slug: s, title: state.articleTitlesBySlug[s] || s }))
            .filter(item => !q || item.slug.includes(q) || item.title.toLocaleLowerCase('pl').includes(q))
            .slice(0, 12);

          if (matches.length === 0) {
            listEl.innerHTML = '<div class="link-picker-empty">Brak dopasowanych haseł — wstawienie utworzy czerwony link do nowego artykułu.</div>';
            return;
          }
          listEl.innerHTML = matches.map(item => `
            <button type="button" class="link-picker-item" data-title="${escapeHtml(item.title)}" data-slug="${escapeHtml(item.slug)}">
              <span class="link-picker-title">${escapeHtml(item.title)}</span>
              <span class="link-picker-slug">${escapeHtml(item.slug)}</span>
            </button>
          `).join('');

          listEl.querySelectorAll('.link-picker-item').forEach(btn => {
            btn.addEventListener('click', () => {
              targetInput.value = btn.dataset.title;
              if (!labelInput.value.trim() && selectedText) {
                labelInput.value = selectedText;
              }
              targetInput.focus();
            });
          });
        }

        targetInput.addEventListener('input', renderSlugList);
        renderSlugList();

        popoverHost.querySelectorAll('.editor-popover-tab').forEach(tab => {
          tab.addEventListener('click', () => {
            linkMode = tab.dataset.linkTab;
            popoverHost.querySelectorAll('.editor-popover-tab').forEach(t => t.classList.toggle('active', t === tab));
            document.getElementById('popover-link-internal').classList.toggle('hidden', linkMode !== 'internal');
            document.getElementById('popover-link-external').classList.toggle('hidden', linkMode !== 'external');
            if (linkMode === 'internal') targetInput.focus();
            else extUrlInput.focus();
          });
        });

        const submitLink = () => {
          if (linkMode === 'internal') {
            const target = targetInput.value.trim() || selectedText || 'Nazwa artykułu';
            const label = labelInput.value.trim();
            const snippet = (label && label !== target) ? `[[${target}|${label}]]` : `[[${target}]]`;
            closePopover(false);
            replaceTextareaRange(selStart, selEnd, snippet, snippet.length, snippet.length);
          } else {
            const url = extUrlInput.value.trim();
            if (!/^https?:\/\//i.test(url) || !isSafeUrl(url)) {
              extErrEl.textContent = 'Podaj poprawny adres URL zaczynający się od http:// lub https://.';
              extErrEl.classList.remove('hidden');
              extUrlInput.focus();
              return;
            }
            const label = extLabelInput.value.trim();
            const snippet = label ? `[${url} ${label}]` : `[${url} ${url}]`;
            closePopover(false);
            replaceTextareaRange(selStart, selEnd, snippet, snippet.length, snippet.length);
          }
        };

        document.getElementById('popover-link-insert').addEventListener('click', submitLink);
        targetInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitLink(); } });
        extUrlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitLink(); } });
        targetInput.focus();
      } else if (type === 'table') {
        popoverHost.innerHTML = `
          <div class="editor-popover-header">
            <strong>📊 Generator tabeli</strong>
            <button type="button" class="modal-close popover-close-btn" aria-label="Zamknij">&times;</button>
          </div>
          <div class="editor-popover-body">
            <div class="editor-meta-grid">
              <div class="form-group">
                <label for="popover-table-cols">Kolumny (1–10):</label>
                <input type="number" id="popover-table-cols" class="form-control" min="1" max="10" value="3" />
              </div>
              <div class="form-group">
                <label for="popover-table-rows">Wiersze danych (1–20):</label>
                <input type="number" id="popover-table-rows" class="form-control" min="1" max="20" value="2" />
              </div>
            </div>
            <div class="form-group">
              <label for="popover-table-align">Wyrównanie kolumn:</label>
              <select id="popover-table-align" class="form-control">
                <option value="left">Do lewej (:---)</option>
                <option value="center">Wyśrodkowane (:---:)</option>
                <option value="right">Do prawej (---:)</option>
              </select>
            </div>
          </div>
          <div class="editor-popover-footer">
            <button type="button" class="btn btn-sm btn-outline popover-cancel-btn">Anuluj</button>
            <button type="button" id="popover-table-insert" class="btn btn-sm btn-primary">Wstaw tabelę</button>
          </div>
        `;

        const colsInput = document.getElementById('popover-table-cols');
        const rowsInput = document.getElementById('popover-table-rows');
        const alignInput = document.getElementById('popover-table-align');

        document.getElementById('popover-table-insert').addEventListener('click', () => {
          const cols = Math.max(1, Math.min(10, parseInt(colsInput.value, 10) || 3));
          const rows = Math.max(1, Math.min(20, parseInt(rowsInput.value, 10) || 2));
          const align = alignInput.value;
          const sepToken = align === 'center' ? ':---:' : align === 'right' ? '---:' : '---';

          const headerCells = Array.from({ length: cols }, (_, c) => `Kolumna ${c + 1}`);
          const sepCells = Array.from({ length: cols }, () => sepToken);
          const lines = [
            `| ${headerCells.join(' | ')} |`,
            `| ${sepCells.join(' | ')} |`
          ];
          for (let r = 0; r < rows; r++) {
            const dataCells = Array.from({ length: cols }, (_, c) => `Komórka ${r + 1}.${c + 1}`);
            lines.push(`| ${dataCells.join(' | ')} |`);
          }
          closePopover(false);
          insertBlockOnLineBoundary(lines.join('\n'));
        });
        colsInput.focus();
      } else if (type === 'image') {
        popoverHost.innerHTML = `
          <div class="editor-popover-header">
            <strong>🖼️ Wstaw ilustrację</strong>
            <button type="button" class="modal-close popover-close-btn" aria-label="Zamknij">&times;</button>
          </div>
          <div class="editor-popover-body">
            <div class="form-group">
              <label for="popover-img-url">Adres URL obrazka (http://, https:// lub /...):</label>
              <input type="text" id="popover-img-url" class="form-control" placeholder="https://..." />
            </div>
            <div class="form-group">
              <label for="popover-img-alt">Tekst alternatywny (alt):</label>
              <input type="text" id="popover-img-alt" class="form-control" value="${escapeHtml(selectedText)}" placeholder="Krótki opis obrazu" />
            </div>
            <div class="form-group">
              <label for="popover-img-caption">Podpis pod ilustracją (opcjonalny):</label>
              <input type="text" id="popover-img-caption" class="form-control" placeholder="Np. Widok ogólny w 2024 roku" />
            </div>
            <div id="popover-img-error" class="form-error hidden"></div>
          </div>
          <div class="editor-popover-footer">
            <button type="button" class="btn btn-sm btn-outline popover-cancel-btn">Anuluj</button>
            <button type="button" id="popover-img-insert" class="btn btn-sm btn-primary">Wstaw obraz</button>
          </div>
        `;

        const urlInput = document.getElementById('popover-img-url');
        const altInput = document.getElementById('popover-img-alt');
        const capInput = document.getElementById('popover-img-caption');
        const errEl = document.getElementById('popover-img-error');

        document.getElementById('popover-img-insert').addEventListener('click', () => {
          const url = urlInput.value.trim();
          if (!isSafeUrl(url)) {
            errEl.textContent = 'Dozwolone są wyłącznie bezpieczne adresy http://, https:// lub ścieżki względne /...';
            errEl.classList.remove('hidden');
            urlInput.focus();
            return;
          }
          const alt = altInput.value.trim() || 'Ilustracja';
          const cap = capInput.value.trim().replace(/"/g, "'");
          const snippet = cap ? `![${alt}](${url} "${cap}")` : `![${alt}](${url})`;
          closePopover(false);
          insertBlockOnLineBoundary(snippet);
        });
        urlInput.focus();
      } else if (type === 'callout') {
        popoverHost.innerHTML = `
          <div class="editor-popover-header">
            <strong>💡 Wstaw ramkę informacyjną</strong>
            <button type="button" class="modal-close popover-close-btn" aria-label="Zamknij">&times;</button>
          </div>
          <div class="editor-popover-body">
            <div class="editor-meta-grid">
              <div class="form-group">
                <label for="popover-callout-type">Typ ramki:</label>
                <select id="popover-callout-type" class="form-control">
                  <option value="note">Notatka (note)</option>
                  <option value="tip">Wskazówka (tip)</option>
                  <option value="warning">Ostrzeżenie (warning)</option>
                  <option value="important">Ważne (important)</option>
                </select>
              </div>
              <div class="form-group">
                <label for="popover-callout-title">Tytuł ramki (opcjonalny):</label>
                <input type="text" id="popover-callout-title" class="form-control" placeholder="Np. Warto wiedzieć" />
              </div>
            </div>
            <div class="form-group">
              <label for="popover-callout-body">Treść ramki:</label>
              <textarea id="popover-callout-body" class="form-control" rows="3" placeholder="Wpisz treść ramki...">${escapeHtml(selectedText)}</textarea>
            </div>
          </div>
          <div class="editor-popover-footer">
            <button type="button" class="btn btn-sm btn-outline popover-cancel-btn">Anuluj</button>
            <button type="button" id="popover-callout-insert" class="btn btn-sm btn-primary">Wstaw ramkę</button>
          </div>
        `;

        const typeSelect = document.getElementById('popover-callout-type');
        const titleField = document.getElementById('popover-callout-title');
        const bodyField = document.getElementById('popover-callout-body');

        document.getElementById('popover-callout-insert').addEventListener('click', () => {
          const cType = typeSelect.value;
          const cTitle = titleField.value.trim();
          const cBody = bodyField.value.trim() || 'Treść uwagi lub wskazówki.';
          const headerLine = cTitle ? `:::${cType} ${cTitle}` : `:::${cType}`;
          const snippet = `${headerLine}\n${cBody}\n:::`;
          closePopover(false);
          insertBlockOnLineBoundary(snippet);
        });
        typeSelect.focus();
      } else if (type === 'ref') {
        popoverHost.innerHTML = `
          <div class="editor-popover-header">
            <strong>📑 Wstaw przypis (&lt;ref&gt;)</strong>
            <button type="button" class="modal-close popover-close-btn" aria-label="Zamknij">&times;</button>
          </div>
          <div class="editor-popover-body">
            <div class="form-group">
              <label for="popover-ref-text">Treść przypisu / źródło:</label>
              <textarea id="popover-ref-text" class="form-control" rows="2" placeholder="Np. Encyklopedia PWN, 2024 lub [https://... Opis źródła]">${escapeHtml(selectedText)}</textarea>
            </div>
          </div>
          <div class="editor-popover-footer">
            <button type="button" class="btn btn-sm btn-outline popover-cancel-btn">Anuluj</button>
            <button type="button" id="popover-ref-insert" class="btn btn-sm btn-primary">Wstaw przypis</button>
          </div>
        `;

        const refInput = document.getElementById('popover-ref-text');
        const submitRef = () => {
          const refText = refInput.value.trim() || 'Źródło lub komentarz';
          const snippet = `<ref>${refText}</ref>`;
          closePopover(false);
          replaceTextareaRange(selStart, selEnd, snippet, snippet.length, snippet.length);
        };
        document.getElementById('popover-ref-insert').addEventListener('click', submitRef);
        refInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitRef();
          }
        });
        refInput.focus();
      }

      popoverHost.querySelector('.popover-close-btn')?.addEventListener('click', () => closePopover(true));
      popoverHost.querySelector('.popover-cancel-btn')?.addEventListener('click', () => closePopover(true));
    }

    // Zamykanie popovera kliknięciem poza nim
    const onDocumentClickForPopover = (e) => {
      if (!popoverHost || popoverHost.classList.contains('hidden')) return;
      if (!popoverHost.contains(e.target) && !e.target.closest('.editor-toolbar')) {
        closePopover(false);
      }
    };
    document.addEventListener('click', onDocumentClickForPopover);

    // Obsługa przycisków paska narzędzi
    document.querySelectorAll('.editor-toolbar .toolbar-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (isLockedAndNotAdmin) return;
        const action = btn.dataset.action;
        if (action === 'heading') toggleHeading(2);
        else if (action === 'subheading') toggleHeading(3);
        else if (action === 'bold') toggleInlineWrap("'''", "'''", 'pogrubiony tekst');
        else if (action === 'italic') toggleInlineWrap("''", "''", 'kursywa');
        else if (action === 'bold-italic') toggleInlineWrap("'''''", "'''''", 'pogrubiona kursywa');
        else if (action === 'strike') toggleInlineWrap('~~', '~~', 'tekst przekreślony');
        else if (action === 'code') toggleInlineWrap('`', '`', 'kod');
        else if (action === 'bullet') toggleLinePrefix('bullet');
        else if (action === 'ordered') toggleLinePrefix('ordered');
        else if (action === 'quote') toggleLinePrefix('quote');
        else if (action === 'codeblock') insertCodeBlock();
        else if (action === 'hr') insertHorizontalRule();
        else if (action === 'link') openPopover('link');
        else if (action === 'ref') openPopover('ref');
        else if (action === 'table') openPopover('table');
        else if (action === 'image') openPopover('image');
        else if (action === 'callout') openPopover('callout');
        else if (action === 'infobox-helper') {
          addInfoboxRow('', '', true);
          showToast('Dodano nowe puste pole infoboxu poniżej.', 'info');
        }
      });
    });

    // Skróty klawiszowe wewnątrz #edit-content
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && popoverHost && !popoverHost.classList.contains('hidden')) {
        e.preventDefault();
        closePopover(true);
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        if (!isLockedAndNotAdmin) {
          indentSelectedLines(e.shiftKey);
        }
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      const lower = e.key.toLowerCase();
      if (lower === 'b' && !e.shiftKey) {
        e.preventDefault();
        if (!isLockedAndNotAdmin) toggleInlineWrap("'''", "'''", 'pogrubiony tekst');
      } else if (lower === 'i' && !e.shiftKey) {
        e.preventDefault();
        if (!isLockedAndNotAdmin) toggleInlineWrap("''", "''", 'kursywa');
      } else if (lower === 'k' && !e.shiftKey) {
        e.preventDefault();
        if (!isLockedAndNotAdmin) openPopover('link');
      } else if (lower === 's' && !e.shiftKey) {
        e.preventDefault();
        if (!isLockedAndNotAdmin) formEl.requestSubmit();
      } else if (lower === 'p' && e.shiftKey) {
        e.preventDefault();
        const modes = ['edit', 'split', 'preview'];
        const nextMode = modes[(modes.indexOf(editorMode) + 1) % modes.length];
        setEditorMode(nextMode);
      }
    });

    // Zdarzenia pól formularza i kursora
    titleInput.addEventListener('input', onEditorDataChanged);
    summaryInput.addEventListener('input', onEditorDataChanged);
    infoboxTitleInput.addEventListener('input', onEditorDataChanged);
    infoboxImageInput.addEventListener('input', onEditorDataChanged);
    commentInput.addEventListener('input', () => {
      if (autosaveTimer) clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(saveLocalDraft, 800);
    });

    textarea.addEventListener('input', onEditorDataChanged);
    textarea.addEventListener('keyup', () => {
      updateEditorStatusBar();
      updateToolbarActiveStates();
    });
    textarea.addEventListener('mouseup', () => {
      updateEditorStatusBar();
      updateToolbarActiveStates();
    });
    textarea.addEventListener('click', () => {
      updateEditorStatusBar();
      updateToolbarActiveStates();
    });

    // Presety komentarza edycji
    document.querySelectorAll('.edit-summary-presets .summary-chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (isLockedAndNotAdmin) return;
        const text = btn.dataset.summary || '';
        const current = commentInput.value.trim();
        if (!current) {
          commentInput.value = text;
        } else if (!current.includes(text)) {
          commentInput.value = `${current}; ${text}`;
        }
        commentInput.focus();
      });
    });

    // Guard przed opuszczeniem strony (beforeunload + Anuluj)
    const beforeUnloadHandler = (e) => {
      if (isEditorDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnloadHandler);

    const cancelLink = document.getElementById('editor-cancel-link');
    if (cancelLink) {
      cancelLink.addEventListener('click', (e) => {
        e.preventDefault();
        navigateWithGuard(cancelLink.getAttribute('href'));
      });
    }

    // Rejestracja globalnego strażnika aktywnego edytora
    if (activeEditorGuard) activeEditorGuard.cleanup();
    activeEditorGuard = {
      currentHash: window.location.hash || '#/',
      isDirty: isEditorDirty,
      cleanup: () => {
        window.removeEventListener('beforeunload', beforeUnloadHandler);
        document.removeEventListener('click', onDocumentClickForPopover);
        if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
        if (autosaveTimer) clearTimeout(autosaveTimer);
        if (previewAbortController) previewAbortController.abort();
      }
    };

    // Inicjalizacja widoków edytora
    updateSlugPreview();
    renderCategoryPicker();
    updateEditorStatusBar();
    updateToolbarActiveStates();
    updateDirtyBadge();
    checkExistingDraft();
    if (editorMode === 'split' || editorMode === 'preview') {
      runLivePreview();
    }

    // --- Zapis formularza ---
    async function submitArticleForm(forceOverwrite = false) {
      if (isLockedAndNotAdmin) return;

      const title = titleInput.value.trim();
      const summary = summaryInput.value.trim();
      const content = textarea.value;
      const categories = getEffectiveCategories();
      const edit_comment = commentInput.value.trim();

      if (!title) {
        showToast('Podaj tytuł artykułu.', 'warning');
        titleInput.focus();
        return;
      }

      if (isNew && !slugifyTitle(title)) {
        showToast('Tytuł musi zawierać litery lub cyfry, aby utworzyć adres URL.', 'warning');
        titleInput.focus();
        return;
      }

      if (!content.trim()) {
        showToast('Treść artykułu nie może być pusta.', 'warning');
        textarea.focus();
        return;
      }

      const infoboxResult = collectInfoboxData({ strict: true });
      if (infoboxResult && infoboxResult.error) {
        return;
      }
      const infobox = infoboxResult;

      const saveBtn = document.getElementById('editor-save-btn');
      const prevBtnHtml = saveBtn ? saveBtn.innerHTML : '';
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Zapisywanie...';
      }

      try {
        conflictBannerEl.classList.add('hidden');
        conflictBannerEl.innerHTML = '';

        if (isNew) {
          const res = await api('/api/articles', {
            method: 'POST',
            body: { title, summary, content, infobox, categories, edit_comment }
          });
          clearLocalDraft();
          if (activeEditorGuard) {
            activeEditorGuard.cleanup();
            activeEditorGuard = null;
          }
          await refreshBootstrapMetadata();
          showToast('Artykuł został pomyślnie utworzony!', 'success');
          window.location.hash = `#/wiki/${res.article.slug}`;
        } else {
          const bodyPayload = {
            title,
            summary,
            content,
            infobox,
            categories,
            edit_comment
          };
          if (baseUpdatedAt && !forceOverwrite) {
            bodyPayload.base_updated_at = baseUpdatedAt;
          }

          const res = await api(`/api/articles/${encodeURIComponent(slug)}`, {
            method: 'PUT',
            body: bodyPayload
          });
          clearLocalDraft();
          if (activeEditorGuard) {
            activeEditorGuard.cleanup();
            activeEditorGuard = null;
          }
          await refreshBootstrapMetadata();
          showToast('Zmiany w artykule zostały zapisane!', 'success');
          window.location.hash = `#/wiki/${res.article.slug}`;
        }
      } catch (err) {
        if (err.status === 409 && err.data && err.data.conflict && err.data.currentArticle) {
          const srv = err.data.currentArticle;
          const srvEditor = srv.last_editor || srv.editor || 'innego redaktora';
          conflictBannerEl.classList.remove('hidden');
          conflictBannerEl.innerHTML = `
            <div>
              <strong>⚠️ Wykryto konflikt edycji (409):</strong> Artykuł został w międzyczasie zmodyfikowany (${escapeHtml(formatDate(srv.updated_at))} przez <em>${escapeHtml(srvEditor)}</em>).
            </div>
            <div class="conflict-banner-actions">
              <button type="button" id="conflict-reload-btn" class="btn btn-sm btn-outline">Wczytaj najnowszą wersję z serwera</button>
              <button type="button" id="conflict-force-btn" class="btn btn-sm btn-danger">Nadpisz moją wersją</button>
            </div>
          `;

          document.getElementById('conflict-reload-btn')?.addEventListener('click', () => {
            if (activeEditorGuard) {
              activeEditorGuard.cleanup();
              activeEditorGuard = null;
            }
            renderArticleEditor(slug);
          });

          document.getElementById('conflict-force-btn')?.addEventListener('click', () => {
            baseUpdatedAt = srv.updated_at;
            submitArticleForm(true);
          });
          conflictBannerEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
          showToast(err.message, 'error');
        }
      } finally {
        if (saveBtn) {
          saveBtn.disabled = isLockedAndNotAdmin;
          saveBtn.innerHTML = prevBtnHtml;
        }
      }
    }

    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      submitArticleForm(false);
    });
  }

  // --- WIDOK 5: Dyskusja artykułu (#/wiki/:slug/talk) ---
  async function renderTalkView(slug) {
    const viewRoot = document.getElementById('view-root');
    viewRoot.innerHTML = '<div class="wiki-loading">Ładowanie dyskusji...</div>';

    try {
      const artData = await api(`/api/articles/${encodeURIComponent(slug)}?noView=1`);
      const talkData = await api(`/api/articles/${encodeURIComponent(slug)}/talk`);
      const messages = talkData.messages || [];

      updateArticleTabs(slug, 'talk', artData.revisionsCount, messages.length);

      viewRoot.innerHTML = `
        <div class="talk-thread">
          <header class="talk-header">
            <h1>Dyskusja: ${escapeHtml(artData.article.title)}</h1>
            <p>To jest strona dyskusji przeznaczona do omawiania ulepszeń artykułu <a href="#/wiki/${encodeURIComponent(slug)}">${escapeHtml(artData.article.title)}</a>.</p>
          </header>

          <div class="talk-messages-list">
            ${messages.length === 0 ? `
              <div class="talk-empty">
                <p>Brak wpisów w dyskusji nad tym hasłem. Bądź pierwszą osobą, która zabierze głos!</p>
              </div>
            ` : messages.map(msg => `
              <div class="talk-message-card" id="talk-msg-${msg.id}">
                <div class="talk-msg-header">
                  <span class="talk-author">💬 <strong>${escapeHtml(msg.author || 'Anonim')}</strong></span>
                  <span class="talk-date">${formatDate(msg.created_at)}</span>
                </div>
                <div class="talk-msg-content">${escapeHtml(msg.content)}</div>
              </div>
            `).join('')}
          </div>

          <div class="talk-form-card">
            <h3 class="talk-form-title">Dodaj nową wypowiedź do wątku</h3>
            <form id="talk-add-form" class="talk-form">
              <div class="form-group">
                <label for="talk-author-input">Twój podpis / autor:</label>
                <input type="text" id="talk-author-input" class="form-control" value="${escapeHtml(state.currentUser ? state.currentUser.username : '')}" placeholder="Podpis (lub pozostaw puste dla Anonim)" ${state.currentUser ? 'readonly' : ''} />
              </div>
              <div class="form-group">
                <label for="talk-content-input">Treść wiadomości:</label>
                <textarea id="talk-content-input" class="form-control" rows="4" placeholder="Wpisz treść swojej uwagi lub propozycji do artykułu..." required></textarea>
              </div>
              <button type="submit" class="btn btn-primary">Wyślij wypowiedź</button>
            </form>
          </div>
        </div>
      `;

      document.getElementById('talk-add-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const author = document.getElementById('talk-author-input').value.trim() || (state.currentUser ? state.currentUser.username : 'Anonim');
        const content = document.getElementById('talk-content-input').value.trim();

        if (!content) {
          showToast('Wpisz treść wiadomości przed wysłaniem.', 'warning');
          return;
        }

        try {
          await api(`/api/articles/${encodeURIComponent(slug)}/talk`, {
            method: 'POST',
            body: { author, content }
          });
          showToast('Wypowiedź została dodana do dyskusji!', 'success');
          renderTalkView(slug);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    } catch (err) {
      viewRoot.innerHTML = `<div class="wiki-error">Błąd wczytywania dyskusji: ${escapeHtml(err.message)}</div>`;
    }
  }

  // --- WIDOK 6: Historia i Diff (#/wiki/:slug/history) ---
  async function renderHistoryView(slug) {
    const viewRoot = document.getElementById('view-root');
    viewRoot.innerHTML = '<div class="wiki-loading">Ładowanie historii wersji...</div>';

    try {
      const data = await api(`/api/articles/${encodeURIComponent(slug)}/revisions`);
      const revisions = data.revisions || [];
      const art = data.article || { title: slug, slug };

      updateArticleTabs(slug, 'history', revisions.length);

      const canCompare = revisions.length >= 2;

      viewRoot.innerHTML = `
        <div class="history-page">
          <header class="history-header">
            <h1>Historia zmian: ${escapeHtml(art.title)}</h1>
            <p>Przeglądaj wcześniejsze wersje artykułu, porównuj różnice linia po linii lub przywracaj wybrane rewizje.</p>
          </header>

          ${revisions.length === 0 ? `
            <p>Brak zarejestrowanych wersji dla tego artykułu.</p>
          ` : `
            ${canCompare ? `
              <div class="history-controls">
                <button type="button" id="compare-diff-btn" class="btn btn-secondary">🔍 Porównaj wybrane wersje</button>
              </div>
            ` : `
              <div class="alert alert-info">
                ℹ️ Artykuł posiada obecnie tylko jedną zapisaną wersję — porównanie zmian będzie dostępne po dodaniu kolejnej rewizji.
              </div>
            `}

            <div id="diff-output-container" class="diff-container hidden"></div>

            <div class="revision-list table-responsive">
              <table class="wiki-table history-table">
                <thead>
                  <tr>
                    <th style="width: 44px;">Od</th>
                    <th style="width: 44px;">Do</th>
                    <th>Data i godzina</th>
                    <th>Autor edycji</th>
                    <th>Komentarz do edycji</th>
                    ${canEditWiki() ? '<th>Akcje</th>' : ''}
                  </tr>
                </thead>
                <tbody>
                  ${revisions.map((rev, idx) => `
                    <tr class="revision-row" data-id="${rev.id}">
                      <td><input type="radio" name="diff-from" value="${rev.id}" aria-label="Wersja bazowa ${rev.id}" ${idx === 1 ? 'checked' : ''} ${!canCompare ? 'disabled' : ''} /></td>
                      <td><input type="radio" name="diff-to" value="${rev.id}" aria-label="Wersja docelowa ${rev.id}" ${idx === 0 ? 'checked' : ''} ${!canCompare ? 'disabled' : ''} /></td>
                      <td><strong>${formatDate(rev.created_at)}</strong></td>
                      <td>${escapeHtml(rev.editor || 'Anonim')}</td>
                      <td><em>${escapeHtml(rev.edit_comment || '(brak komentarza)')}</em></td>
                      ${canEditWiki() ? `
                        <td>
                          <button type="button" class="btn btn-sm btn-outline revert-btn" data-id="${rev.id}" ${idx === 0 ? 'disabled title="To jest bieżąca wersja"' : ''}>⏪ Przywróć</button>
                        </td>
                      ` : ''}
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      `;

      const compareBtn = document.getElementById('compare-diff-btn');
      if (compareBtn) {
        compareBtn.addEventListener('click', async () => {
          const fromInput = document.querySelector('input[name="diff-from"]:checked');
          const toInput = document.querySelector('input[name="diff-to"]:checked');

          if (!fromInput || !toInput) {
            showToast('Wybierz dwie wersje do porównania.', 'warning');
            return;
          }

          const fromId = fromInput.value;
          const toId = toInput.value;

          if (fromId === toId) {
            showToast('Wybierz dwie różne wersje do porównania.', 'warning');
            return;
          }

          const diffContainer = document.getElementById('diff-output-container');
          diffContainer.innerHTML = '<div class="wiki-loading">Generowanie diffa...</div>';
          diffContainer.classList.remove('hidden');

          try {
            const diffData = await api(`/api/articles/${encodeURIComponent(slug)}/diff?from=${fromId}&to=${toId}`);
            renderDiffTable(diffContainer, diffData);
            diffContainer.scrollIntoView({ behavior: 'smooth' });
          } catch (err) {
            diffContainer.innerHTML = `<div class="wiki-error">Błąd porównywania: ${escapeHtml(err.message)}</div>`;
          }
        });
      }

      document.querySelectorAll('.revert-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const revId = btn.dataset.id;
          const confirmed = await showConfirmModal({
            title: 'Przywrócenie wersji artykułu',
            message: `Czy na pewno chcesz przywrócić artykuł do wersji #${revId}? Spowoduje to utworzenie nowej rewizji z treścią z wybranej wersji.`,
            confirmText: 'Przywróć wersję',
            cancelText: 'Anuluj'
          });
          if (!confirmed) return;

          try {
            await api(`/api/articles/${encodeURIComponent(slug)}/revert`, {
              method: 'POST',
              body: { revisionId: revId }
            });
            await refreshBootstrapMetadata();
            showToast('Artykuł został przywrócony do wybranej wersji!', 'success');
            window.location.hash = `#/wiki/${slug}`;
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    } catch (err) {
      viewRoot.innerHTML = `<div class="wiki-error">Błąd wczytywania historii: ${escapeHtml(err.message)}</div>`;
    }
  }

  // Pomocnik renderowania tabeli Diff z numerami linii
  function renderDiffTable(container, diffData) {
    const fromRev = diffData.fromRev || {};
    const toRev = diffData.toRev || {};
    const diff = diffData.diff || [];

    let diffLinesHtml = '';
    diff.forEach(item => {
      let lineClass = 'diff-line-same';
      let sign = ' ';
      if (item.type === 'add') {
        lineClass = 'diff-line-add';
        sign = '+';
      } else if (item.type === 'del') {
        lineClass = 'diff-line-del';
        sign = '-';
      }

      const oldNum = item.oldLineNum !== undefined && item.oldLineNum !== null ? item.oldLineNum : '';
      const newNum = item.newLineNum !== undefined && item.newLineNum !== null ? item.newLineNum : '';

      diffLinesHtml += `
        <tr class="${lineClass}">
          <td class="diff-num">${oldNum}</td>
          <td class="diff-num">${newNum}</td>
          <td class="diff-sign">${sign}</td>
          <td class="diff-code"><pre>${escapeHtml(item.line || '')}</pre></td>
        </tr>
      `;
    });

    container.innerHTML = `
      <div class="diff-box">
        <div class="diff-header-info">
          <div class="diff-ver-box">
            <strong>Wersja bazowa (#${fromRev.id}):</strong> ${formatDate(fromRev.created_at)} przez <em>${escapeHtml(fromRev.editor || 'Anonim')}</em>
          </div>
          <div class="diff-ver-box">
            <strong>Wersja porównywana (#${toRev.id}):</strong> ${formatDate(toRev.created_at)} przez <em>${escapeHtml(toRev.editor || 'Anonim')}</em>
          </div>
        </div>
        <table class="diff-table">
          <tbody>
            ${diffLinesHtml || '<tr><td colspan="4">Brak różnic w tekście.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }

  // --- WIDOK 7: Katalog Artykułów (#/articles) ---
  async function renderArticlesCatalog(query = '', selectedCategory = '', initialSort = 'featured') {
    updateArticleTabs(null);
    const viewRoot = document.getElementById('view-root');

    viewRoot.innerHTML = `
      <div class="articles-catalog-page">
        <header class="catalog-header">
          <div class="catalog-header-row">
            <div>
              <h1>Indeks artykułów</h1>
              <p>Spis haseł encyklopedycznych z filtrowaniem według nazwy, działu i kolejności.</p>
            </div>
            ${canEditWiki() ? '<a href="#/new" class="catalog-create-link">+ Utwórz nowe hasło</a>' : ''}
          </div>
        </header>

        <div class="catalog-filter-bar">
          <div class="filter-group">
            <label for="catalog-search-input">Szukaj w indeksie:</label>
            <input type="text" id="catalog-search-input" class="form-control" value="${escapeHtml(query)}" placeholder="Wpisz frazę..." />
          </div>
          <div class="filter-group">
            <label for="catalog-category-select">Dział tematyczny:</label>
            <select id="catalog-category-select" class="form-control">
              <option value="">Wszystkie kategorie</option>
              ${state.categories.map(c => {
                const name = getCatName(c);
                const count = getCatCount(c);
                return `<option value="${escapeHtml(name)}" ${name === selectedCategory ? 'selected' : ''}>${escapeHtml(name)}${count !== null ? ` (${count})` : ''}</option>`;
              }).join('')}
            </select>
          </div>
          <div class="filter-group">
            <label for="catalog-sort-select">Sortowanie:</label>
            <select id="catalog-sort-select" class="form-control">
              <option value="featured" ${initialSort === 'featured' ? 'selected' : ''}>Wyróżnione i najnowsze</option>
              <option value="updated" ${initialSort === 'updated' ? 'selected' : ''}>Ostatnio zmieniane</option>
              <option value="views" ${initialSort === 'views' ? 'selected' : ''}>Najpopularniejsze</option>
              <option value="title-asc" ${initialSort === 'title-asc' ? 'selected' : ''}>Alfabetycznie (A–Z)</option>
              <option value="title-desc" ${initialSort === 'title-desc' ? 'selected' : ''}>Alfabetycznie (Z–A)</option>
            </select>
          </div>
          <div class="catalog-filter-actions">
            <button id="catalog-filter-btn" type="button" class="btn btn-primary">Filtruj</button>
            <button id="catalog-clear-btn" type="button" class="btn btn-outline ${(!query && !selectedCategory && initialSort === 'featured') ? 'hidden' : ''}">Wyczyść</button>
          </div>
        </div>

        <div id="catalog-results-info" class="catalog-results-info">Ładowanie...</div>
        <div id="catalog-results-grid" class="catalog-articles-grid">
          <div class="wiki-loading">Ładowanie katalogu artykułów...</div>
        </div>
      </div>
    `;

    const searchInput = document.getElementById('catalog-search-input');
    const categorySelect = document.getElementById('catalog-category-select');
    const sortSelect = document.getElementById('catalog-sort-select');
    const filterBtn = document.getElementById('catalog-filter-btn');
    const clearBtn = document.getElementById('catalog-clear-btn');
    const resultsInfoEl = document.getElementById('catalog-results-info');
    const resultsGridEl = document.getElementById('catalog-results-grid');

    let catalogAbort = null;
    let catalogReqSeq = 0;
    let searchDebounce = null;

    function sortCatalogList(list, sortMode) {
      const copy = [...list];
      if (sortMode === 'title-asc') {
        return copy.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'pl'));
      }
      if (sortMode === 'title-desc') {
        return copy.sort((a, b) => String(b.title || '').localeCompare(String(a.title || ''), 'pl'));
      }
      if (sortMode === 'views') {
        return copy.sort((a, b) => (Number(b.views) || 0) - (Number(a.views) || 0));
      }
      if (sortMode === 'updated') {
        return copy.sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
      }
      return copy;
    }

    async function updateCatalogResults() {
      const q = searchInput.value.trim();
      const cat = categorySelect.value;
      const sortMode = sortSelect.value;

      if (clearBtn) {
        clearBtn.classList.toggle('hidden', !q && !cat && sortMode === 'featured');
      }

      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (cat) params.set('category', cat);
      if (sortMode && sortMode !== 'featured') params.set('sort', sortMode);
      const queryStr = params.toString() ? '?' + params.toString() : '';
      history.replaceState(null, '', `#/articles${queryStr}`);

      const seq = ++catalogReqSeq;
      if (catalogAbort) catalogAbort.abort();
      catalogAbort = new AbortController();

      try {
        const qParam = q ? `&q=${encodeURIComponent(q)}` : '';
        const catParam = cat ? `&category=${encodeURIComponent(cat)}` : '';
        const data = await api(`/api/articles?includeUnpublished=1${qParam}${catParam}`, {
          signal: catalogAbort.signal
        });
        if (seq !== catalogReqSeq) return;

        const articles = sortCatalogList(data.articles || [], sortMode);
        resultsInfoEl.innerHTML = `Liczba haseł: <strong>${articles.length}</strong>`;

        if (articles.length === 0) {
          resultsGridEl.innerHTML = `
            <div class="catalog-empty">
              <p>Nie znaleziono żadnych artykułów spełniających podane kryteria.</p>
            </div>
          `;
          return;
        }

        resultsGridEl.innerHTML = articles.map(art => {
          const cats = parseCategories(art.categories);
          return `
            <article class="catalog-article-card">
              <div class="catalog-card-main">
                <div class="catalog-card-header">
                  <h3><a href="#/wiki/${art.slug}">${art.is_featured ? '<span class="featured-star" title="Artykuł wyróżniony">★</span> ' : ''}${escapeHtml(art.title)}</a></h3>
                  <div class="catalog-card-badges">
                    ${art.is_featured ? '<span class="catalog-tag catalog-tag-featured">★ Wyróżniony</span>' : ''}
                    ${art.is_locked ? '<span class="catalog-tag">Zabezpieczony</span>' : ''}
                    ${!art.is_published ? '<span class="catalog-tag catalog-tag-draft">Szkic</span>' : ''}
                  </div>
                </div>
                <p class="catalog-card-summary">${escapeHtml(art.summary || 'Brak podsumowania.')}</p>
                <div class="catalog-card-footer">
                  ${cats.length > 0 ? `
                    <div class="catalog-card-cats">
                      <span class="catalog-cats-label">Kategorie:</span>
                      ${cats.map(cName => `<a href="#/categories/${encodeURIComponent(cName)}" class="badge-cat">${escapeHtml(cName)}</a>`).join('<span class="catalog-sep">·</span>')}
                    </div>
                  ` : '<span></span>'}
                  <div class="catalog-card-meta">
                    <span>${art.views || 0} wyśw.</span>
                    <span class="catalog-sep">·</span>
                    <span>${formatDate(art.updated_at || art.created_at)}</span>
                  </div>
                </div>
              </div>
            </article>
          `;
        }).join('');
      } catch (err) {
        if (err.name === 'AbortError') return;
        resultsGridEl.innerHTML = `<div class="wiki-error">Błąd wczytywania katalogu: ${escapeHtml(err.message)}</div>`;
      }
    }

    filterBtn.addEventListener('click', updateCatalogResults);
    searchInput.addEventListener('input', () => {
      if (searchDebounce) clearTimeout(searchDebounce);
      searchDebounce = setTimeout(updateCatalogResults, 220);
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (searchDebounce) clearTimeout(searchDebounce);
        updateCatalogResults();
      }
    });
    categorySelect.addEventListener('change', updateCatalogResults);
    sortSelect.addEventListener('change', updateCatalogResults);
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      categorySelect.value = '';
      sortSelect.value = 'featured';
      updateCatalogResults();
      searchInput.focus();
    });

    await updateCatalogResults();
  }

  // --- WIDOK 8: Kategorie (#/categories oraz #/categories/:category) ---
  async function renderCategoriesView(selectedCategory = null) {
    updateArticleTabs(null);
    const viewRoot = document.getElementById('view-root');
    viewRoot.innerHTML = '<div class="wiki-loading">Ładowanie kategorii...</div>';

    try {
      if (!selectedCategory) {
        const bootData = await api('/api/bootstrap');
        const cats = bootData.categories || [];
        state.categories = cats;

        viewRoot.innerHTML = `
          <div class="categories-overview-page">
            <header class="cat-page-header">
              <h1>Kategorie encyklopedii</h1>
              <p>Alfabetyczny i tematyczny wykaz działów WikiKurekk (${cats.length}).</p>
            </header>

            <div class="categories-large-grid">
              ${cats.map(cat => {
                const name = getCatName(cat);
                const count = getCatCount(cat);
                const countLabel = count === 1 ? '1 hasło' : `${count || 0} haseł`;
                return `
                  <a href="#/categories/${encodeURIComponent(name)}" class="category-card-large">
                    <span class="cat-card-name">${escapeHtml(name)}</span>
                    <span class="cat-card-action">${count !== null ? countLabel : 'Zobacz'}</span>
                  </a>
                `;
              }).join('')}
            </div>
          </div>
        `;
      } else {
        const data = await api(`/api/articles?category=${encodeURIComponent(selectedCategory)}`);
        const articles = data.articles || [];

        viewRoot.innerHTML = `
          <div class="category-detail-page">
            <header class="cat-page-header">
              <a href="#/categories" class="back-link">&larr; Wszystkie kategorie</a>
              <h1>Kategoria: ${escapeHtml(selectedCategory)}</h1>
              <p>Liczba przypisanych artykułów: <strong>${articles.length}</strong></p>
            </header>

            <div class="catalog-articles-grid">
              ${articles.length === 0 ? `
                <div class="catalog-empty">
                  <p>Brak opublikowanych artykułów w kategorii <em>${escapeHtml(selectedCategory)}</em>.</p>
                </div>
              ` : articles.map(art => `
                <article class="catalog-article-card">
                  <div class="catalog-card-main">
                    <div class="catalog-card-header">
                      <h3><a href="#/wiki/${art.slug}">${art.is_featured ? '<span class="featured-star" title="Artykuł wyróżniony">★</span> ' : ''}${escapeHtml(art.title)}</a></h3>
                      <div class="catalog-card-badges">
                        ${art.is_featured ? '<span class="catalog-tag catalog-tag-featured">★ Wyróżniony</span>' : ''}
                        ${art.is_locked ? '<span class="catalog-tag">Zabezpieczony</span>' : ''}
                      </div>
                    </div>
                    <p class="catalog-card-summary">${escapeHtml(art.summary || 'Brak podsumowania.')}</p>
                    <div class="catalog-card-footer">
                      <span></span>
                      <div class="catalog-card-meta">
                        <span>${art.views || 0} wyśw.</span>
                        <span class="catalog-sep">·</span>
                        <span>${formatDate(art.updated_at || art.created_at)}</span>
                      </div>
                    </div>
                  </div>
                </article>
              `).join('')}
            </div>
          </div>
        `;
      }
    } catch (err) {
      viewRoot.innerHTML = `<div class="wiki-error">Błąd wczytywania kategorii: ${escapeHtml(err.message)}</div>`;
    }
  }

  // --- WIDOK 9: Ostatnie Zmiany (#/recent-changes) ---
  async function renderRecentChangesView() {
    updateArticleTabs(null);
    const viewRoot = document.getElementById('view-root');
    viewRoot.innerHTML = '<div class="wiki-loading">Ładowanie ostatnich zmian...</div>';

    try {
      const data = await api('/api/recent-changes');
      const changes = data.changes || [];

      viewRoot.innerHTML = `
        <div class="recent-changes-page">
          <header class="recent-header">
            <h1>🕒 Ostatnie zmiany w encyklopedii</h1>
            <p>Śledź na żywo najnowsze edycje, tworzenie nowych haseł oraz aktywność autorów.</p>
          </header>

          <div class="recent-changes-feed">
            ${changes.length === 0 ? `
              <p>Brak zarejestrowanych zmian w bazie.</p>
            ` : changes.map(ch => {
              const slug = ch.slug || ch.article_slug;
              const title = ch.title || slug;
              return `
                <div class="recent-change-row">
                  <div class="change-time">${formatDate(ch.created_at)}</div>
                  <div class="change-main">
                    <span class="change-art-title"><a href="#/wiki/${slug}">${escapeHtml(title)}</a></span>
                    <span class="change-author">przez <strong>${escapeHtml(ch.editor || 'Anonim')}</strong></span>
                    <div class="change-comment"><em>„${escapeHtml(ch.edit_comment || 'Aktualizacja treści')}”</em></div>
                  </div>
                  <div class="change-links">
                    <a href="#/wiki/${slug}/history" class="btn btn-sm btn-outline">Historia</a>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    } catch (err) {
      viewRoot.innerHTML = `<div class="wiki-error">Błąd wczytywania ostatnich zmian: ${escapeHtml(err.message)}</div>`;
    }
  }

  // --- WIDOK 10: Panel Administracyjny (#/panel) ---
  async function renderAdminPanel() {
    updateArticleTabs(null);
    const viewRoot = document.getElementById('view-root');

    if (!state.currentUser || state.currentUser.role !== 'admin') {
      viewRoot.innerHTML = `
        <div class="admin-auth-guard">
          <h2>🔒 Wymagane logowanie</h2>
          <p>Ta strona jest dostępna wyłącznie dla uprawnionych użytkowników.</p>
          ${state.currentUser
            ? '<p>Twoje konto nie ma wymaganych uprawnień.</p>'
            : '<button type="button" id="admin-page-login" class="btn btn-primary">Zaloguj się</button>'}
        </div>
      `;
      document.getElementById('admin-page-login')?.addEventListener('click', () => openAuthModal('login'));
      return;
    }

    viewRoot.innerHTML = '<div class="wiki-loading">Ładowanie panelu administratora...</div>';

    try {
      const data = await api('/api/admin/dashboard');
      const stats = data.stats || {};
      const settings = data.settings || {};
      const articles = data.articles || [];
      const users = data.users || [];
      const auditLogs = data.recentAuditLogs || [];
      const talkMessages = data.recentTalkMessages || [];

      viewRoot.innerHTML = `
        <div class="admin-dashboard">
          <header class="admin-header">
            <div class="admin-title-row">
              <h1>Panel administracyjny</h1>
              <span class="user-role-badge">Administrator: <strong>${escapeHtml(state.currentUser.username)}</strong></span>
            </div>
            <p class="admin-lead">Zarządzanie hasłami, uprawnieniami kont, dyskusjami, konfiguracją witryny oraz dziennikiem zdarzeń.</p>
          </header>

          <nav class="admin-tabs" role="tablist" aria-label="Zakładki panelu administratora">
            <button type="button" role="tab" aria-selected="${state.adminActiveTab === 'kpi'}" class="admin-tab-btn ${state.adminActiveTab === 'kpi' ? 'active' : ''}" data-tab="kpi">Podsumowanie</button>
            <button type="button" role="tab" aria-selected="${state.adminActiveTab === 'articles'}" class="admin-tab-btn ${state.adminActiveTab === 'articles' ? 'active' : ''}" data-tab="articles">Artykuły (${articles.length})</button>
            <button type="button" role="tab" aria-selected="${state.adminActiveTab === 'users'}" class="admin-tab-btn ${state.adminActiveTab === 'users' ? 'active' : ''}" data-tab="users">Użytkownicy (${users.length})</button>
            <button type="button" role="tab" aria-selected="${state.adminActiveTab === 'talk'}" class="admin-tab-btn ${state.adminActiveTab === 'talk' ? 'active' : ''}" data-tab="talk">Dyskusje (${talkMessages.length})</button>
            <button type="button" role="tab" aria-selected="${state.adminActiveTab === 'settings'}" class="admin-tab-btn ${state.adminActiveTab === 'settings' ? 'active' : ''}" data-tab="settings">Ustawienia</button>
            <button type="button" role="tab" aria-selected="${state.adminActiveTab === 'audit'}" class="admin-tab-btn ${state.adminActiveTab === 'audit' ? 'active' : ''}" data-tab="audit">Dziennik zdarzeń</button>
          </nav>

          <div id="admin-tab-content" class="admin-tab-content"></div>
        </div>
      `;

      const tabContent = document.getElementById('admin-tab-content');

      const renderCurrentAdminSubTab = () => {
        document.querySelectorAll('.admin-tab-btn').forEach(btn => {
          const isActive = btn.dataset.tab === state.adminActiveTab;
          btn.classList.toggle('active', isActive);
          btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        if (state.adminActiveTab === 'kpi') {
          tabContent.innerHTML = `
            <div class="admin-kpi-grid">
              <div class="admin-kpi-card">
                <div class="admin-kpi-label">Łączna liczba haseł</div>
                <div class="admin-kpi-value">${stats.articlesCount || 0}</div>
              </div>
              <div class="admin-kpi-card">
                <div class="admin-kpi-label">Łączna liczba wyświetleń</div>
                <div class="admin-kpi-value">${stats.totalViews || 0}</div>
              </div>
              <div class="admin-kpi-card">
                <div class="admin-kpi-label">Zarejestrowani użytkownicy</div>
                <div class="admin-kpi-value">${stats.usersCount || 0}</div>
              </div>
              <div class="admin-kpi-card">
                <div class="admin-kpi-label">Zapisane wersje i edycje</div>
                <div class="admin-kpi-value">${stats.revisionsCount || 0}</div>
              </div>
            </div>
            <div class="admin-subcard">
              <h3>Skróty administracyjne</h3>
              <p>Szybkie przejście do najczęstszych zadań redakcyjnych i konfiguracyjnych:</p>
              <div class="quick-admin-links">
                <a href="#/new" class="btn btn-primary">+ Utwórz nowy artykuł</a>
                <button type="button" class="btn switch-to-tab" data-target="articles">Zarządzaj artykułami i wyróżnieniami</button>
                <button type="button" class="btn switch-to-tab" data-target="users">Zarządzaj kontami i rolami</button>
                <button type="button" class="btn switch-to-tab" data-target="settings">Konfiguracja witryny</button>
              </div>
            </div>
          `;

          tabContent.querySelectorAll('.switch-to-tab').forEach(b => {
            b.addEventListener('click', () => {
              state.adminActiveTab = b.dataset.target;
              renderCurrentAdminSubTab();
            });
          });
        } else if (state.adminActiveTab === 'articles') {
          tabContent.innerHTML = `
            <div class="admin-section">
              <div class="admin-section-header">
                <h2>Zarządzanie artykułami (${articles.length})</h2>
                <a href="#/new" class="btn btn-primary btn-sm">➕ Utwórz artykuł</a>
              </div>
              <div class="table-responsive">
                <table class="wiki-table admin-table">
                  <thead>
                    <tr>
                      <th>Tytuł</th>
                      <th>Wyświetlenia</th>
                      <th>Statusy</th>
                      <th>Przełączniki</th>
                      <th>Akcje</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${articles.map(art => `
                      <tr data-slug="${art.slug}">
                        <td><strong><a href="#/wiki/${art.slug}">${art.is_featured ? '<span class="featured-star" title="Artykuł wyróżniony">★</span> ' : ''}${escapeHtml(art.title)}</a></strong></td>
                        <td>${art.views || 0}</td>
                        <td>
                          <div class="admin-status-group">
                            ${art.is_featured ? '<span class="catalog-tag catalog-tag-featured">★ Wyróżniony</span>' : ''}
                            ${art.is_locked ? '<span class="catalog-tag">Zabezpieczony</span>' : '<span class="catalog-tag">Otwarty</span>'}
                            ${!art.is_published ? '<span class="catalog-tag catalog-tag-draft">Szkic</span>' : '<span class="catalog-tag">Opublikowany</span>'}
                          </div>
                        </td>
                        <td>
                          <div class="admin-btn-group">
                            <button type="button" class="btn btn-sm btn-outline toggle-feature-btn" data-slug="${art.slug}" data-status="${art.is_featured ? 1 : 0}">
                              ${art.is_featured ? '★ Zdejmij wyróżnienie' : '☆ Wyróżnij'}
                            </button>
                            <button type="button" class="btn btn-sm btn-outline toggle-lock-btn" data-slug="${art.slug}" data-status="${art.is_locked ? 1 : 0}">
                              ${art.is_locked ? 'Odbezpiecz' : 'Zabezpiecz'}
                            </button>
                            <button type="button" class="btn btn-sm btn-outline toggle-publish-btn" data-slug="${art.slug}" data-status="${art.is_published ? 1 : 0}">
                              ${art.is_published ? 'Ukryj' : 'Opublikuj'}
                            </button>
                          </div>
                        </td>
                        <td>
                          <div class="admin-btn-group">
                            <a href="#/wiki/${art.slug}/edit" class="btn btn-sm">Edytuj</a>
                            <button type="button" class="btn btn-sm btn-danger delete-article-btn" data-slug="${art.slug}" data-title="${escapeHtml(art.title)}">Usuń</button>
                          </div>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          `;

          tabContent.querySelectorAll('.toggle-lock-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const slug = btn.dataset.slug;
              const isLocked = btn.dataset.status === '1';
              try {
                await api(`/api/admin/articles/${encodeURIComponent(slug)}/status`, {
                  method: 'PATCH',
                  body: { is_locked: !isLocked }
                });
                showToast(`Zmieniono status blokady dla: ${slug}`, 'success');
                renderAdminPanel();
              } catch (err) {
                showToast(err.message, 'error');
              }
            });
          });

          tabContent.querySelectorAll('.toggle-feature-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const slug = btn.dataset.slug;
              const isFeatured = btn.dataset.status === '1';
              try {
                await api(`/api/admin/articles/${encodeURIComponent(slug)}/status`, {
                  method: 'PATCH',
                  body: { is_featured: !isFeatured }
                });
                showToast(`Zaktualizowano wyróżnienie artykułu: ${slug}`, 'success');
                renderAdminPanel();
              } catch (err) {
                showToast(err.message, 'error');
              }
            });
          });

          tabContent.querySelectorAll('.toggle-publish-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const slug = btn.dataset.slug;
              const isPublished = btn.dataset.status === '1';
              try {
                await api(`/api/admin/articles/${encodeURIComponent(slug)}/status`, {
                  method: 'PATCH',
                  body: { is_published: !isPublished }
                });
                await refreshBootstrapMetadata();
                showToast(`Zmieniono widoczność artykułu: ${slug}`, 'success');
                renderAdminPanel();
              } catch (err) {
                showToast(err.message, 'error');
              }
            });
          });

          tabContent.querySelectorAll('.delete-article-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const slug = btn.dataset.slug;
              const title = btn.dataset.title;
              const confirmed = await showConfirmModal({
                title: 'Usunięcie artykułu',
                message: `Czy na pewno chcesz BEZPOWROTNIE usunąć artykuł „${title}”? Tej operacji nie można cofnąć.`,
                confirmText: 'Usuń artykuł',
                cancelText: 'Anuluj',
                danger: true
              });
              if (!confirmed) return;

              try {
                await api(`/api/admin/articles/${encodeURIComponent(slug)}`, {
                  method: 'DELETE'
                });
                await refreshBootstrapMetadata();
                showToast(`Artykuł „${title}” został usunięty.`, 'success');
                renderAdminPanel();
              } catch (err) {
                showToast(err.message, 'error');
              }
            });
          });
        } else if (state.adminActiveTab === 'users') {
          tabContent.innerHTML = `
            <div class="admin-section">
              <h2>Użytkownicy i Uprawnienia (${users.length})</h2>
              <div class="table-responsive">
                <table class="wiki-table admin-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Login</th>
                      <th>Rola</th>
                      <th>Bio</th>
                      <th>Zmień rolę</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${users.map(u => `
                      <tr data-id="${u.id}">
                        <td>#${u.id}</td>
                        <td><strong>${escapeHtml(u.username)}</strong></td>
                        <td><span class="user-role-pill role-${escapeHtml(u.role)}">${escapeHtml(u.role)}</span></td>
                        <td><em>${escapeHtml(u.bio || '')}</em></td>
                        <td>
                          <select class="form-control role-select" data-id="${u.id}" ${u.id === (state.currentUser ? state.currentUser.id : null) ? 'disabled title="Nie możesz zmienić własnej roli"' : ''}>
                            <option value="user" ${u.role === 'user' ? 'selected' : ''}>Użytkownik (user)</option>
                            <option value="editor" ${u.role === 'editor' ? 'selected' : ''}>Redaktor (editor)</option>
                            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrator (admin)</option>
                            <option value="blocked" ${u.role === 'blocked' ? 'selected' : ''}>Zablokowany (blocked)</option>
                          </select>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>

              <div class="admin-subcard add-user-card">
                <h3>➕ Utwórz nowe konto użytkownika</h3>
                <form id="admin-add-user-form" class="admin-form-grid">
                  <div class="form-group">
                    <label for="new-user-username">Nazwa użytkownika:</label>
                    <input type="text" id="new-user-username" class="form-control" placeholder="Login" required />
                  </div>
                  <div class="form-group">
                    <label for="new-user-password">Hasło:</label>
                    <input type="password" id="new-user-password" class="form-control" placeholder="Hasło (min. 3 znaki)" minlength="3" required />
                  </div>
                  <div class="form-group">
                    <label for="new-user-role">Rola:</label>
                    <select id="new-user-role" class="form-control">
                      <option value="user">Użytkownik (user)</option>
                      <option value="editor" selected>Redaktor (editor)</option>
                      <option value="admin">Administrator (admin)</option>
                      <option value="blocked">Zablokowany (blocked)</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label for="new-user-bio">Opis / Notatka:</label>
                    <input type="text" id="new-user-bio" class="form-control" placeholder="Krótki opis konta" />
                  </div>
                  <div class="form-actions" style="grid-column: 1 / -1;">
                    <button type="submit" class="btn btn-primary">Utwórz użytkownika</button>
                  </div>
                </form>
              </div>
            </div>
          `;

          tabContent.querySelectorAll('.role-select').forEach(sel => {
            sel.addEventListener('change', async () => {
              const userId = sel.dataset.id;
              const newRole = sel.value;
              try {
                await api(`/api/admin/users/${userId}`, {
                  method: 'PATCH',
                  body: { role: newRole }
                });
                const row = sel.closest('tr');
                const pill = row?.querySelector('.user-role-pill');
                if (pill) {
                  pill.className = `user-role-pill role-${newRole}`;
                  pill.textContent = newRole;
                }
                showToast(`Zaktualizowano rolę użytkownika #${userId} na: ${newRole}`, 'success');
              } catch (err) {
                showToast(err.message, 'error');
                renderAdminPanel();
              }
            });
          });

          document.getElementById('admin-add-user-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('new-user-username').value.trim();
            const password = document.getElementById('new-user-password').value;
            const role = document.getElementById('new-user-role').value;
            const bio = document.getElementById('new-user-bio').value.trim();

            try {
              await api('/api/admin/users', {
                method: 'POST',
                body: { username, password, role, bio }
              });
              showToast(`Użytkownik „${username}” został pomyślnie utworzony!`, 'success');
              renderAdminPanel();
            } catch (err) {
              showToast(err.message, 'error');
            }
          });
        } else if (state.adminActiveTab === 'talk') {
          tabContent.innerHTML = `
            <div class="admin-section">
              <h2>Moderacja Wpisów w Dyskusjach (${talkMessages.length})</h2>
              <p>Przeglądaj wszystkie wypowiedzi ze wszystkich stron dyskusji z możliwością ich usunięcia.</p>
              <div class="talk-moderation-list">
                ${talkMessages.length === 0 ? `
                  <p>Brak wypowiedzi w dyskusjach do moderacji.</p>
                ` : talkMessages.map(msg => `
                  <div class="talk-mod-card" data-id="${msg.id}">
                    <div class="talk-mod-header">
                      <span>Artykuł: <strong><a href="#/wiki/${msg.article_slug}/talk">${escapeHtml(msg.article_title || msg.article_slug)}</a></strong></span>
                      <span>Autor: <strong>${escapeHtml(msg.author || 'Anonim')}</strong></span>
                      <span>Data: ${formatDate(msg.created_at)}</span>
                    </div>
                    <div class="talk-mod-body">${escapeHtml(msg.content)}</div>
                    <div class="talk-mod-actions">
                      <button type="button" class="btn btn-sm btn-danger delete-talk-btn" data-id="${msg.id}">🗑️ Usuń ten wpis</button>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          `;

          tabContent.querySelectorAll('.delete-talk-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const id = btn.dataset.id;
              const confirmed = await showConfirmModal({
                title: 'Usunięcie wpisu z dyskusji',
                message: 'Czy na pewno chcesz usunąć ten wpis z dyskusji?',
                confirmText: 'Usuń wpis',
                cancelText: 'Anuluj',
                danger: true
              });
              if (!confirmed) return;

              try {
                await api(`/api/admin/talk/${id}`, {
                  method: 'DELETE'
                });
                showToast('Wpis został usunięty.', 'success');
                renderAdminPanel();
              } catch (err) {
                showToast(err.message, 'error');
              }
            });
          });
        } else if (state.adminActiveTab === 'settings') {
          tabContent.innerHTML = `
            <div class="admin-section">
              <h2>⚙️ Ustawienia Encyklopedii</h2>
              <form id="admin-settings-form" class="admin-settings-form">
                <div class="form-group">
                  <label for="set-site-name">Nazwa witryny:</label>
                  <input type="text" id="set-site-name" class="form-control" value="${escapeHtml(settings.site_name || 'WikiKurekk')}" required />
                </div>
                <div class="form-group">
                  <label for="set-site-tagline">Podtytuł / motto witryny:</label>
                  <input type="text" id="set-site-tagline" class="form-control" value="${escapeHtml(settings.site_tagline || 'Wolna encyklopedia')}" />
                </div>
                <div class="form-group">
                  <label for="set-announcement">Baner ogłoszeniowy na samej górze strony:</label>
                  <input type="text" id="set-announcement" class="form-control" value="${escapeHtml(settings.announcement_banner || '')}" placeholder="Pozostaw puste, aby ukryć baner" />
                  <small class="form-hint">Tekst widoczny dla wszystkich czytelników na szczycie strony.</small>
                </div>
                <div class="form-group checkbox-group">
                  <label>
                    <input type="checkbox" id="set-anon-edits" ${String(settings.allow_anonymous_edits) === '1' ? 'checked' : ''} />
                    Zezwalaj na anonimowe edycje (bez logowania)
                  </label>
                </div>
                <button type="submit" class="btn btn-primary">Zapisz ustawienia</button>
              </form>
            </div>
          `;

          document.getElementById('admin-settings-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const site_name = document.getElementById('set-site-name').value.trim();
            const site_tagline = document.getElementById('set-site-tagline').value.trim();
            const announcement_banner = document.getElementById('set-announcement').value.trim();
            const allow_anonymous_edits = document.getElementById('set-anon-edits').checked ? '1' : '0';

            try {
              const res = await api('/api/admin/settings', {
                method: 'PUT',
                body: { site_name, site_tagline, announcement_banner, allow_anonymous_edits }
              });
              state.settings = res.settings;
              updateHeaderAndSidebar();
              showToast('Ustawienia encyklopedii zostały zaktualizowane!', 'success');
            } catch (err) {
              showToast(err.message, 'error');
            }
          });
        } else if (state.adminActiveTab === 'audit') {
          tabContent.innerHTML = `
            <div class="admin-section">
              <h2>Dziennik zdarzeń (Audit Log)</h2>
              <p class="admin-section-lead">Rejestr najważniejszych operacji administracyjnych i redakcyjnych.</p>
              <div class="table-responsive">
                <table class="wiki-table admin-table">
                  <thead>
                    <tr>
                      <th>Data i czas</th>
                      <th>Użytkownik</th>
                      <th>Zdarzenie</th>
                      <th>Szczegóły</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${auditLogs.length === 0 ? `
                      <tr><td colspan="4">Brak wpisów w dzienniku zdarzeń.</td></tr>
                    ` : auditLogs.map(log => `
                      <tr class="audit-row">
                        <td class="audit-date">${formatDate(log.created_at)}</td>
                        <td class="audit-actor"><strong>${escapeHtml(log.actor || 'System')}</strong></td>
                        <td class="audit-action"><code>${escapeHtml(log.action)}</code></td>
                        <td class="audit-details">${escapeHtml(log.details || '')}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          `;
        }
      };

      document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          state.adminActiveTab = btn.dataset.tab;
          renderCurrentAdminSubTab();
        });
      });

      renderCurrentAdminSubTab();
    } catch (err) {
      viewRoot.innerHTML = `<div class="wiki-error">Błąd wczytywania panelu admina: ${escapeHtml(err.message)}</div>`;
    }
  }

  // --- Router hash-based ---
  function safeDecodeHashPart(val) {
    try {
      return decodeURIComponent(val);
    } catch {
      return val;
    }
  }

  function parseCurrentRoute() {
    const rawHash = window.location.hash || '#/';
    const qIdx = rawHash.indexOf('?');
    const pathPart = qIdx === -1 ? rawHash : rawHash.slice(0, qIdx);
    const queryPart = qIdx === -1 ? '' : rawHash.slice(qIdx + 1);
    const query = new URLSearchParams(queryPart);

    if (pathPart === '' || pathPart === '#' || pathPart === '#/') {
      return { name: 'home', params: {}, query };
    }
    if (pathPart === '#/new') {
      return { name: 'new', params: {}, query };
    }
    if (pathPart === '#/articles') {
      return { name: 'articles', params: {}, query };
    }
    if (pathPart === '#/recent-changes') {
      return { name: 'recent-changes', params: {}, query };
    }
    if (pathPart === '#/panel') {
      return { name: 'admin', params: {}, query };
    }
    if (pathPart.startsWith('#/categories')) {
      const sub = pathPart.slice('#/categories'.length).replace(/^\//, '');
      if (!sub) {
        return { name: 'categories', params: {}, query };
      }
      return { name: 'categories-detail', params: { category: safeDecodeHashPart(sub) }, query };
    }

    const editMatch = pathPart.match(/^#\/wiki\/([^/]+)\/edit$/);
    if (editMatch) {
      return { name: 'wiki-edit', params: { slug: safeDecodeHashPart(editMatch[1]) }, query };
    }

    const talkMatch = pathPart.match(/^#\/wiki\/([^/]+)\/talk$/);
    if (talkMatch) {
      return { name: 'wiki-talk', params: { slug: safeDecodeHashPart(talkMatch[1]) }, query };
    }

    const histMatch = pathPart.match(/^#\/wiki\/([^/]+)\/history$/);
    if (histMatch) {
      return { name: 'wiki-history', params: { slug: safeDecodeHashPart(histMatch[1]) }, query };
    }

    const viewMatch = pathPart.match(/^#\/wiki\/([^/]+)$/);
    if (viewMatch) {
      return { name: 'wiki-view', params: { slug: safeDecodeHashPart(viewMatch[1]) }, query };
    }

    return { name: 'home', params: {}, query };
  }

  function handleRoute() {
    if (activeEditorGuard) {
      activeEditorGuard.cleanup();
      activeEditorGuard = null;
    }

    setSidebarOpen(false);
    const route = parseCurrentRoute();
    state.currentRoute = route;
    updateHeaderAndSidebar();

    const suggestions = document.getElementById('search-suggestions');
    const searchInput = document.getElementById('search-input');
    if (suggestions) suggestions.classList.add('hidden');
    if (searchInput) {
      searchInput.setAttribute('aria-expanded', 'false');
      searchInput.setAttribute('aria-activedescendant', '');
    }

    switch (route.name) {
      case 'home':
        renderHomePage();
        break;
      case 'wiki-view':
        renderArticleView(route.params.slug);
        break;
      case 'wiki-edit':
        renderArticleEditor(route.params.slug);
        break;
      case 'wiki-talk':
        renderTalkView(route.params.slug);
        break;
      case 'wiki-history':
        renderHistoryView(route.params.slug);
        break;
      case 'new': {
        const titleParam = route.query.get('title') || '';
        renderArticleEditor(null, titleParam);
        break;
      }
      case 'articles': {
        const q = route.query.get('q') || '';
        const cat = route.query.get('category') || '';
        const sort = route.query.get('sort') || 'featured';
        renderArticlesCatalog(q, cat, sort);
        break;
      }
      case 'categories':
        renderCategoriesView(null);
        break;
      case 'categories-detail':
        renderCategoriesView(route.params.category);
        break;
      case 'recent-changes':
        renderRecentChangesView();
        break;
      case 'admin':
        renderAdminPanel();
        break;
      default:
        renderHomePage();
    }
  }

  // --- Okno logowania / rejestracji (tryby: 'login' | 'register') ---
  function openAuthModal(mode = 'login') {
    const authModal = document.getElementById('auth-modal');
    if (!authModal) return;

    if (authModal.classList.contains('hidden')) {
      lastAuthTriggerEl = document.activeElement;
      resetAuthForms();
    } else {
      ['login-error', 'register-error'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.textContent = '';
          el.classList.add('hidden');
        }
      });
    }

    const isRegister = mode === 'register';
    document.getElementById('login-form')?.classList.toggle('hidden', isRegister);
    document.getElementById('register-form')?.classList.toggle('hidden', !isRegister);
    const title = document.getElementById('auth-modal-title');
    if (title) title.textContent = isRegister ? 'Zarejestruj się' : 'Zaloguj się';
    authModal.classList.remove('hidden');
    document.getElementById(isRegister ? 'reg-username' : 'login-username')?.focus();
  }

  function initAuthAndModals() {
    const authModal = document.getElementById('auth-modal');
    const authModalBtn = document.getElementById('auth-modal-btn');
    const registerModalBtn = document.getElementById('register-modal-btn');
    const authModalClose = document.getElementById('auth-modal-close');
    const logoutBtn = document.getElementById('logout-btn');

    const closeModal = () => {
      if (!authModal || authModal.classList.contains('hidden')) return;
      authModal.classList.add('hidden');
      resetAuthForms();
      if (lastAuthTriggerEl && typeof lastAuthTriggerEl.focus === 'function' && document.contains(lastAuthTriggerEl)) {
        lastAuthTriggerEl.focus();
      }
      lastAuthTriggerEl = null;
    };

    if (authModalBtn) authModalBtn.addEventListener('click', () => openAuthModal('login'));
    if (registerModalBtn) registerModalBtn.addEventListener('click', () => openAuthModal('register'));
    document.querySelectorAll('[data-auth-mode]').forEach(btn => {
      btn.addEventListener('click', () => openAuthModal(btn.dataset.authMode));
    });
    if (authModalClose) authModalClose.addEventListener('click', closeModal);
    if (authModal) {
      authModal.addEventListener('click', (e) => {
        if (e.target === authModal) closeModal();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (document.querySelector('.confirm-modal-backdrop')) return;
        if (authModal && !authModal.classList.contains('hidden')) {
          closeModal();
          return;
        }
        setSidebarOpen(false);
      }
    });

    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        const canLeave = await confirmLeaveEditorIfDirty();
        if (!canLeave) return;
        try {
          await api('/api/auth/logout', { method: 'POST', suppressAuthExpiry: true }).catch(() => {});
        } finally {
          clearAuthToken();
          showToast('Wylogowano pomyślnie.', 'info');
          handleRoute();
        }
      });
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const usernameInput = document.getElementById('login-username');
        const passwordInput = document.getElementById('login-password');
        const errorEl = document.getElementById('login-error');
        const submitBtn = document.getElementById('login-submit');
        const username = usernameInput ? usernameInput.value.trim() : '';
        const password = passwordInput ? passwordInput.value : '';

        if (errorEl) {
          errorEl.textContent = '';
          errorEl.classList.add('hidden');
        }
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Logowanie...';
        }

        try {
          const res = await api('/api/auth/login', {
            method: 'POST',
            body: { username, password }
          });
          setAuthToken(res.token, res.user);
          closeModal();
          showToast(`Witaj z powrotem, ${res.user.username}!`, 'success');
          if (!activeEditorGuard) handleRoute();
        } catch (err) {
          if (errorEl) {
            errorEl.textContent = err.message;
            errorEl.classList.remove('hidden');
          }
          showToast(err.message, 'error');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Zaloguj się';
          }
        }
      });
    }

    const registerForm = document.getElementById('register-form');
    if (registerForm) {
      registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const usernameInput = document.getElementById('reg-username');
        const passwordInput = document.getElementById('reg-password');
        const bioInput = document.getElementById('reg-bio');
        const errorEl = document.getElementById('register-error');
        const submitBtn = document.getElementById('reg-submit');

        const username = usernameInput ? usernameInput.value.trim() : '';
        const password = passwordInput ? passwordInput.value : '';
        const bio = bioInput ? bioInput.value.trim() : '';

        if (errorEl) {
          errorEl.textContent = '';
          errorEl.classList.add('hidden');
        }
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Tworzenie konta...';
        }

        try {
          const res = await api('/api/auth/register', {
            method: 'POST',
            body: { username, password, bio }
          });
          setAuthToken(res.token, res.user);
          closeModal();
          showToast(`Konto ${res.user.username} zostało zarejestrowane!`, 'success');
          if (!activeEditorGuard) handleRoute();
        } catch (err) {
          if (errorEl) {
            errorEl.textContent = err.message;
            errorEl.classList.remove('hidden');
          }
          showToast(err.message, 'error');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Utwórz konto';
          }
        }
      });
    }
  }

  // --- Dynamiczna wyszukiwarka z nawigacją klawiaturą i losowanie artykułu ---
  function initSearchAndRandom() {
    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('search-input');
    const suggestionsEl = document.getElementById('search-suggestions');
    const randomBtn = document.getElementById('random-article-btn');

    let searchDebounceTimer = null;
    let searchAbortController = null;
    let searchRequestSeq = 0;
    let activeSuggestionIdx = -1;

    function getNavigableSuggestionItems() {
      if (!suggestionsEl) return [];
      return Array.from(suggestionsEl.querySelectorAll('a.search-suggestion-item'));
    }

    function hideSuggestions() {
      if (!suggestionsEl) return;
      suggestionsEl.classList.add('hidden');
      activeSuggestionIdx = -1;
      if (searchInput) {
        searchInput.setAttribute('aria-expanded', 'false');
        searchInput.setAttribute('aria-activedescendant', '');
      }
    }

    function setActiveSuggestion(nextIdx) {
      const items = getNavigableSuggestionItems();
      if (items.length === 0) {
        activeSuggestionIdx = -1;
        searchInput?.setAttribute('aria-activedescendant', '');
        return;
      }
      if (nextIdx < 0) nextIdx = items.length - 1;
      if (nextIdx >= items.length) nextIdx = 0;
      activeSuggestionIdx = nextIdx;

      items.forEach((item, idx) => {
        const isActive = idx === activeSuggestionIdx;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-selected', isActive ? 'true' : 'false');
        if (isActive) {
          item.scrollIntoView({ block: 'nearest' });
          searchInput?.setAttribute('aria-activedescendant', item.id || '');
        }
      });
    }

    const goToRandomArticle = async () => {
      try {
        const res = await api('/api/articles/random');
        if (res.slug) {
          navigateWithGuard(`#/wiki/${res.slug}`);
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    };

    if (randomBtn) randomBtn.addEventListener('click', goToRandomArticle);

    if (searchForm) {
      searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const items = getNavigableSuggestionItems();
        if (activeSuggestionIdx >= 0 && items[activeSuggestionIdx] && !suggestionsEl.classList.contains('hidden')) {
          const href = items[activeSuggestionIdx].getAttribute('href');
          hideSuggestions();
          if (href) navigateWithGuard(href);
          return;
        }
        const q = searchInput ? searchInput.value.trim() : '';
        if (q) {
          hideSuggestions();
          navigateWithGuard(`#/articles?q=${encodeURIComponent(q)}`);
        }
      });
    }

    if (searchInput && suggestionsEl) {
      searchInput.addEventListener('input', () => {
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        const query = searchInput.value.trim();

        if (query.length === 0) {
          if (searchAbortController) searchAbortController.abort();
          suggestionsEl.innerHTML = '';
          hideSuggestions();
          return;
        }

        searchDebounceTimer = setTimeout(async () => {
          const seq = ++searchRequestSeq;
          if (searchAbortController) searchAbortController.abort();
          searchAbortController = new AbortController();

          try {
            const data = await api(`/api/articles?q=${encodeURIComponent(query)}`, {
              signal: searchAbortController.signal
            });
            if (seq !== searchRequestSeq) return;

            const results = (data.articles || []).slice(0, 5);
            activeSuggestionIdx = -1;

            let html = '';
            let optCounter = 0;
            if (results.length === 0) {
              html += `
                <div class="search-suggestion-item search-suggestion-empty">
                  Brak wyników dla „${escapeHtml(query)}”
                </div>
              `;
            } else {
              html += results.map(art => `
                <a href="#/wiki/${art.slug}" id="search-opt-${optCounter++}" role="option" aria-selected="false" class="search-suggestion-item">
                  <div class="search-suggestion-title">${escapeHtml(art.title)}</div>
                  ${art.summary ? `<div class="search-suggestion-snippet">${escapeHtml(art.summary)}</div>` : ''}
                </a>
              `).join('');
            }

            if (canEditWiki()) {
              html += `
                <a href="#/new?title=${encodeURIComponent(query)}" id="search-opt-${optCounter++}" role="option" aria-selected="false" class="search-suggestion-item search-suggestion-create">
                  ➕ Utwórz brakujący artykuł: <strong>${escapeHtml(query)}</strong>
                </a>
              `;
            }

            suggestionsEl.innerHTML = html;
            suggestionsEl.classList.remove('hidden');
            searchInput.setAttribute('aria-expanded', 'true');
            searchInput.setAttribute('aria-activedescendant', '');
          } catch (err) {
            if (err.name === 'AbortError') return;
            hideSuggestions();
          }
        }, 200);
      });

      document.addEventListener('click', (e) => {
        if (!searchForm.contains(e.target)) {
          hideSuggestions();
        }
      });

      searchInput.addEventListener('keydown', (e) => {
        if (suggestionsEl.classList.contains('hidden')) return;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveSuggestion(activeSuggestionIdx + 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveSuggestion(activeSuggestionIdx - 1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          hideSuggestions();
        } else if (e.key === 'Enter' && activeSuggestionIdx >= 0) {
          const items = getNavigableSuggestionItems();
          if (items[activeSuggestionIdx]) {
            e.preventDefault();
            const href = items[activeSuggestionIdx].getAttribute('href');
            hideSuggestions();
            if (href) navigateWithGuard(href);
          }
        }
      });
    }
  }

  // --- Przechwytywanie kliknięć linków, kotwic, TOC i zakładek ---
  function initGlobalClickHandlers() {
    document.addEventListener('click', (e) => {
      // Skip link - płynne przejście do #view-root bez zmiany hasha SPA
      const skipLink = e.target.closest('a.skip-link');
      if (skipLink) {
        e.preventDefault();
        const viewRoot = document.getElementById('view-root');
        if (viewRoot) {
          viewRoot.focus({ preventScroll: false });
          viewRoot.scrollIntoView({ behavior: 'smooth' });
        }
        return;
      }

      // Jeśli kliknięto wewnątrz #preview-box edytora, obsługuje to listener na #preview-box
      if (e.target.closest('#preview-box')) {
        return;
      }

      // Przełączanie widoczności spisu treści (TOC)
      const tocToggle = e.target.closest('.wiki-toc-toggle');
      if (tocToggle) {
        e.preventDefault();
        const tocNav = tocToggle.closest('.wiki-toc');
        const list = tocNav?.querySelector('.toc-list');
        if (tocNav && list) {
          const collapsed = list.classList.toggle('hidden');
          tocNav.classList.toggle('is-collapsed', collapsed);
          tocToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
          tocToggle.textContent = collapsed ? 'Pokaż' : 'Ukryj';
        }
        return;
      }

      // Płynne przewijanie do kotwic wewnątrz artykułu (TOC, przypisy)
      const anchorLink = e.target.closest('a[href^="#sekcja-"], a[href^="#ref-"], a[href^="#cite_"]');
      if (anchorLink) {
        e.preventDefault();
        const targetId = anchorLink.getAttribute('href').slice(1);
        const el = document.getElementById(targetId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth' });
        }
        return;
      }

      // Czerwone linki do nieistniejących haseł
      const redLink = e.target.closest('.wiki-link-red, [data-missing-title]');
      if (redLink) {
        e.preventDefault();
        if (!canEditWiki()) {
          showToast('Artykuł jeszcze nie istnieje. Tworzenie haseł jest dostępne dla redaktorów.', 'info');
          return;
        }
        const missingTitle = redLink.dataset.missingTitle || redLink.getAttribute('title') || redLink.textContent.trim();
        navigateWithGuard(`#/new?title=${encodeURIComponent(missingTitle)}`);
        return;
      }

      // Przyciski zakładek artykułu na pasku #article-tabs-bar
      const tabBtn = e.target.closest('.wiki-tab');
      if (tabBtn && state.activeSlug) {
        const tabType = tabBtn.dataset.tab;
        let targetHash = `#/wiki/${encodeURIComponent(state.activeSlug)}`;
        if (tabType === 'talk') targetHash = `#/wiki/${encodeURIComponent(state.activeSlug)}/talk`;
        if (tabType === 'edit') targetHash = `#/wiki/${encodeURIComponent(state.activeSlug)}/edit`;
        if (tabType === 'history') targetHash = `#/wiki/${encodeURIComponent(state.activeSlug)}/history`;
        navigateWithGuard(targetHash);
        return;
      }

      // Ochrona pozostałych linków SPA (#/...) podczas aktywnej brudnej sesji edytora
      const spaLink = e.target.closest('a[href^="#/"]');
      if (spaLink && activeEditorGuard && activeEditorGuard.isDirty()) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const href = spaLink.getAttribute('href');
        if (href && href !== activeEditorGuard.currentHash) {
          e.preventDefault();
          navigateWithGuard(href);
        }
      }
    });
  }

  // --- Start aplikacji ---
  async function initApp() {
    applyTheme(state.theme);
    document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    });

    initSidebarDrawer();
    initAuthAndModals();
    initSearchAndRandom();
    initGlobalClickHandlers();

    if (state.token) {
      try {
        const authData = await api('/api/auth/me', { suppressAuthExpiry: true });
        if (authData.user) {
          state.currentUser = authData.user;
        } else {
          clearAuthToken();
        }
      } catch {
        clearAuthToken();
      }
    }

    try {
      const boot = await api('/api/bootstrap', { suppressAuthExpiry: true });
      state.settings = boot.settings || state.settings;
      state.stats = boot.stats || state.stats;
      state.categories = boot.categories || state.categories;
      state.allSlugs = boot.allSlugs || state.allSlugs;
      if (Array.isArray(boot.recentArticles)) {
        boot.recentArticles.forEach(a => {
          if (a && a.slug && a.title) state.articleTitlesBySlug[a.slug] = a.title;
        });
      }
      if (boot.featuredArticle && boot.featuredArticle.slug && boot.featuredArticle.title) {
        state.articleTitlesBySlug[boot.featuredArticle.slug] = boot.featuredArticle.title;
      }
      if (boot.currentUser && !state.currentUser) {
        state.currentUser = boot.currentUser;
      }
    } catch (e) {
      console.warn('Nie udało się pobrać bootstrapa na starcie:', e);
    }

    updateHeaderAndSidebar();

    window.addEventListener('hashchange', async () => {
      if (isBypassingHashGuard) return;
      const newHash = window.location.hash || '#/';
      if (activeEditorGuard && activeEditorGuard.isDirty() && newHash !== activeEditorGuard.currentHash) {
        isBypassingHashGuard = true;
        history.replaceState(null, '', activeEditorGuard.currentHash);
        isBypassingHashGuard = false;

        const ok = await confirmLeaveEditorIfDirty();
        if (ok) {
          window.location.hash = newHash;
        }
        return;
      }
      handleRoute();
    });

    if (window.location.pathname.replace(/\/+$/, '') === '/panel') {
      history.replaceState(null, '', '/#/panel');
    }

    handleRoute();
  }

  window.wikiApp = {
    state,
    api,
    showToast,
    handleRoute,
    setAuthToken,
    clearAuthToken
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
