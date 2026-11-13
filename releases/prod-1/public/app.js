/**
 * WikiKurekk - Kompletna aplikacja SPA Frontend (Vanilla JS)
 * Właściciel: public/app.js
 */

(function () {
  'use strict';

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
    activeSlug: null,
    adminActiveTab: 'kpi',
    currentRoute: null,
    theme: localStorage.getItem('wiki_theme') || 'light'
  };

  // Referencja do ostatniego elementu, który otworzył modal (dla dostępności)
  let lastFocusedElementBeforeModal = null;

  // --- Motyw jasny / ciemny ---
  function applyTheme(theme) {
    const clean = theme === 'dark' ? 'dark' : 'light';
    state.theme = clean;
    document.documentElement.setAttribute('data-theme', clean);
    localStorage.setItem('wiki_theme', clean);
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      btn.textContent = clean === 'dark' ? 'Jasny motyw' : 'Ciemny motyw';
    }
  }

  // Uprawnienia edycji encyklopedii: wyłącznie zalogowany admin lub editor
  function canEditWiki() {
    return Boolean(state.currentUser && (state.currentUser.role === 'admin' || state.currentUser.role === 'editor'));
  }

  // Aktualizacja tytułu zakładki w przeglądarce
  function setPageTitle(subTitle = '') {
    const siteName = (state.settings && state.settings.site_name) || 'WikiKurekk';
    if (subTitle) {
      document.title = `${subTitle} – ${siteName}`;
    } else {
      const tagline = (state.settings && state.settings.site_tagline) || 'Wolna encyklopedia';
      document.title = `${siteName} – ${tagline}`;
    }
  }

  // --- Pomocnicze funkcje tekstowe i formatowania ---
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleString('pl-PL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // Bezpieczna walidacja URL obrazu
  function sanitizeImageUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const clean = url.trim();
    if (/^(https?:\/\/|\/|data:image\/)/i.test(clean)) {
      return clean;
    }
    return '';
  }

  // --- Pomocnicze funkcje kategorii ---
  function getCatName(c) {
    return (!c) ? '' : (typeof c === 'object' ? String(c.name || '') : String(c));
  }

  function getCatCount(c) {
    return (c && typeof c === 'object' && typeof c.count === 'number') ? c.count : null;
  }

  // Bezpieczne parsowanie listy kategorii z obiektu artykułu
  function parseCategories(catData) {
    if (!catData) return [];
    if (Array.isArray(catData)) {
      return catData.map(c => getCatName(c)).filter(Boolean);
    }
    if (typeof catData === 'string') {
      const trimmed = catData.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return parsed.map(c => getCatName(c)).filter(Boolean);
          }
        } catch {}
      }
      return trimmed.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
  }

  // --- System powiadomień Toast ---
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    if (type === 'warning') {
      toast.style.backgroundColor = '#d97706';
      toast.style.color = '#ffffff';
    }

    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };
    const icon = icons[type] || 'ℹ️';

    toast.innerHTML = `
      <span class="toast-icon" aria-hidden="true">${icon}</span>
      <span class="toast-message">${escapeHtml(message)}</span>
      <button class="toast-close" type="button" aria-label="Zamknij powiadomienie">&times;</button>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    let timer = null;

    const removeToast = () => {
      if (timer) clearTimeout(timer);
      toast.classList.add('toast-fade-out');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 250);
    };

    closeBtn.addEventListener('click', removeToast);
    container.appendChild(toast);
    timer = setTimeout(removeToast, 3800);
  }

  // Eksport globalny showToast
  window.showToast = showToast;

  // --- Komunikacja z API ---
  async function api(path, options = {}) {
    const headers = Object.assign({}, options.headers || {});

    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
      headers['X-Wiki-Token'] = state.token;
    }
    options.headers = headers;

    const res = await fetch(path, options);
    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json().catch(() => null);
    } else {
      data = await res.text().catch(() => null);
    }

    if (!res.ok) {
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
    updateHeaderAndSidebar();
  }

  // --- Aktualizacja Nagłówka, Paska bocznego i Banera ---
  function updateHeaderAndSidebar() {
    // Tytuły strony
    const siteNameEl = document.getElementById('site-name-label');
    const siteTaglineEl = document.getElementById('site-tagline-label');
    if (siteNameEl) siteNameEl.textContent = state.settings.site_name || 'WikiKurekk';
    if (siteTaglineEl) siteTaglineEl.textContent = state.settings.site_tagline || 'Wolna encyklopedia';

    // Baner ogłoszeniowy na samej górze witryny
    const bannerEl = document.getElementById('announcement-banner');
    if (bannerEl) {
      const bannerText = (state.settings && state.settings.announcement_banner) ? state.settings.announcement_banner.trim() : '';
      if (bannerText) {
        bannerEl.textContent = bannerText;
        bannerEl.classList.remove('hidden');
      } else {
        bannerEl.textContent = '';
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

    // Link do panelu – widoczny wyłącznie dla zalogowanego administratora
    if (navAdminTop) {
      const isAdmin = !!(state.currentUser && state.currentUser.role === 'admin');
      navAdminTop.classList.toggle('hidden', !isAdmin);
    }

    // Sekcja współtworzenia w pasku bocznym – widoczna tylko dla admina i edytora
    const createLink = document.querySelector('.wiki-sidebar .nav-link-create');
    if (createLink) {
      const canEdit = canEditWiki();
      createLink.classList.toggle('hidden', !canEdit);
      const prevTitle = createLink.previousElementSibling;
      if (prevTitle && prevTitle.classList.contains('sidebar-section-title')) {
        prevTitle.classList.toggle('hidden', !canEdit);
      }
    }

    // Statystyki paska bocznego
    const sidebarStatsEl = document.getElementById('sidebar-stats');
    if (sidebarStatsEl) {
      sidebarStatsEl.innerHTML = `
        <div class="stat-row"><span>Hasła</span><span class="stat-number">${state.stats.articlesCount || 0}</span></div>
        <div class="stat-row"><span>Wersje</span><span class="stat-number">${state.stats.revisionsCount || 0}</span></div>
        <div class="stat-row"><span>Wyświetlenia</span><span class="stat-number">${state.stats.totalViews || 0}</span></div>
      `;
    }

    // Kategorie paska bocznego (kompaktowa lista z limitem i linkiem do pełnego spisu)
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

    // Podświetlenie aktywnego linku w sidebarze
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

    if (activeTab === 'read' && tabRead) {
      tabRead.classList.add('active');
      tabRead.setAttribute('aria-selected', 'true');
    }
    if (activeTab === 'talk' && tabTalk) {
      tabTalk.classList.add('active');
      tabTalk.setAttribute('aria-selected', 'true');
    }
    if (activeTab === 'edit' && tabEdit) {
      tabEdit.classList.add('active');
      tabEdit.setAttribute('aria-selected', 'true');
    }
    if (activeTab === 'history' && tabHistory) {
      tabHistory.classList.add('active');
      tabHistory.setAttribute('aria-selected', 'true');
    }

    // Aktualizacja liczników badge
    const revBadge = document.getElementById('rev-count-badge');
    if (revBadge && revCount !== undefined) {
      revBadge.textContent = revCount;
    }
    const talkBadge = document.getElementById('talk-count-badge');
    if (talkBadge && talkCount !== undefined) {
      talkBadge.textContent = talkCount;
    }
  }

  // --- Renderowanie Infoboxu ---
  function renderInfobox(infoboxData, fallbackTitle = '') {
    if (!infoboxData) return '';
    let data = infoboxData;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return '';
      }
    }
    if (!data || typeof data !== 'object') return '';

    const title = data.title || fallbackTitle;
    const rawImage = data.image || '';
    const image = sanitizeImageUrl(rawImage);
    const items = (data.items && typeof data.items === 'object') ? data.items : data;

    let rowsHtml = '';
    for (const [key, val] of Object.entries(items)) {
      if (key === 'title' || key === 'image' || key === 'items') continue;
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
      <aside class="wiki-infobox" aria-label="Informacje encyklopedyczne">
        ${title ? `<div class="wiki-infobox-header infobox-title">${escapeHtml(title)}</div>` : ''}
        ${image ? `<div class="wiki-infobox-image infobox-image"><img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy" /></div>` : ''}
        <table class="infobox-table">
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </aside>
    `;
  }

  // --- Renderowanie spisu treści TOC ---
  function renderToc(toc) {
    if (!toc || !Array.isArray(toc) || toc.length === 0) return '';
    return `
      <nav class="wiki-toc" id="article-toc" aria-label="Spis treści">
        <div class="wiki-toc-header">
          <strong class="wiki-toc-title">Spis treści</strong>
          <button type="button" class="wiki-toc-toggle link-btn" id="toc-toggle-btn" aria-expanded="true" aria-controls="toc-list-ul">[ukryj]</button>
        </div>
        <ul class="toc-list" id="toc-list-ul">
          ${toc.map(item => `
            <li class="toc-item toc-level-${item.level || 2}">
              <a href="#${escapeHtml(item.id)}" class="toc-link">${escapeHtml(item.text)}</a>
            </li>
          `).join('')}
        </ul>
      </nav>
    `;
  }

  // --- WIDOK 1: Strona Główna (#/) ---
  async function renderHomePage() {
    updateArticleTabs(null);
    setPageTitle();
    const viewRoot = document.getElementById('view-root');
    viewRoot.classList.add('view-fade-in');
    viewRoot.innerHTML = '<div class="wiki-loading">Ładowanie encyklopedii...</div>';

    try {
      const data = await api('/api/bootstrap');
      state.settings = data.settings || state.settings;
      state.stats = data.stats || state.stats;
      state.categories = data.categories || state.categories;
      state.allSlugs = data.allSlugs || state.allSlugs;
      if (data.currentUser !== undefined) state.currentUser = data.currentUser;
      updateHeaderAndSidebar();
      setPageTitle();

      const featured = data.featuredArticle;
      const recentArticles = data.recentArticles || [];

      // Ciekawe fakty do ramki "Czy wiesz, że..."
      const didYouKnowFacts = [
        '...że Mikołaj Kopernik w dziele <em>De revolutionibus orbium coelestium</em> sformułował heliocentryczną teorię Układu Słonecznego, wywołując przełom w nowożytnej nauce?',
        '...że Maria Skłodowska-Curie jest jedyną kobietą wyróżnioną dwiema Nagrodami Nobla w dwóch różnych dziedzinach nauk ścisłych: fizyce i chemii?',
        '...że Warszawa stała się stolicą Polski pod koniec XVI wieku po decyzji króla Zygmunta III Wazy o przeniesieniu dworu z Krakowa?',
        '...że język JavaScript powstał w maju 1995 roku w laboratoriach firmy Netscape w zaledwie 10 dni dzięki Brendanowi Eichowi?',
        '...że Polska była jednym z pierwszych krajów na świecie, które wprowadziły konstytucję pisaną (Konstytucja 3 Maja z 1791 r.)?'
      ];

      viewRoot.innerHTML = `
        <div class="main-page-welcome">
          <div class="welcome-banner">
            <div class="welcome-banner-main">
              <h1>Witaj w ${escapeHtml(state.settings.site_name)}</h1>
              <p class="welcome-lead">Otwarta encyklopedia tworzona przez redaktorów.</p>
            </div>
            <div class="welcome-banner-aside">
              <div class="welcome-stat-count"><strong>${state.stats.articlesCount || 0}</strong> haseł encyklopedycznych</div>
              <div class="welcome-links">
                <a href="#/articles">Indeks haseł</a>
                <span class="welcome-sep">&middot;</span>
                <a href="#/categories">Kategorie</a>
                <span class="welcome-sep">&middot;</span>
                <button type="button" id="main-random-btn" class="welcome-link-btn link-btn">Losowy artykuł</button>
                ${canEditWiki() ? `<span class="welcome-sep">&middot;</span><a href="#/new">Utwórz hasło</a>` : ''}
              </div>
            </div>
          </div>
        </div>

        <div class="main-page-grid">
          <!-- Karta Artykułu Wyróżnionego -->
          <div class="main-col-left">
            <section class="main-card card-featured">
              <div class="card-header">
                <h2>Artykuł wyróżniony</h2>
                ${featured ? `<a href="#/wiki/${encodeURIComponent(featured.slug)}" class="card-header-link">${escapeHtml(featured.title)} &rarr;</a>` : ''}
              </div>
              <div class="card-body clearfix">
                ${featured ? `
                  ${renderInfobox(featured.infobox, featured.title)}
                  <h3 class="featured-article-heading"><a href="#/wiki/${encodeURIComponent(featured.slug)}">${escapeHtml(featured.title)}</a></h3>
                  <p class="featured-summary">${escapeHtml(featured.summary || '')}</p>
                  <div class="featured-content-snippet">
                    ${featured.renderedHtml ? (featured.renderedHtml.split(/<h[23]\b/i)[0] || '') : ''}
                  </div>
                  <div class="card-footer-link">
                    <a href="#/wiki/${encodeURIComponent(featured.slug)}">Czytaj cały artykuł &rarr;</a>
                  </div>
                ` : `
                  <p>Obecnie żaden artykuł nie jest oznaczony jako wyróżniony.</p>
                `}
              </div>
            </section>

            <!-- Działy i kategorie -->
            <section class="main-card card-categories">
              <div class="card-header">
                <h2>Działy tematyczne</h2>
                <a href="#/categories" class="card-header-link">Pełny wykaz &rarr;</a>
              </div>
              <div class="card-body">
                <div class="categories-index-list">
                  ${state.categories.length === 0 ? '<p>Brak zdefiniowanych kategorii.</p>' : state.categories.map(cat => {
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

          <!-- Prawa kolumna: Czy wiesz że + Ostatnie zmiany -->
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
                  ${recentArticles.length === 0 ? '<li class="recent-item"><em>Brak ostatnich zmian</em></li>' : recentArticles.slice(0, 6).map(art => {
                    const slug = art.slug || art.article_slug;
                    const title = art.title || slug;
                    return `
                      <li class="recent-item">
                        <a href="#/wiki/${encodeURIComponent(slug)}" class="recent-title">${escapeHtml(title)}</a>
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
            if (r.slug) {
              const targetHash = `#/wiki/${encodeURIComponent(r.slug)}`;
              if (window.location.hash === targetHash) {
                handleRoute();
              } else {
                window.location.hash = targetHash;
              }
            }
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      }

    } catch (err) {
      viewRoot.innerHTML = `
        <div class="wiki-error">
          <p>Nie udało się załadować danych strony głównej: ${escapeHtml(err.message)}</p>
          <button type="button" class="btn btn-secondary" onclick="window.wikiApp.handleRoute()">Spróbuj ponownie</button>
        </div>
      `;
    }
  }

  // --- WIDOK 2: Artykuł (#/wiki/:slug) ---
  async function renderArticleView(slug) {
    const viewRoot = document.getElementById('view-root');
    viewRoot.classList.add('view-fade-in');
    viewRoot.innerHTML = '<div class="wiki-loading">Ładowanie artykułu...</div>';

    try {
      const data = await api(`/api/articles/${encodeURIComponent(slug)}`);
      const art = data.article;
      setPageTitle(art.title);
      updateArticleTabs(slug, 'read', data.revisionsCount, data.talkCount);

      const badgesHtml = [];
      if (art.is_locked) badgesHtml.push('<span class="status-pill locked badge-locked">🔒 Zabezpieczony</span>');
      if (art.is_featured) badgesHtml.push('<span class="status-pill featured badge-featured">⭐ Wyróżniony</span>');
      if (!art.is_published) badgesHtml.push('<span class="status-pill draft badge-unpublished">⚠️ Szkic (Nieopublikowany)</span>');

      const cats = parseCategories(art.categories);

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
              ${art.editor ? `<span>✍️ Ostatni autor: <strong>${escapeHtml(art.editor)}</strong></span>` : ''}
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

          ${cats && cats.length > 0 ? `
            <footer class="wiki-categories-bar" aria-label="Kategorie artykułu">
              <span class="wiki-categories-label cat-label">Kategorie:</span>
              ${cats.map(cName => `
                <a href="#/categories/${encodeURIComponent(cName)}" class="wiki-category-tag">${escapeHtml(cName)}</a>
              `).join(' ')}
            </footer>
          ` : ''}
        </article>
      `;

    } catch (err) {
      updateArticleTabs(null);
      if (err.status === 404) {
        setPageTitle('Strona nie znaleziona');
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
        setPageTitle('Błąd');
        viewRoot.innerHTML = `
          <div class="wiki-error">
            <p>Błąd wczytywania artykułu: ${escapeHtml(err.message)}</p>
            <a href="#/" class="btn btn-secondary">Powrót na stronę główną</a>
          </div>
        `;
      }
    }
  }

  // --- WIDOK 3 i 4: Edytor Artykułu (#/wiki/:slug/edit oraz #/new) ---
  async function renderArticleEditor(slug = null, initialTitle = '') {
    const isNew = !slug;
    const viewRoot = document.getElementById('view-root');
    viewRoot.classList.add('view-fade-in');

    // Sprawdzenie uprawnień edycji: tylko admin i editor
    if (!canEditWiki()) {
      updateArticleTabs(slug || null, 'read');
      setPageTitle('Wymagane uprawnienia redaktora');
      viewRoot.innerHTML = `
        <div class="admin-auth-guard">
          <h2>🔒 Edycja dostępna dla redaktorów</h2>
          <p>Tworzenie i edytowanie artykułów jest dostępne wyłącznie dla zalogowanych użytkowników z rolą <strong>redaktora</strong> lub <strong>administratora</strong>.</p>
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
      infobox: { title: '', items: {} },
      categories: [],
      is_locked: 0
    };

    if (!isNew) {
      try {
        const data = await api(`/api/articles/${encodeURIComponent(slug)}?noView=1`);
        currentArticle = data.article;
        setPageTitle(`Edycja: ${currentArticle.title}`);
        updateArticleTabs(slug, 'edit', data.revisionsCount, data.talkCount);
      } catch (err) {
        showToast(err.message, 'error');
        window.location.hash = '#/';
        return;
      }
    } else {
      setPageTitle(initialTitle ? `Nowy artykuł: ${initialTitle}` : 'Tworzenie nowego artykułu');
      updateArticleTabs(null);
    }

    // Normalizacja infoboxu
    let infoboxObj = { title: currentArticle.title || '', items: {} };
    if (currentArticle.infobox) {
      if (typeof currentArticle.infobox === 'string') {
        try {
          const parsed = JSON.parse(currentArticle.infobox);
          if (parsed && typeof parsed === 'object') {
            infoboxObj = parsed.items ? parsed : { title: currentArticle.title, items: parsed };
          }
        } catch {}
      } else if (typeof currentArticle.infobox === 'object') {
        infoboxObj = currentArticle.infobox.items ? currentArticle.infobox : { title: currentArticle.title, items: currentArticle.infobox };
      }
    }

    // Normalizacja kategorii
    const catsArr = parseCategories(currentArticle.categories);
    const catString = catsArr.join(', ');

    // Ostrzeżenie o blokadzie artykułu
    const isLockedAndNotAdmin = Boolean(currentArticle.is_locked && (!state.currentUser || state.currentUser.role !== 'admin'));

    viewRoot.innerHTML = `
      <div class="editor-container">
        <header class="editor-header">
          <h1>${isNew ? '➕ Tworzenie nowego artykułu' : `✏️ Edycja: ${escapeHtml(currentArticle.title)}`}</h1>
          <p class="editor-lead">Formatuj treść w składni wikikodu (np. <code>== Nagłówek ==</code>, <code>'''pogrubienie'''</code>, <code>[[Link]]</code>, <code>&lt;ref&gt;źródło&lt;/ref&gt;</code>). Skrót <strong>Ctrl+S</strong> zapisuje stronę.</p>
          ${isLockedAndNotAdmin ? `
            <div class="alert alert-warning" role="alert">
              🔒 <strong>Artykuł zabezpieczony:</strong> Ten artykuł może edytować wyłącznie administrator. Pola edycyjne zostały zablokowane.
            </div>
          ` : ''}
        </header>

        <form id="article-editor-form" class="editor-form">
          <div class="form-group">
            <label for="edit-title">Tytuł hasła: <span class="required">*</span></label>
            <input type="text" id="edit-title" class="form-control" value="${escapeHtml(currentArticle.title)}" placeholder="Np. Komputer kwantowy" required ${isLockedAndNotAdmin ? 'disabled' : ''} />
          </div>

          <div class="form-group">
            <label for="edit-summary">Krótkie podsumowanie (zajawka):</label>
            <input type="text" id="edit-summary" class="form-control" value="${escapeHtml(currentArticle.summary || '')}" placeholder="Jednozdaniowe podsumowanie artykułu" ${isLockedAndNotAdmin ? 'disabled' : ''} />
          </div>

          <div class="form-group">
            <label for="edit-categories">Kategorie (oddzielone przecinkami):</label>
            <input type="text" id="edit-categories" class="form-control" value="${escapeHtml(catString)}" placeholder="Np. Informatyka, Fizyka, Technologia" ${isLockedAndNotAdmin ? 'disabled' : ''} />
          </div>

          <!-- Pasek narzędzi formatowania -->
          <div class="editor-toolbar" role="toolbar" aria-label="Narzędzia formatowania">
            <button type="button" class="toolbar-btn btn-tool" data-action="heading" title="Wstaw nagłówek sekcji (==)"><strong>H2</strong> Nagłówek</button>
            <button type="button" class="toolbar-btn btn-tool" data-action="subheading" title="Wstaw podnagłówek (===)"><strong>H3</strong> Podnagłówek</button>
            <button type="button" class="toolbar-btn btn-tool" data-action="bold" title="Pogrubienie ('''tekst''')"><strong>B</strong> Pogrubienie</button>
            <button type="button" class="toolbar-btn btn-tool" data-action="italic" title="Kursywa (''tekst'')"><em>I</em> Kursywa</button>
            <button type="button" class="toolbar-btn btn-tool" data-action="link" title="Wstaw link wewnętrzny ([[...]])">🔗 Link [[...]]</button>
            <button type="button" class="toolbar-btn btn-tool" data-action="ref" title="Wstaw przypis (&lt;ref&gt;...&lt;/ref&gt;)">📑 Przypis</button>
            <button type="button" class="toolbar-btn btn-tool" data-action="bullet" title="Lista punktowana (*)">• Lista</button>
            <button type="button" class="toolbar-btn btn-tool" data-action="infobox-helper" title="Dodaj wiersz infoboksu">ℹ️ Pomocnik Infoboksu</button>
          </div>

          <div class="form-group">
            <label for="edit-content">Treść artykułu (wikikod): <span class="required">*</span></label>
            <textarea id="edit-content" class="editor-textarea form-control" rows="18" placeholder="Wpisz treść artykułu w wikikodzie..." ${isLockedAndNotAdmin ? 'disabled' : ''}>${escapeHtml(currentArticle.content || '')}</textarea>
          </div>

          <!-- Sekcja edytora infoboxu -->
          <fieldset class="infobox-editor-fieldset" ${isLockedAndNotAdmin ? 'disabled' : ''}>
            <legend>ℹ️ Infobox (tabela boczna)</legend>
            <div class="form-group">
              <label for="infobox-title">Tytuł infoboksu:</label>
              <input type="text" id="infobox-title" class="form-control" value="${escapeHtml(infoboxObj.title || currentArticle.title || '')}" />
            </div>
            <div class="form-group">
              <label for="infobox-image">Adres URL obrazka (opcjonalny):</label>
              <input type="url" id="infobox-image" class="form-control" value="${escapeHtml(infoboxObj.image || '')}" placeholder="https://..." />
            </div>
            <div class="infobox-rows-label">Pola infoboksu (klucz &rarr; wartość):</div>
            <div id="infobox-rows-container" class="infobox-editor-grid"></div>
            <button type="button" id="infobox-add-row-btn" class="btn btn-sm btn-outline">+ Dodaj pole infoboxu</button>
          </fieldset>

          <div class="form-group">
            <label for="edit-comment">Opis zmian (komentarz do wersji):</label>
            <input type="text" id="edit-comment" class="form-control" placeholder="Np. 'Utworzenie hasła', 'Korekta literówki', 'Rozszerzenie sekcji'" value="${isNew ? 'Utworzenie artykułu' : ''}" ${isLockedAndNotAdmin ? 'disabled' : ''} />
          </div>

          <div class="editor-actions">
            <button type="button" id="editor-preview-btn" class="btn btn-secondary">👁️ Podgląd na żywo</button>
            <button type="submit" id="editor-save-btn" class="btn btn-primary" ${isLockedAndNotAdmin ? 'disabled title="Artykuł zablokowany"' : ''}>💾 ${isNew ? 'Utwórz artykuł' : 'Zapisz zmiany'}</button>
            <a href="${isNew ? '#/' : `#/wiki/${encodeURIComponent(slug)}`}" class="btn btn-outline">Anuluj</a>
          </div>
        </form>

        <!-- Pudełko podglądu -->
        <div id="preview-wrapper" class="preview-wrapper hidden" aria-live="polite">
          <div class="preview-box-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h2>Podgląd artykułu</h2>
            <button type="button" id="preview-close-btn" class="btn btn-sm btn-outline">Zamknij podgląd &times;</button>
          </div>
          <div id="preview-box" class="preview-box wiki-article-body-wrapper"></div>
        </div>
      </div>
    `;

    // Obsługa wierszy infoboxu
    const infoboxContainer = document.getElementById('infobox-rows-container');
    const items = infoboxObj.items || {};

    function addInfoboxRow(key = '', val = '') {
      const row = document.createElement('div');
      row.className = 'infobox-row-item';
      row.innerHTML = `
        <input type="text" class="form-control info-key" placeholder="Etykieta (np. Stolica)" value="${escapeHtml(key)}" ${isLockedAndNotAdmin ? 'disabled' : ''} />
        <input type="text" class="form-control info-val" placeholder="Wartość (np. Warszawa)" value="${escapeHtml(val)}" ${isLockedAndNotAdmin ? 'disabled' : ''} />
        <button type="button" class="btn btn-danger btn-sm info-del" title="Usuń pole" ${isLockedAndNotAdmin ? 'disabled' : ''}>&times;</button>
      `;
      row.querySelector('.info-del').addEventListener('click', () => {
        row.remove();
      });
      infoboxContainer.appendChild(row);
    }

    const existingEntries = Object.entries(items);
    if (existingEntries.length > 0) {
      existingEntries.forEach(([k, v]) => addInfoboxRow(k, v));
    } else {
      addInfoboxRow('', '');
    }

    document.getElementById('infobox-add-row-btn').addEventListener('click', () => {
      addInfoboxRow('', '');
    });

    // Pasek narzędzi
    const textarea = document.getElementById('edit-content');
    function insertAroundSelection(before, after = '') {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selText = textarea.value.substring(start, end);
      const replacement = before + (selText || 'tekst') + after;
      textarea.value = textarea.value.substring(0, start) + replacement + textarea.value.substring(end);
      textarea.focus();
      textarea.selectionStart = start + before.length;
      textarea.selectionEnd = textarea.selectionStart + (selText.length || 5);
    }

    document.querySelectorAll('.editor-toolbar .toolbar-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'heading') insertAroundSelection('\n== ', ' ==\n');
        if (action === 'subheading') insertAroundSelection('\n=== ', ' ===\n');
        if (action === 'bold') insertAroundSelection("'''", "'''");
        if (action === 'italic') insertAroundSelection("''", "''");
        if (action === 'link') insertAroundSelection('[[', ']]');
        if (action === 'ref') insertAroundSelection('<ref>', '</ref>');
        if (action === 'bullet') insertAroundSelection('\n* ');
        if (action === 'infobox-helper') {
          addInfoboxRow('Klucz', 'Wartość');
          showToast('Dodano pole do infoboksu poniżej', 'info');
        }
      });
    });

    // Skróty klawiszowe w edytorze (Ctrl+S, Ctrl+B, Ctrl+I)
    const editorForm = document.getElementById('article-editor-form');
    textarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        insertAroundSelection("'''", "'''");
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        insertAroundSelection("''", "''");
      }
    });

    editorForm.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!isLockedAndNotAdmin) {
          editorForm.requestSubmit();
        }
      }
    });

    // Zbieranie danych infoboxu z formularza
    function collectInfoboxData() {
      const title = document.getElementById('infobox-title').value.trim();
      const image = sanitizeImageUrl(document.getElementById('infobox-image').value.trim());
      const collectedItems = {};
      infoboxContainer.querySelectorAll('.infobox-row-item').forEach(row => {
        const k = row.querySelector('.info-key').value.trim();
        const v = row.querySelector('.info-val').value.trim();
        if (k && v) {
          collectedItems[k] = v;
        }
      });
      if (!title && !image && Object.keys(collectedItems).length === 0) {
        return null;
      }
      return {
        title: title || document.getElementById('edit-title').value.trim(),
        image: image || undefined,
        items: collectedItems
      };
    }

    // Podgląd na żywo
    document.getElementById('editor-preview-btn').addEventListener('click', async () => {
      const content = textarea.value;
      const title = document.getElementById('edit-title').value.trim() || 'Podgląd';
      const previewWrapper = document.getElementById('preview-wrapper');
      const previewBox = document.getElementById('preview-box');

      try {
        const res = await api('/api/preview', {
          method: 'POST',
          body: { content, title }
        });
        const currentInfobox = collectInfoboxData();
        previewBox.innerHTML = `
          ${renderInfobox(currentInfobox, title)}
          ${renderToc(res.toc)}
          <div class="wiki-article-body">${res.renderedHtml || '<p><em>Pusta treść</em></p>'}</div>
        `;
        previewWrapper.classList.remove('hidden');
        previewWrapper.scrollIntoView({ behavior: 'smooth' });
      } catch (err) {
        showToast('Błąd podglądu: ' + err.message, 'error');
      }
    });

    document.getElementById('preview-close-btn')?.addEventListener('click', () => {
      document.getElementById('preview-wrapper')?.classList.add('hidden');
    });

    // Zapis formularza
    editorForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isLockedAndNotAdmin) {
        showToast('Artykuł jest zabezpieczony. Brak uprawnień do zapisu.', 'error');
        return;
      }

      const title = document.getElementById('edit-title').value.trim();
      const summary = document.getElementById('edit-summary').value.trim();
      const content = textarea.value.trim();
      const rawCats = document.getElementById('edit-categories').value;
      const edit_comment = document.getElementById('edit-comment').value.trim();

      if (!title) {
        showToast('Podaj tytuł artykułu', 'warning');
        document.getElementById('edit-title').focus();
        return;
      }
      if (!content) {
        showToast('Wpisz treść artykułu', 'warning');
        textarea.focus();
        return;
      }

      const categories = rawCats
        .split(',')
        .map(c => c.trim())
        .filter(c => c.length > 0);

      const infobox = collectInfoboxData();
      const saveBtn = document.getElementById('editor-save-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Zapisywanie...';

      try {
        if (isNew) {
          const res = await api('/api/articles', {
            method: 'POST',
            body: { title, summary, content, infobox, categories, edit_comment: edit_comment || 'Utworzenie artykułu' }
          });
          showToast('Artykuł został pomyślnie utworzony!', 'success');
          window.location.hash = `#/wiki/${encodeURIComponent(res.article.slug)}`;
        } else {
          const res = await api(`/api/articles/${encodeURIComponent(slug)}`, {
            method: 'PUT',
            body: { title, summary, content, infobox, categories, edit_comment: edit_comment || 'Edycja artykułu' }
          });
          showToast('Zmiany w artykule zostały zapisane!', 'success');
          window.location.hash = `#/wiki/${encodeURIComponent(res.article.slug)}`;
        }
      } catch (err) {
        showToast(err.message, 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = isNew ? '💾 Utwórz artykuł' : '💾 Zapisz zmiany';
      }
    });
  }

  // --- WIDOK 5: Dyskusja artykułu (#/wiki/:slug/talk) ---
  async function renderTalkView(slug) {
    const viewRoot = document.getElementById('view-root');
    viewRoot.classList.add('view-fade-in');
    viewRoot.innerHTML = '<div class="wiki-loading">Ładowanie dyskusji...</div>';

    try {
      const artData = await api(`/api/articles/${encodeURIComponent(slug)}?noView=1`);
      const talkData = await api(`/api/articles/${encodeURIComponent(slug)}/talk`);
      const messages = talkData.messages || [];

      setPageTitle(`Dyskusja: ${artData.article.title}`);
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
                <div class="talk-message-header talk-msg-header">
                  <span class="talk-message-author talk-author">💬 <strong>${escapeHtml(msg.author || 'Anonim')}</strong></span>
                  <span class="talk-message-date talk-date">${formatDate(msg.created_at)}</span>
                </div>
                <div class="talk-message-content talk-msg-content">${escapeHtml(msg.content)}</div>
              </div>
            `).join('')}
          </div>

          <!-- Formularz dodania wypowiedzi -->
          <div class="talk-form-card">
            <h3>Dodaj nową wypowiedź do wątku</h3>
            <form id="talk-add-form" class="talk-form">
              <div class="form-group">
                <label for="talk-author-input">Twój podpis / autor:</label>
                <input type="text" id="talk-author-input" class="form-control" value="${escapeHtml(state.currentUser ? state.currentUser.username : '')}" placeholder="Podpis (lub pozostaw puste dla Anonim)" ${state.currentUser ? 'readonly' : ''} />
              </div>
              <div class="form-group">
                <label for="talk-content-input">Treść wiadomości: <span class="required">*</span></label>
                <textarea id="talk-content-input" class="form-control" rows="4" placeholder="Wpisz treść swojej uwagi lub propozycji do artykułu..." required></textarea>
              </div>
              <button type="submit" id="talk-submit-btn" class="btn btn-primary">Wyślij wypowiedź</button>
            </form>
          </div>
        </div>
      `;

      const talkForm = document.getElementById('talk-add-form');
      talkForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const author = document.getElementById('talk-author-input').value.trim() || (state.currentUser ? state.currentUser.username : 'Anonim');
        const content = document.getElementById('talk-content-input').value.trim();

        if (!content) {
          showToast('Wpisz treść wiadomości przed wysłaniem', 'warning');
          document.getElementById('talk-content-input').focus();
          return;
        }

        const submitBtn = document.getElementById('talk-submit-btn');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Wysyłanie...';

        try {
          await api(`/api/articles/${encodeURIComponent(slug)}/talk`, {
            method: 'POST',
            body: { author, content }
          });
          showToast('Wypowiedź została dodana do dyskusji!', 'success');
          renderTalkView(slug);
        } catch (err) {
          showToast(err.message, 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Wyślij wypowiedź';
        }
      });

    } catch (err) {
      updateArticleTabs(null);
      viewRoot.innerHTML = `
        <div class="wiki-error">
          <p>Błąd wczytywania dyskusji: ${escapeHtml(err.message)}</p>
          <a href="#/" class="btn btn-secondary">Powrót na stronę główną</a>
        </div>
      `;
    }
  }

  // --- WIDOK 6: Historia i Diff (#/wiki/:slug/history) ---
  async function renderHistoryView(slug) {
    const viewRoot = document.getElementById('view-root');
    viewRoot.classList.add('view-fade-in');
    viewRoot.innerHTML = '<div class="wiki-loading">Ładowanie historii wersji...</div>';

    try {
      const data = await api(`/api/articles/${encodeURIComponent(slug)}/revisions`);
      const revisions = data.revisions || [];
      const art = data.article || { title: slug, slug };

      setPageTitle(`Historia zmian: ${art.title}`);
      updateArticleTabs(slug, 'history', revisions.length);

      viewRoot.innerHTML = `
        <div class="history-page">
          <header class="history-header">
            <h1>Historia zmian: ${escapeHtml(art.title)}</h1>
            <p>Przeglądaj wcześniejsze wersje artykułu, porównuj różnice linia po linii lub przywracaj wybrane rewizje.</p>
          </header>

          ${revisions.length === 0 ? `
            <p>Brak zarejestrowanych wersji dla tego artykułu.</p>
          ` : `
            <div class="history-controls">
              <button type="button" id="compare-diff-btn" class="btn btn-secondary">🔍 Porównaj wybrane wersje</button>
            </div>

            <!-- Kontener na wynik porównania diff -->
            <div id="diff-output-container" class="diff-container hidden" aria-live="polite"></div>

            <div class="revision-list">
              ${revisions.map((rev, idx) => `
                <div class="revision-item ${idx === 0 ? 'current' : ''}" data-id="${rev.id}">
                  <div class="revision-meta">
                    <div class="revision-radios">
                      <label title="Wersja bazowa (od)"><input type="radio" name="diff-from" value="${rev.id}" ${idx === 1 ? 'checked' : ''} aria-label="Porównaj od wersji #${rev.id}" /></label>
                      <label title="Wersja porównywana (do)"><input type="radio" name="diff-to" value="${rev.id}" ${idx === 0 ? 'checked' : ''} aria-label="Porównaj do wersji #${rev.id}" /></label>
                    </div>
                    <span class="revision-date"><strong>${formatDate(rev.created_at)}</strong></span>
                    <span class="revision-author">${escapeHtml(rev.editor || 'Anonim')}</span>
                    <span class="revision-comment">${escapeHtml(rev.edit_comment ? `„${rev.edit_comment}”` : '(brak komentarza)')}</span>
                    ${idx === 0 ? '<span class="status-pill draft" style="font-size:0.75rem;">Aktualna</span>' : ''}
                  </div>
                  <div class="revision-actions">
                    ${(canEditWiki() && idx > 0) ? `
                      <button type="button" class="btn btn-sm btn-outline revert-btn" data-id="${rev.id}" data-comment="${escapeHtml(rev.edit_comment || '')}">⏪ Przywróć</button>
                    ` : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      `;

      // Obsługa przycisku porównania diff
      const compareBtn = document.getElementById('compare-diff-btn');
      if (compareBtn) {
        compareBtn.addEventListener('click', async () => {
          const fromInput = document.querySelector('input[name="diff-from"]:checked');
          const toInput = document.querySelector('input[name="diff-to"]:checked');

          if (!fromInput || !toInput) {
            showToast('Wybierz dwie wersje do porównania', 'warning');
            return;
          }

          const fromId = fromInput.value;
          const toId = toInput.value;

          if (fromId === toId) {
            showToast('Wybierz dwie różne wersje do porównania', 'warning');
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

      // Obsługa przycisków przywracania rewizji
      document.querySelectorAll('.revert-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const revId = btn.dataset.id;
          if (!confirm(`Czy na pewno chcesz przywrócić artykuł do wersji #${revId}?`)) {
            return;
          }

          btn.disabled = true;
          try {
            await api(`/api/articles/${encodeURIComponent(slug)}/revert`, {
              method: 'POST',
              body: { revisionId: revId }
            });
            showToast('Artykuł został pomyślnie przywrócony!', 'success');
            window.location.hash = `#/wiki/${encodeURIComponent(slug)}`;
          } catch (err) {
            btn.disabled = false;
            showToast(err.message, 'error');
          }
        });
      });

    } catch (err) {
      updateArticleTabs(null);
      viewRoot.innerHTML = `
        <div class="wiki-error">
          <p>Błąd wczytywania historii: ${escapeHtml(err.message)}</p>
          <a href="#/" class="btn btn-secondary">Powrót na stronę główną</a>
        </div>
      `;
    }
  }

  // Pomocnik renderowania tabeli Diff
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

      diffLinesHtml += `
        <tr class="${lineClass}">
          <td class="diff-sign" aria-hidden="true">${sign}</td>
          <td class="diff-code"><pre>${escapeHtml(item.line || '')}</pre></td>
        </tr>
      `;
    });

    container.innerHTML = `
      <div class="diff-box">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <h3>Porównanie wersji</h3>
          <button type="button" id="diff-close-btn" class="btn btn-sm btn-outline">Zamknij diff &times;</button>
        </div>
        <div class="diff-header-info">
          <div class="diff-ver-box">
            <strong>Wersja bazowa (#${fromRev.id || '?'}):</strong> ${formatDate(fromRev.created_at)} przez <em>${escapeHtml(fromRev.editor || 'Anonim')}</em>
          </div>
          <div class="diff-ver-box">
            <strong>Wersja porównywana (#${toRev.id || '?'}):</strong> ${formatDate(toRev.created_at)} przez <em>${escapeHtml(toRev.editor || 'Anonim')}</em>
          </div>
        </div>
        <table class="diff-table">
          <tbody>
            ${diffLinesHtml || '<tr><td colspan="2">Brak różnic w tekście.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('diff-close-btn')?.addEventListener('click', () => {
      container.classList.add('hidden');
    });
  }

  // --- WIDOK 7: Katalog Artykułów (#/articles) ---
  async function renderArticlesCatalog(query = '', selectedCategory = '') {
    updateArticleTabs(null);
    setPageTitle('Indeks artykułów');
    const viewRoot = document.getElementById('view-root');
    viewRoot.classList.add('view-fade-in');
    viewRoot.innerHTML = '<div class="wiki-loading">Ładowanie katalogu artykułów...</div>';

    try {
      const qParam = query ? `&q=${encodeURIComponent(query)}` : '';
      const catParam = selectedCategory ? `&category=${encodeURIComponent(selectedCategory)}` : '';
      const data = await api(`/api/articles?includeUnpublished=1${qParam}${catParam}`);
      const articles = data.articles || [];

      viewRoot.innerHTML = `
        <div class="articles-catalog-page">
          <header class="catalog-header">
            <div class="catalog-header-row">
              <div>
                <h1>Indeks artykułów</h1>
                <p>Spis haseł encyklopedycznych z filtrowaniem według nazwy i działu.</p>
              </div>
              ${canEditWiki() ? '<a href="#/new" class="catalog-create-link btn btn-primary btn-sm">+ Utwórz nowe hasło</a>' : ''}
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
            <button id="catalog-filter-btn" type="button" class="btn btn-secondary">Filtruj</button>
            ${(query || selectedCategory) ? '<button id="catalog-reset-btn" type="button" class="btn btn-outline">Wyczyść filtry</button>' : ''}
          </div>

          <div class="catalog-results-info">
            Liczba haseł: <strong>${articles.length}</strong>
          </div>

          <div class="catalog-articles-grid">
            ${articles.length === 0 ? `
              <div class="catalog-empty">
                <p>Nie znaleziono żadnych artykułów spełniających podane kryteria.</p>
                ${(query && canEditWiki()) ? `
                  <p><a href="#/new?title=${encodeURIComponent(query)}" class="btn btn-primary btn-sm">➕ Utwórz hasło: „${escapeHtml(query)}”</a></p>
                ` : ''}
              </div>
            ` : articles.map(art => {
              const cats = parseCategories(art.categories);
              return `
                <article class="catalog-article-card">
                  <div class="catalog-card-main">
                    <div class="catalog-card-header">
                      <h3><a href="#/wiki/${encodeURIComponent(art.slug)}">${art.is_featured ? '<span class="featured-star" title="Artykuł wyróżniony">★</span> ' : ''}${escapeHtml(art.title)}</a></h3>
                      <div class="catalog-card-badges">
                        ${art.is_featured ? '<span class="catalog-tag catalog-tag-featured">★ Wyróżniony</span>' : ''}
                        ${art.is_locked ? '<span class="catalog-tag">Zabezpieczony</span>' : ''}
                        ${!art.is_published ? '<span class="catalog-tag catalog-tag-draft">Szkic</span>' : ''}
                      </div>
                    </div>
                    <p class="catalog-card-summary">${escapeHtml(art.summary || 'Brak podsumowania.')}</p>
                    <div class="catalog-card-footer">
                      ${cats && cats.length > 0 ? `
                        <div class="catalog-card-cats">
                          <span class="catalog-cats-label">Kategorie:</span>
                          ${cats.map(cName => `
                            <a href="#/categories/${encodeURIComponent(cName)}" class="badge-cat">${escapeHtml(cName)}</a>
                          `).join('<span class="catalog-sep">·</span>')}
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
            }).join('')}
          </div>
        </div>
      `;

      // Eventy filtracji
      const filterBtn = document.getElementById('catalog-filter-btn');
      const resetBtn = document.getElementById('catalog-reset-btn');
      const searchInput = document.getElementById('catalog-search-input');
      const categorySelect = document.getElementById('catalog-category-select');

      const triggerFilter = () => {
        const q = searchInput.value.trim();
        const cat = categorySelect.value;
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        if (cat) params.set('category', cat);
        const queryStr = params.toString() ? '?' + params.toString() : '';
        window.location.hash = `#/articles${queryStr}`;
      };

      filterBtn.addEventListener('click', triggerFilter);
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') triggerFilter();
      });
      categorySelect.addEventListener('change', triggerFilter);
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          window.location.hash = '#/articles';
        });
      }

    } catch (err) {
      viewRoot.innerHTML = `
        <div class="wiki-error">
          <p>Błąd wczytywania katalogu: ${escapeHtml(err.message)}</p>
          <a href="#/" class="btn btn-secondary">Powrót na stronę główną</a>
        </div>
      `;
    }
  }

  // --- WIDOK 8: Kategorie (#/categories oraz #/categories/:category) ---
  async function renderCategoriesView(selectedCategory = null) {
    updateArticleTabs(null);
    const viewRoot = document.getElementById('view-root');
    viewRoot.classList.add('view-fade-in');
    viewRoot.innerHTML = '<div class="wiki-loading">Ładowanie kategorii...</div>';

    try {
      if (!selectedCategory) {
        setPageTitle('Kategorie encyklopedii');
        const bootData = await api('/api/bootstrap');
        const cats = bootData.categories || [];

        viewRoot.innerHTML = `
          <div class="categories-overview-page">
            <header class="cat-page-header">
              <h1>Kategorie encyklopedii</h1>
              <p>Alfabetyczny i tematyczny wykaz działów WikiKurekk (${cats.length}).</p>
            </header>

            <div class="categories-large-grid">
              ${cats.length === 0 ? '<p>Brak zdefiniowanych kategorii w encyklopedii.</p>' : cats.map(cat => {
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
        setPageTitle(`Kategoria: ${selectedCategory}`);
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
              ` : articles.map(art => {
                const cats = parseCategories(art.categories);
                return `
                  <article class="catalog-article-card">
                    <div class="catalog-card-main">
                      <div class="catalog-card-header">
                        <h3><a href="#/wiki/${encodeURIComponent(art.slug)}">${art.is_featured ? '<span class="featured-star" title="Artykuł wyróżniony">★</span> ' : ''}${escapeHtml(art.title)}</a></h3>
                        <div class="catalog-card-badges">
                          ${art.is_featured ? '<span class="catalog-tag catalog-tag-featured">★ Wyróżniony</span>' : ''}
                          ${art.is_locked ? '<span class="catalog-tag">Zabezpieczony</span>' : ''}
                        </div>
                      </div>
                      <p class="catalog-card-summary">${escapeHtml(art.summary || 'Brak podsumowania.')}</p>
                      <div class="catalog-card-footer">
                        ${cats && cats.length > 0 ? `
                          <div class="catalog-card-cats">
                            <span class="catalog-cats-label">Kategorie:</span>
                            ${cats.map(cName => `
                              <a href="#/categories/${encodeURIComponent(cName)}" class="badge-cat">${escapeHtml(cName)}</a>
                            `).join('<span class="catalog-sep">·</span>')}
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
              }).join('')}
            </div>
          </div>
        `;
      }
    } catch (err) {
      viewRoot.innerHTML = `
        <div class="wiki-error">
          <p>Błąd wczytywania kategorii: ${escapeHtml(err.message)}</p>
          <a href="#/categories" class="btn btn-secondary">&larr; Wszystkie kategorie</a>
        </div>
      `;
    }
  }

  // --- WIDOK 9: Ostatnie Zmiany (#/recent-changes) ---
  async function renderRecentChangesView() {
    updateArticleTabs(null);
    setPageTitle('Ostatnie zmiany');
    const viewRoot = document.getElementById('view-root');
    viewRoot.classList.add('view-fade-in');
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
                    <span class="change-art-title"><a href="#/wiki/${encodeURIComponent(slug)}">${escapeHtml(title)}</a></span>
                    <span class="change-author">przez <strong>${escapeHtml(ch.editor || 'Anonim')}</strong></span>
                    <div class="change-comment"><em>„${escapeHtml(ch.edit_comment || 'Aktualizacja treści')}”</em></div>
                  </div>
                  <div class="change-links">
                    <a href="#/wiki/${encodeURIComponent(slug)}/history" class="btn btn-sm btn-outline">Historia</a>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    } catch (err) {
      viewRoot.innerHTML = `
        <div class="wiki-error">
          <p>Błąd wczytywania ostatnich zmian: ${escapeHtml(err.message)}</p>
          <a href="#/" class="btn btn-secondary">Powrót na stronę główną</a>
        </div>
      `;
    }
  }

  // --- WIDOK 10: Panel Administracyjny (#/panel) ---
  async function renderAdminPanel() {
    updateArticleTabs(null);
    setPageTitle('Panel administracyjny');
    const viewRoot = document.getElementById('view-root');
    viewRoot.classList.add('view-fade-in');

    // Sprawdzenie czy użytkownik to admin
    if (!state.currentUser || state.currentUser.role !== 'admin') {
      viewRoot.innerHTML = `
        <div class="admin-auth-guard">
          <h2>🔒 Wymagane logowanie administratora</h2>
          <p>Ta strona jest dostępna wyłącznie dla uprawnionych administratorów witryny.</p>
          ${state.currentUser
            ? '<p>Twoje konto nie posiada roli administratora.</p>'
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

      // Render struktury panelu
      viewRoot.innerHTML = `
        <div class="admin-dashboard">
          <header class="admin-header">
            <div class="admin-title-row">
              <h1>Panel administracyjny</h1>
              <span class="user-role-badge">Administrator: <strong>${escapeHtml(state.currentUser.username)}</strong></span>
            </div>
            <p class="admin-lead">Zarządzanie hasłami, uprawnieniami kont, dyskusjami, konfiguracją witryny oraz dziennikiem zdarzeń.</p>
          </header>

          <!-- Pasek zakładek panelu admina -->
          <nav class="admin-tabs" role="tablist" aria-label="Kategorie panelu">
            <button class="admin-tab-btn ${state.adminActiveTab === 'kpi' ? 'active' : ''}" data-tab="kpi" role="tab">Podsumowanie</button>
            <button class="admin-tab-btn ${state.adminActiveTab === 'articles' ? 'active' : ''}" data-tab="articles" role="tab">Artykuły (${articles.length})</button>
            <button class="admin-tab-btn ${state.adminActiveTab === 'users' ? 'active' : ''}" data-tab="users" role="tab">Użytkownicy (${users.length})</button>
            <button class="admin-tab-btn ${state.adminActiveTab === 'talk' ? 'active' : ''}" data-tab="talk" role="tab">Dyskusje (${talkMessages.length})</button>
            <button class="admin-tab-btn ${state.adminActiveTab === 'settings' ? 'active' : ''}" data-tab="settings" role="tab">Ustawienia</button>
            <button class="admin-tab-btn ${state.adminActiveTab === 'audit' ? 'active' : ''}" data-tab="audit" role="tab">Dziennik zdarzeń</button>
          </nav>

          <!-- Zawartość zakładek -->
          <div id="admin-tab-content" class="admin-tab-content" aria-live="polite"></div>
        </div>
      `;

      const tabContent = document.getElementById('admin-tab-content');

      // Funkcja renderująca wybraną podzakładkę
      const renderCurrentAdminSubTab = () => {
        document.querySelectorAll('.admin-tab-btn').forEach(btn => {
          if (btn.dataset.tab === state.adminActiveTab) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
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
                <button type="button" class="btn btn-secondary switch-to-tab" data-target="articles">Zarządzaj artykułami i wyróżnieniami</button>
                <button type="button" class="btn btn-secondary switch-to-tab" data-target="users">Zarządzaj kontami i rolami</button>
                <button type="button" class="btn btn-secondary switch-to-tab" data-target="settings">Konfiguracja witryny</button>
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
              <div class="admin-section-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
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
                        <td><strong><a href="#/wiki/${encodeURIComponent(art.slug)}">${art.is_featured ? '<span class="featured-star" title="Artykuł wyróżniony">★</span> ' : ''}${escapeHtml(art.title)}</a></strong></td>
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
                            <a href="#/wiki/${encodeURIComponent(art.slug)}/edit" class="btn btn-sm btn-secondary">Edytuj</a>
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

          // Handlery artykułów
          tabContent.querySelectorAll('.toggle-lock-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const slug = btn.dataset.slug;
              const isLocked = btn.dataset.status === '1';
              btn.disabled = true;
              try {
                await api(`/api/admin/articles/${encodeURIComponent(slug)}/status`, {
                  method: 'PATCH',
                  body: { is_locked: !isLocked }
                });
                showToast(`Zmieniono status blokady dla: ${slug}`, 'success');
                renderAdminPanel();
              } catch (err) {
                btn.disabled = false;
                showToast(err.message, 'error');
              }
            });
          });

          tabContent.querySelectorAll('.toggle-feature-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const slug = btn.dataset.slug;
              const isFeatured = btn.dataset.status === '1';
              btn.disabled = true;
              try {
                await api(`/api/admin/articles/${encodeURIComponent(slug)}/status`, {
                  method: 'PATCH',
                  body: { is_featured: !isFeatured }
                });
                showToast(`Zaktualizowano wyróżnienie artykułu: ${slug}`, 'success');
                renderAdminPanel();
              } catch (err) {
                btn.disabled = false;
                showToast(err.message, 'error');
              }
            });
          });

          tabContent.querySelectorAll('.toggle-publish-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const slug = btn.dataset.slug;
              const isPublished = btn.dataset.status === '1';
              btn.disabled = true;
              try {
                await api(`/api/admin/articles/${encodeURIComponent(slug)}/status`, {
                  method: 'PATCH',
                  body: { is_published: !isPublished }
                });
                showToast(`Zmieniono widoczność artykułu: ${slug}`, 'success');
                renderAdminPanel();
              } catch (err) {
                btn.disabled = false;
                showToast(err.message, 'error');
              }
            });
          });

          tabContent.querySelectorAll('.delete-article-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const slug = btn.dataset.slug;
              const title = btn.dataset.title;
              if (!confirm(`Czy na pewno chcesz BEZPOWROTNIE usunąć artykuł „${title}”?`)) {
                return;
              }
              btn.disabled = true;
              try {
                await api(`/api/admin/articles/${encodeURIComponent(slug)}`, {
                  method: 'DELETE'
                });
                showToast(`Artykuł „${title}” został usunięty`, 'success');
                renderAdminPanel();
              } catch (err) {
                btn.disabled = false;
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
                        <td><span class="user-role-pill role-${u.role}">${escapeHtml(u.role)}</span></td>
                        <td><em>${escapeHtml(u.bio || '')}</em></td>
                        <td>
                          <select class="form-control role-select" data-id="${u.id}" ${u.id === (state.currentUser ? state.currentUser.id : null) ? 'disabled title="Nie możesz zmienić własnej roli"' : ''}>
                            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrator (admin)</option>
                            <option value="editor" ${u.role === 'editor' ? 'selected' : ''}>Redaktor (editor)</option>
                            <option value="blocked" ${u.role === 'blocked' ? 'selected' : ''}>Zablokowany (blocked)</option>
                          </select>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>

              <!-- Formularz dodawania nowego użytkownika -->
              <div class="admin-subcard add-user-card" style="margin-top:24px;">
                <h3>➕ Utwórz nowe konto użytkownika</h3>
                <form id="admin-add-user-form" class="admin-form-grid">
                  <div class="form-group">
                    <label for="new-user-username">Nazwa użytkownika: <span class="required">*</span></label>
                    <input type="text" id="new-user-username" class="form-control" placeholder="Login (min. 2 znaki)" required autocomplete="off" />
                  </div>
                  <div class="form-group">
                    <label for="new-user-password">Hasło: <span class="required">*</span></label>
                    <input type="password" id="new-user-password" class="form-control" placeholder="Hasło (min. 3 znaki)" required autocomplete="new-password" />
                  </div>
                  <div class="form-group">
                    <label for="new-user-role">Rola:</label>
                    <select id="new-user-role" class="form-control">
                      <option value="editor">Redaktor (editor)</option>
                      <option value="admin">Administrator (admin)</option>
                      <option value="blocked">Zablokowany (blocked)</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label for="new-user-bio">Opis / Notatka:</label>
                    <input type="text" id="new-user-bio" class="form-control" placeholder="Krótki opis konta" />
                  </div>
                  <div class="form-actions" style="grid-column: 1 / -1;">
                    <button type="submit" id="admin-add-user-submit" class="btn btn-primary">Utwórz użytkownika</button>
                  </div>
                </form>
              </div>
            </div>
          `;

          // Handlery ról
          tabContent.querySelectorAll('.role-select').forEach(sel => {
            sel.addEventListener('change', async () => {
              const userId = sel.dataset.id;
              const newRole = sel.value;
              sel.disabled = true;
              try {
                await api(`/api/admin/users/${userId}`, {
                  method: 'PATCH',
                  body: { role: newRole }
                });
                showToast(`Zaktualizowano rolę użytkownika #${userId} na: ${newRole}`, 'success');
                renderAdminPanel();
              } catch (err) {
                sel.disabled = false;
                showToast(err.message, 'error');
                renderAdminPanel();
              }
            });
          });

          // Dodawanie użytkownika
          const addUserForm = document.getElementById('admin-add-user-form');
          addUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('new-user-username').value.trim();
            const password = document.getElementById('new-user-password').value;
            const role = document.getElementById('new-user-role').value;
            const bio = document.getElementById('new-user-bio').value.trim();

            if (!username || username.length < 2) {
              showToast('Nazwa użytkownika musi mieć co najmniej 2 znaki', 'warning');
              return;
            }
            if (!password || password.length < 3) {
              showToast('Hasło musi mieć co najmniej 3 znaki', 'warning');
              return;
            }

            const submitBtn = document.getElementById('admin-add-user-submit');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Tworzenie...';

            try {
              await api('/api/admin/users', {
                method: 'POST',
                body: { username, password, role, bio }
              });
              showToast(`Użytkownik „${username}” został pomyślnie utworzony!`, 'success');
              renderAdminPanel();
            } catch (err) {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Utwórz użytkownika';
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
                      <span>Artykuł: <strong><a href="#/wiki/${encodeURIComponent(msg.article_slug)}/talk">${escapeHtml(msg.article_title || msg.article_slug)}</a></strong></span>
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
              if (!confirm('Czy na pewno chcesz usunąć ten wpis z dyskusji?')) return;
              btn.disabled = true;
              try {
                await api(`/api/admin/talk/${id}`, {
                  method: 'DELETE'
                });
                showToast('Wpis został pomyślnie usunięty', 'success');
                renderAdminPanel();
              } catch (err) {
                btn.disabled = false;
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
                  <label for="set-site-name">Nazwa witryny: <span class="required">*</span></label>
                  <input type="text" id="set-site-name" class="form-control" value="${escapeHtml(settings.site_name || 'WikiKurekk')}" required />
                </div>
                <div class="form-group">
                  <label for="set-site-tagline">Podtytuł / motto witryny:</label>
                  <input type="text" id="set-site-tagline" class="form-control" value="${escapeHtml(settings.site_tagline || 'Wolna encyklopedia')}" />
                </div>
                <div class="form-group">
                  <label for="set-announcement">Baner ogłoszeniowy na samej górze strony:</label>
                  <input type="text" id="set-announcement" class="form-control" value="${escapeHtml(settings.announcement_banner || '')}" placeholder="Pozostaw puste, aby ukryć baner" />
                  <small class="form-hint" style="color:var(--wiki-text-muted); font-size:0.82rem;">Tekst widoczny dla wszystkich czytelników na szczycie strony.</small>
                </div>
                <div class="form-group checkbox-group" style="margin:14px 0;">
                  <label style="cursor:pointer; display:flex; align-items:center; gap:8px;">
                    <input type="checkbox" id="set-anon-edits" ${String(settings.allow_anonymous_edits) === '1' ? 'checked' : ''} />
                    <span>Zezwalaj na anonimowe edycje (bez logowania)</span>
                  </label>
                </div>
                <button type="submit" id="admin-settings-submit" class="btn btn-primary">Zapisz ustawienia</button>
              </form>
            </div>
          `;

          const settingsForm = document.getElementById('admin-settings-form');
          settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const site_name = document.getElementById('set-site-name').value.trim();
            const site_tagline = document.getElementById('set-site-tagline').value.trim();
            const announcement_banner = document.getElementById('set-announcement').value.trim();
            const allow_anonymous_edits = document.getElementById('set-anon-edits').checked ? '1' : '0';

            if (!site_name) {
              showToast('Nazwa witryny nie może być pusta', 'warning');
              return;
            }

            const submitBtn = document.getElementById('admin-settings-submit');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Zapisywanie...';

            try {
              const res = await api('/api/admin/settings', {
                method: 'PUT',
                body: { site_name, site_tagline, announcement_banner, allow_anonymous_edits }
              });
              state.settings = res.settings;
              updateHeaderAndSidebar();
              submitBtn.disabled = false;
              submitBtn.textContent = 'Zapisz ustawienia';
              showToast('Ustawienia encyklopedii zostały zaktualizowane!', 'success');
            } catch (err) {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Zapisz ustawienia';
              showToast(err.message, 'error');
            }
          });

        } else if (state.adminActiveTab === 'audit') {
          tabContent.innerHTML = `
            <div class="admin-section">
              <h2>Dziennik zdarzeń (Audit Log)</h2>
              <p class="admin-section-lead">Rejestr najważniejszych operacji administracyjnych i redakcyjnych.</p>
              <div class="audit-log-list">
                ${auditLogs.length === 0 ? `
                  <p>Brak wpisów w dzienniku zdarzeń.</p>
                ` : auditLogs.map(log => `
                  <div class="audit-log-item">
                    <div>
                      <span class="audit-log-time">${formatDate(log.created_at)}</span>
                      &nbsp;&middot;&nbsp;
                      <span class="audit-actor"><strong>${escapeHtml(log.actor || 'System')}</strong></span>
                      &nbsp;&middot;&nbsp;
                      <code class="audit-log-action">${escapeHtml(log.action)}</code>
                    </div>
                    <div class="audit-details"><em>${escapeHtml(log.details || '')}</em></div>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }
      };

      // Podpięcie kliknięć w zakładki admina
      document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          state.adminActiveTab = btn.dataset.tab;
          renderCurrentAdminSubTab();
        });
      });

      renderCurrentAdminSubTab();

    } catch (err) {
      viewRoot.innerHTML = `
        <div class="wiki-error">
          <p>Błąd wczytywania panelu administratora: ${escapeHtml(err.message)}</p>
          <a href="#/" class="btn btn-secondary">Powrót na stronę główną</a>
        </div>
      `;
    }
  }

  // --- Router hash-based ---
  function parseCurrentRoute() {
    const rawHash = window.location.hash || '#/';
    const [pathPart, queryPart] = rawHash.split('?');
    const query = new URLSearchParams(queryPart || '');

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
      return { name: 'categories-detail', params: { category: decodeURIComponent(sub) }, query };
    }

    // #/wiki/:slug/edit
    const editMatch = pathPart.match(/^#\/wiki\/([^/]+)\/edit$/);
    if (editMatch) {
      return { name: 'wiki-edit', params: { slug: decodeURIComponent(editMatch[1]) }, query };
    }

    // #/wiki/:slug/talk
    const talkMatch = pathPart.match(/^#\/wiki\/([^/]+)\/talk$/);
    if (talkMatch) {
      return { name: 'wiki-talk', params: { slug: decodeURIComponent(talkMatch[1]) }, query };
    }

    // #/wiki/:slug/history
    const histMatch = pathPart.match(/^#\/wiki\/([^/]+)\/history$/);
    if (histMatch) {
      return { name: 'wiki-history', params: { slug: decodeURIComponent(histMatch[1]) }, query };
    }

    // #/wiki/:slug
    const viewMatch = pathPart.match(/^#\/wiki\/([^/]+)$/);
    if (viewMatch) {
      return { name: 'wiki-view', params: { slug: decodeURIComponent(viewMatch[1]) }, query };
    }

    return { name: 'home', params: {}, query };
  }

  function handleRoute() {
    const route = parseCurrentRoute();
    state.currentRoute = route;
    updateHeaderAndSidebar();

    // Zamknięcie podpowiedzi wyszukiwania przy zmianie trasy
    const suggestions = document.getElementById('search-suggestions');
    if (suggestions) suggestions.classList.add('hidden');
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.setAttribute('aria-expanded', 'false');

    // Płynne przewinięcie na górę strony
    window.scrollTo({ top: 0, behavior: 'instant' });

    // Focus na głównym widoku dla czytników ekranowych
    const viewRoot = document.getElementById('view-root');
    if (viewRoot) {
      viewRoot.focus({ preventScroll: true });
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
        renderArticlesCatalog(q, cat);
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

    lastFocusedElementBeforeModal = document.activeElement;
    const isRegister = mode === 'register';
    document.getElementById('login-form')?.classList.toggle('hidden', isRegister);
    document.getElementById('register-form')?.classList.toggle('hidden', !isRegister);
    const title = document.getElementById('auth-modal-title');
    if (title) title.textContent = isRegister ? 'Zarejestruj się' : 'Zaloguj się';
    authModal.classList.remove('hidden');

    setTimeout(() => {
      document.getElementById(isRegister ? 'reg-username' : 'login-username')?.focus();
    }, 50);
  }

  function closeAuthModal() {
    const authModal = document.getElementById('auth-modal');
    if (authModal) authModal.classList.add('hidden');
    if (lastFocusedElementBeforeModal && typeof lastFocusedElementBeforeModal.focus === 'function') {
      lastFocusedElementBeforeModal.focus();
    }
  }

  // --- Inicjalizacja formularza logowania / rejestracji i modala ---
  function initAuthAndModals() {
    const authModal = document.getElementById('auth-modal');
    const authModalBtn = document.getElementById('auth-modal-btn');
    const registerModalBtn = document.getElementById('register-modal-btn');
    const authModalClose = document.getElementById('auth-modal-close');
    const logoutBtn = document.getElementById('logout-btn');

    if (authModalBtn) authModalBtn.addEventListener('click', () => openAuthModal('login'));
    if (registerModalBtn) registerModalBtn.addEventListener('click', () => openAuthModal('register'));
    document.querySelectorAll('[data-auth-mode]').forEach(btn => {
      btn.addEventListener('click', () => openAuthModal(btn.dataset.authMode));
    });
    if (authModalClose) authModalClose.addEventListener('click', closeAuthModal);
    if (authModal) {
      authModal.addEventListener('click', (e) => {
        if (e.target === authModal) closeAuthModal();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && authModal && !authModal.classList.contains('hidden')) {
        closeAuthModal();
      }
    });

    // Wylogowanie
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        logoutBtn.disabled = true;
        try {
          await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
        } finally {
          clearAuthToken();
          logoutBtn.disabled = false;
          showToast('Wylogowano pomyślnie.', 'info');
          handleRoute();
        }
      });
    }

    // Formularz logowania
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const usernameInput = document.getElementById('login-username');
        const passwordInput = document.getElementById('login-password');
        const submitBtn = document.getElementById('login-submit');

        const username = usernameInput ? usernameInput.value.trim() : '';
        const password = passwordInput ? passwordInput.value : '';

        if (!username) {
          showToast('Wpisz nazwę użytkownika', 'warning');
          usernameInput?.focus();
          return;
        }
        if (!password) {
          showToast('Wpisz hasło', 'warning');
          passwordInput?.focus();
          return;
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
          closeAuthModal();
          showToast(`Witaj z powrotem, ${res.user.username}!`, 'success');
          if (passwordInput) passwordInput.value = '';
          handleRoute();
        } catch (err) {
          showToast(err.message, 'error');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Zaloguj się';
          }
        }
      });
    }

    // Formularz rejestracji
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
      registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const usernameInput = document.getElementById('reg-username');
        const passwordInput = document.getElementById('reg-password');
        const bioInput = document.getElementById('reg-bio');
        const submitBtn = document.getElementById('reg-submit');

        const username = usernameInput ? usernameInput.value.trim() : '';
        const password = passwordInput ? passwordInput.value : '';
        const bio = bioInput ? bioInput.value.trim() : '';

        if (!username || username.length < 2) {
          showToast('Nazwa użytkownika musi zawierać co najmniej 2 znaki', 'warning');
          usernameInput?.focus();
          return;
        }
        if (!password || password.length < 3) {
          showToast('Hasło musi zawierać co najmniej 3 znaki', 'warning');
          passwordInput?.focus();
          return;
        }

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Rejestrowanie...';
        }

        try {
          const res = await api('/api/auth/register', {
            method: 'POST',
            body: { username, password, bio }
          });
          setAuthToken(res.token, res.user);
          closeAuthModal();
          showToast(`Konto ${res.user.username} zostało zarejestrowane!`, 'success');
          if (passwordInput) passwordInput.value = '';
          handleRoute();
        } catch (err) {
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

  // --- Dynamiczna wyszukiwarka i losowanie artykułu ---
  function initSearchAndRandom() {
    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('search-input');
    const suggestionsEl = document.getElementById('search-suggestions');
    const randomBtn = document.getElementById('random-article-btn');

    let activeSuggestionIndex = -1;
    let searchDebounceTimer = null;
    let searchRequestId = 0;

    // Losowy artykuł
    const goToRandomArticle = async () => {
      try {
        const res = await api('/api/articles/random');
        if (res.slug) {
          const targetHash = `#/wiki/${encodeURIComponent(res.slug)}`;
          if (window.location.hash === targetHash) {
            handleRoute();
          } else {
            window.location.hash = targetHash;
          }
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    };

    if (randomBtn) randomBtn.addEventListener('click', goToRandomArticle);

    // Aktualizacja podświetlenia klawiaturą
    function updateActiveSuggestion() {
      const items = suggestionsEl.querySelectorAll('.search-suggestion-item');
      items.forEach((item, idx) => {
        if (idx === activeSuggestionIndex) {
          item.classList.add('active');
          item.setAttribute('aria-selected', 'true');
          item.scrollIntoView({ block: 'nearest' });
        } else {
          item.classList.remove('active');
          item.setAttribute('aria-selected', 'false');
        }
      });
    }

    // Formularz szukania
    if (searchForm) {
      searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const items = suggestionsEl.querySelectorAll('.search-suggestion-item');
        if (activeSuggestionIndex >= 0 && items[activeSuggestionIndex]) {
          const chosen = items[activeSuggestionIndex];
          const href = chosen.getAttribute('href');
          if (href) {
            suggestionsEl.classList.add('hidden');
            searchInput.setAttribute('aria-expanded', 'false');
            window.location.hash = href;
            return;
          }
        }

        const q = searchInput ? searchInput.value.trim() : '';
        if (q) {
          suggestionsEl.classList.add('hidden');
          searchInput.setAttribute('aria-expanded', 'false');
          window.location.hash = `#/articles?q=${encodeURIComponent(q)}`;
        } else {
          showToast('Wpisz frazę do wyszukania', 'warning');
          searchInput?.focus();
        }
      });
    }

    // Dynamiczne podpowiedzi w wyszukiwarce (debounced)
    if (searchInput && suggestionsEl) {
      searchInput.addEventListener('input', () => {
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        const query = searchInput.value.trim();
        activeSuggestionIndex = -1;

        if (query.length === 0) {
          suggestionsEl.innerHTML = '';
          suggestionsEl.classList.add('hidden');
          searchInput.setAttribute('aria-expanded', 'false');
          return;
        }

        const currentReq = ++searchRequestId;

        searchDebounceTimer = setTimeout(async () => {
          try {
            const data = await api(`/api/articles?q=${encodeURIComponent(query)}`);
            if (currentReq !== searchRequestId) return;

            const results = (data.articles || []).slice(0, 5);

            if (results.length === 0) {
              suggestionsEl.innerHTML = `
                <div class="search-suggestion-item search-suggestion-empty" role="option">
                  Brak wyników dla „${escapeHtml(query)}”
                </div>
                ${canEditWiki() ? `
                  <a href="#/new?title=${encodeURIComponent(query)}" class="search-suggestion-item search-suggestion-create" role="option">
                    ➕ Utwórz brakujący artykuł: <strong>${escapeHtml(query)}</strong>
                  </a>
                ` : ''}
              `;
            } else {
              suggestionsEl.innerHTML = `
                ${results.map(art => `
                  <a href="#/wiki/${encodeURIComponent(art.slug)}" class="search-suggestion-item" role="option">
                    <div class="search-suggestion-title">${escapeHtml(art.title)}</div>
                    ${art.summary ? `<div class="search-suggestion-snippet">${escapeHtml(art.summary)}</div>` : ''}
                  </a>
                `).join('')}
                ${canEditWiki() ? `
                  <a href="#/new?title=${encodeURIComponent(query)}" class="search-suggestion-item search-suggestion-create" role="option">
                    ➕ Utwórz brakujący artykuł: <strong>${escapeHtml(query)}</strong>
                  </a>
                ` : ''}
              `;
            }

            suggestionsEl.classList.remove('hidden');
            searchInput.setAttribute('aria-expanded', 'true');
            activeSuggestionIndex = -1;
          } catch {
            if (currentReq === searchRequestId) {
              suggestionsEl.classList.add('hidden');
              searchInput.setAttribute('aria-expanded', 'false');
            }
          }
        }, 200);
      });

      // Obsługa nawigacji klawiaturą w podpowiedziach
      searchInput.addEventListener('keydown', (e) => {
        const isVisible = !suggestionsEl.classList.contains('hidden');
        if (!isVisible) return;

        const items = suggestionsEl.querySelectorAll('.search-suggestion-item');
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          activeSuggestionIndex = (activeSuggestionIndex + 1) % items.length;
          updateActiveSuggestion();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          activeSuggestionIndex = (activeSuggestionIndex - 1 + items.length) % items.length;
          updateActiveSuggestion();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          suggestionsEl.classList.add('hidden');
          searchInput.setAttribute('aria-expanded', 'false');
          activeSuggestionIndex = -1;
        }
      });

      // Kliknięcie w element podpowiedzi zamyka menu
      suggestionsEl.addEventListener('click', (e) => {
        const item = e.target.closest('.search-suggestion-item');
        if (item) {
          suggestionsEl.classList.add('hidden');
          searchInput.setAttribute('aria-expanded', 'false');
          activeSuggestionIndex = -1;
        }
      });

      // Kliknięcie poza wyszukiwarką zamyka podpowiedzi
      document.addEventListener('click', (e) => {
        if (!searchForm.contains(e.target)) {
          suggestionsEl.classList.add('hidden');
          searchInput.setAttribute('aria-expanded', 'false');
          activeSuggestionIndex = -1;
        }
      });
    }
  }

  // --- Przechwytywanie kliknięć czerwonych linków, kotwic, spisu treści i zakładek ---
  function initGlobalClickHandlers() {
    document.addEventListener('click', (e) => {
      // Rozwijanie / zwijanie spisu treści TOC
      const tocToggleBtn = e.target.closest('#toc-toggle-btn');
      if (tocToggleBtn) {
        e.preventDefault();
        const tocNav = tocToggleBtn.closest('.wiki-toc');
        if (tocNav) {
          const isCollapsed = tocNav.classList.toggle('collapsed');
          tocToggleBtn.textContent = isCollapsed ? '[pokaż]' : '[ukryj]';
          tocToggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
        }
        return;
      }

      // Płynne przewijanie do kotwic wewnątrz artykułu (TOC, przypisy, sekcje)
      const anchorLink = e.target.closest('a[href^="#sekcja-"], a[href^="#ref-"], a[href^="#cite_"]');
      if (anchorLink) {
        e.preventDefault();
        const targetId = anchorLink.getAttribute('href').slice(1);
        const el = document.getElementById(targetId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth' });
          el.focus?.();
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
        const targetHash = `#/new?title=${encodeURIComponent(missingTitle)}`;
        if (window.location.hash === targetHash) {
          handleRoute();
        } else {
          window.location.hash = targetHash;
        }
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

        if (window.location.hash === targetHash) {
          handleRoute();
        } else {
          window.location.hash = targetHash;
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
    initAuthAndModals();
    initSearchAndRandom();
    initGlobalClickHandlers();

    // Sprawdzenie sesji
    if (state.token) {
      try {
        const authData = await api('/api/auth/me');
        if (authData.user) {
          state.currentUser = authData.user;
        } else {
          clearAuthToken();
        }
      } catch {
        clearAuthToken();
      }
    }

    // Pobranie konfiguracji wstępnej
    try {
      const boot = await api('/api/bootstrap');
      state.settings = boot.settings || state.settings;
      state.stats = boot.stats || state.stats;
      state.categories = boot.categories || state.categories;
      state.allSlugs = boot.allSlugs || state.allSlugs;
      if (boot.currentUser && !state.currentUser) {
        state.currentUser = boot.currentUser;
      }
    } catch (e) {
      console.warn('Nie udało się pobrać bootstrapa na starcie:', e);
    }

    updateHeaderAndSidebar();

    // Nasłuchiwanie zmian hasha w adresie
    window.addEventListener('hashchange', handleRoute);

    // Przekierowanie ścieżki /panel → #/panel
    if (window.location.pathname.replace(/\/+$/, '') === '/panel') {
      history.replaceState(null, '', '/#/panel');
    }

    // Pierwsze uruchomienie routera
    handleRoute();
  }

  // Obiekt pomocniczy dla inspekcji w oknie przeglądarki i testów
  window.wikiApp = {
    state,
    api,
    showToast,
    handleRoute,
    setAuthToken,
    clearAuthToken,
    parseCategories,
    getCatName,
    getCatCount
  };

  // Uruchomienie po załadowaniu DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
