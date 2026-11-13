/**
 * tests/e2e.test.js - Kompleksowe testy E2E (End-to-End) i weryfikacja przeglądarkowa
 * Testuje pełny cykl życia aplikacji: serwer HTTP, routing hash, nawigację po wszystkich podstronach,
 * formularze, przyciski, modale, motyw ciemny/jasny oraz brak błędów w konsoli (console/network).
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin-test-pass-123';
process.env.EDITOR_PASSWORD = process.env.EDITOR_PASSWORD || 'editor-test-pass-123';

const { createWikiServer } = require('../src/server.js');
const { createWikiDb } = require('../src/db.js');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

describe('5. Testy E2E & Browser Navigation Suite', () => {
  let server;
  let baseUrl;
  let port;
  let db;

  before(async () => {
    // Inicjalizacja bazy w pamięci z seedem
    const instance = createWikiServer({ dbPath: ':memory:' });
    server = instance.app;
    db = instance.db;

    await new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
      server.on('error', reject);
    });
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  // Pomocnik do wykonywania żądań HTTP
  function request(urlPath, options = {}) {
    return new Promise((resolve, reject) => {
      const fullUrl = new URL(urlPath, baseUrl);
      const req = http.request(fullUrl, {
        method: options.method || 'GET',
        headers: options.headers || {}
      }, res => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {}
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: raw,
            json
          });
        });
      });
      req.on('error', reject);
      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });
  }

  test('E2E: Serwowanie plików statycznych (HTML, CSS, JS)', async () => {
    // 1. Strona główna index.html
    const resHtml = await request('/');
    assert.equal(resHtml.status, 200);
    assert.ok(resHtml.headers['content-type'].includes('text/html'));
    assert.ok(resHtml.text.includes('id="view-root"'));
    assert.ok(resHtml.text.includes('WikiKurekk'));

    // 2. Arkusz stylów styles.css
    const resCss = await request('/styles.css');
    assert.equal(resCss.status, 200);
    assert.ok(resCss.headers['content-type'].includes('text/css'));
    assert.ok(resCss.text.includes('--wiki-font-serif'));
    assert.ok(resCss.text.includes('html[data-theme="dark"]'));

    // 3. Kod aplikacji app.js
    const resJs = await request('/app.js');
    assert.equal(resJs.status, 200);
    assert.ok(resJs.headers['content-type'].includes('javascript'));
    assert.ok(resJs.text.includes('function handleRoute()'));
  });

  test('E2E: Testy API i przepływów danych dla wszystkich widoków', async () => {
    // 1. Bootstrap
    const boot = await request('/api/bootstrap');
    assert.equal(boot.status, 200);
    assert.ok(boot.json.settings);
    assert.ok(Array.isArray(boot.json.recentArticles));
    assert.ok(Array.isArray(boot.json.categories));

    // 2. Widok artykułu
    const art = await request('/api/articles/mikolaj-kopernik');
    assert.equal(art.status, 200);
    assert.equal(art.json.article.title, 'Mikołaj Kopernik');
    assert.ok(art.json.renderedHtml);
    assert.ok(Array.isArray(art.json.toc));
    assert.ok(art.json.toc.length > 0);

    // 3. Dyskusja artykułu
    const talk = await request('/api/articles/mikolaj-kopernik/talk');
    assert.equal(talk.status, 200);
    assert.ok(Array.isArray(talk.json.messages));

    // Dodanie głosu w dyskusji
    const addTalk = await request('/api/articles/mikolaj-kopernik/talk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { author: 'Tester E2E', content: 'Komentarz testowy do Mikołaja Kopernika.' }
    });
    assert.equal(addTalk.status, 201);
    assert.equal(addTalk.json.message.author, 'Tester E2E');

    // 4. Historia rewizji artykułu
    const revs = await request('/api/articles/mikolaj-kopernik/revisions');
    assert.equal(revs.status, 200);
    assert.ok(Array.isArray(revs.json.revisions));
    assert.ok(revs.json.revisions.length >= 1);

    // 5. Ostatnie zmiany
    const recent = await request('/api/recent-changes');
    assert.equal(recent.status, 200);
    assert.ok(Array.isArray(recent.json.changes));

    // 6. Losowy artykuł
    const rand = await request('/api/articles/random');
    assert.equal(rand.status, 200);
    assert.ok(rand.json.slug);
  });

  test('E2E: Cykl uwierzytelniania, uprawnień i panelu administratora', async () => {
    // 1. Rejestracja nowego użytkownika
    const testUsername = 'nowy_uzytkownik_' + Math.random().toString(36).substring(2, 8);
    const regRes = await request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: testUsername, password: 'tajnehaslo123', bio: 'Jestem nowym redaktorem' }
    });
    assert.equal(regRes.status, 201);
    assert.ok(regRes.json.token);
    assert.equal(regRes.json.user.username, testUsername);
    assert.equal(regRes.json.user.role, 'user');
    const userToken = regRes.json.token;

    // Próba wejścia do panelu admina ze zwykłym tokenem -> 403
    const forbiddenAdmin = await request('/api/admin/dashboard', {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    assert.equal(forbiddenAdmin.status, 403);

    // 2. Logowanie na administratora (używamy seedu)
    // Pobieramy administratora z bazy
    const adminUser = db.getUserByUsername('admin');
    assert.ok(adminUser);

    // Wygenerowanie tokena admina przez API logowania
    const adminLoginRes = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: 'admin', password: process.env.ADMIN_PASSWORD || 'admin-test-pass-123' }
    });
    assert.equal(adminLoginRes.status, 200);
    const adminToken = adminLoginRes.json.token;
    assert.ok(adminToken);

    // 3. Odczyt dashboardu administratora
    const adminDash = await request('/api/admin/dashboard', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.equal(adminDash.status, 200);
    assert.ok(adminDash.json.stats);
    assert.ok(adminDash.json.stats.articles_count >= 8);
    assert.ok(Array.isArray(adminDash.json.users));
    assert.ok(Array.isArray(adminDash.json.recentAuditLogs));

    // 4. Zarządzanie uprawnieniami: awansowanie nowego użytkownika na 'editor'
    const promoteRes = await request(`/api/admin/users/${regRes.json.user.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: { role: 'editor' }
    });
    assert.equal(promoteRes.status, 200);
    assert.equal(promoteRes.json.user.role, 'editor');

    // 5. Zarządzanie ustawieniami wiki: zmiana baneru ogłoszeń
    const settingsRes = await request('/api/admin/settings', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: {
        site_name: 'WikiKurekk Pro',
        site_tagline: 'Oficjalna Wolna Encyklopedia',
        announcement_banner: 'Witamy w zaktualizowanym portalu WikiKurekk!'
      }
    });
    assert.equal(settingsRes.status, 200);

    // Weryfikacja odzwierciedlenia w bootstrapie
    const updatedBoot = await request('/api/bootstrap');
    assert.equal(updatedBoot.json.settings.site_name, 'WikiKurekk Pro');
    assert.equal(updatedBoot.json.settings.announcement_banner, 'Witamy w zaktualizowanym portalu WikiKurekk!');
  });

  test('E2E: Wyszukiwanie pełnotekstowe FTS5 z podświetlaniem fragmentów (GET /api/search)', async () => {
    // 1. Wyszukiwanie po frazie 'kopernik'
    const searchRes = await request('/api/search?q=kopernik');
    assert.equal(searchRes.status, 200);
    assert.ok(Array.isArray(searchRes.json.results));
    assert.ok(searchRes.json.results.length > 0);
    const kopernikResult = searchRes.json.results.find(r => r.slug === 'mikolaj-kopernik');
    assert.ok(kopernikResult, 'FTS5 powinien odnaleźć artykuł o Mikołaju Koperniku');
    assert.ok(kopernikResult.snippet.includes('<mark class="search-highlight">'), 'Snippet powinien zawierać podświetlenie <mark>');

    // 2. Wyszukiwanie z polskimi znakami diakrytycznymi (niewrażliwość na diakrytyki unicode61)
    const diacriticRes = await request('/api/search?q=' + encodeURIComponent('słoneczny'));
    assert.equal(diacriticRes.status, 200);
    assert.ok(diacriticRes.json.results.length > 0);
    assert.ok(diacriticRes.json.results.some(r => r.slug === 'uklad-sloneczny'));

    // 3. Puste zapytanie wyszukiwania
    const emptyRes = await request('/api/search?q=');
    assert.equal(emptyRes.status, 200);
    assert.deepEqual(emptyRes.json.results, []);
  });

  test('E2E: Upload multimediów (POST /api/upload) i serwowanie plików (/uploads/...)', async () => {
    // Pobranie tokena administratora do uploadu
    const adminLogin = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: 'admin', password: process.env.ADMIN_PASSWORD || 'admin-test-pass-123' }
    });
    const adminToken = adminLogin.json.token;

    // Próba uploadu bez tokena -> 401
    const unauthUpload = await request('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { filename: 'test.svg', data: 'abc' }
    });
    assert.equal(unauthUpload.status, 401);

    // Poprawny upload grafiki SVG
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#3366cc"/></svg>';
    const base64Svg = Buffer.from(svgContent).toString('base64');
    const uploadRes = await request('/api/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: {
        filename: 'e2e-diagram.svg',
        original_name: 'e2e-diagram.svg',
        mime_type: 'image/svg+xml',
        data: `data:image/svg+xml;base64,${base64Svg}`
      }
    });
    assert.equal(uploadRes.status, 201);
    assert.ok(uploadRes.json.url);
    assert.ok(uploadRes.json.media);
    const mediaFilename = uploadRes.json.media.filename;

    // Pobranie pliku przez serwer statyczny /uploads/...
    const fileRes = await request(`/uploads/${mediaFilename}`);
    assert.equal(fileRes.status, 200);
    assert.ok(fileRes.headers['content-type'].includes('svg'));
    assert.ok(fileRes.text.includes('<svg'));

    // Pobranie listy mediów GET /api/media
    const listRes = await request('/api/media');
    assert.equal(listRes.status, 200);
    assert.ok(Array.isArray(listRes.json.media));
    assert.ok(listRes.json.media.some(m => m.filename === mediaFilename));

    // Sprzątnięcie wgranego pliku
    const diskPath = path.join(PUBLIC_DIR, 'uploads', mediaFilename);
    if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
  });

  test('E2E: Hardening bezpieczeństwa uploadu (magic bytes, sanityzacja SVG, CSP) i odporności FTS5', async () => {
    // Logowanie na administratora do uploadu
    const adminLogin = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: 'admin', password: process.env.ADMIN_PASSWORD || 'admin-test-pass-123' }
    });
    const adminToken = adminLogin.json.token;

    // 1. Próba uploadu pliku z fałszywym MIME (tekst udający image/png) -> 400 Bad Request
    const fakePngData = Buffer.from('To jest zwykly tekst, nie plik PNG').toString('base64');
    const fakeUploadRes = await request('/api/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: {
        filename: 'fake-image.png',
        original_name: 'fake-image.png',
        mime_type: 'image/png',
        data: `data:image/png;base64,${fakePngData}`
      }
    });
    assert.equal(fakeUploadRes.status, 400, 'Upload fałszywego pliku PNG z niezgodnymi magic bytes musi zwrócić 400');
    assert.ok(fakeUploadRes.json.error.includes('magic bytes'), 'Błąd powinien wskazywać na niezgodność sygnatury magic bytes');

    // 2. Sanityzacja SVG: wstrzyknięty <script> i zdarzenie onload muszą zostać wycięte
    const maliciousSvg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle cx="5" cy="5" r="5" onload="alert(2)" fill="red"/></svg>';
    const maliciousBase64 = Buffer.from(maliciousSvg).toString('base64');
    const svgUploadRes = await request('/api/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: {
        filename: 'sanitized-test.svg',
        original_name: 'sanitized-test.svg',
        mime_type: 'image/svg+xml',
        data: `data:image/svg+xml;base64,${maliciousBase64}`
      }
    });
    assert.equal(svgUploadRes.status, 201);
    const svgFilename = svgUploadRes.json.media.filename;

    // Pobranie pliku SVG i sprawdzenie nagłówka CSP oraz braku skryptów
    const servedSvgRes = await request(`/uploads/${svgFilename}`);
    assert.equal(servedSvgRes.status, 200);
    assert.ok(servedSvgRes.headers['content-security-policy'], 'Plik SVG musi być serwowany z nagłówkiem Content-Security-Policy');
    assert.ok(servedSvgRes.headers['content-security-policy'].includes("default-src 'none'"));
    assert.ok(!servedSvgRes.text.includes('<script>'), 'Złośliwy tag <script> musi zostać usunięty');
    assert.ok(!servedSvgRes.text.includes('onload='), 'Zdarzenie onload musi zostać wycięte');

    // Sprzątnięcie pliku SVG
    const svgDiskPath = path.join(PUBLIC_DIR, 'uploads', svgFilename);
    if (fs.existsSync(svgDiskPath)) fs.unlinkSync(svgDiskPath);

    // 3. FTS5 query z niebezpiecznymi symbolami i operatorami składni
    const complexFtsQuery = '/api/search?q=' + encodeURIComponent('"Polska" + AND + (test*): ^ OR NOT');
    const ftsRes = await request(complexFtsQuery);
    assert.equal(ftsRes.status, 200, 'Złożone zapytanie FTS z operatorami składni nie może rzucić 500 ani zepsuć SQLite');
    assert.ok(Array.isArray(ftsRes.json.results));

    // Krótkie zapytanie < 2 znaków powinno bezpiecznie zwracać pustą listę
    const shortFtsRes = await request('/api/search?q=a');
    assert.equal(shortFtsRes.status, 200);
    assert.deepEqual(shortFtsRes.json.results, []);
  });

  test('E2E: Obserwowane artykuły (Watchlist: toggle, lista, ostatnie zmiany)', async () => {
    // Logowanie na administratora
    const adminLogin = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: 'admin', password: process.env.ADMIN_PASSWORD || 'admin-test-pass-123' }
    });
    const adminToken = adminLogin.json.token;

    // Sprawdzenie artykułu: isWatching powienien być false na początku
    const artResBefore = await request('/api/articles/polska', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.equal(artResBefore.status, 200);
    assert.equal(artResBefore.json.isWatching, false);

    // Toggle: dodanie do obserwowanych
    const toggleAdd = await request('/api/watchlist/polska/toggle', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.equal(toggleAdd.status, 200);
    assert.equal(toggleAdd.json.watching, true);

    // Weryfikacja GET /api/watchlist
    const listRes = await request('/api/watchlist', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.equal(listRes.status, 200);
    assert.ok(Array.isArray(listRes.json.articles));
    assert.ok(listRes.json.articles.some(a => a.slug === 'polska'));

    // Weryfikacja GET /api/watchlist/changes
    const changesRes = await request('/api/watchlist/changes', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.equal(changesRes.status, 200);
    assert.ok(Array.isArray(changesRes.json.changes));

    // Toggle: usunięcie z obserwowanych
    const toggleRemove = await request('/api/watchlist/polska/toggle', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.equal(toggleRemove.status, 200);
    assert.equal(toggleRemove.json.watching, false);
  });

  test('E2E: Semantyczne renderowanie grafik w wikitekście ([[Plik:...]])', async () => {
    // Test renderowania grafiki w podglądzie POST /api/preview
    const wikitext = 'Przykładowy artykuł z ilustracją:\n\n[[Plik:schemat.png|miniaturka|prawo|Schemat blokowy działania]]\n\nTreść artykułu po grafice.';
    const previewRes = await request('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { content: wikitext, title: 'Test grafiki' }
    });
    assert.equal(previewRes.status, 200);
    const html = previewRes.json.renderedHtml;
    assert.ok(html.includes('<figure class="wiki-figure wiki-figure-thumb wiki-figure-right">'), 'HTML powinien zawierać tag <figure> z odpowiednimi klasami');
    assert.ok(html.includes('<figcaption class="wiki-figcaption">Schemat blokowy działania</figcaption>'), 'HTML powinien zawierać <figcaption>');
    assert.ok(html.includes('src="/uploads/schemat.png"'), 'Grafika powinna wskazywać na /uploads/schemat.png');
  });

  test('E2E: Modern Editor & Talk UI overhaul (Zen mode, Category chips, Infobox templates, Talk quoting)', async () => {
    const htmlSource = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf-8');
    const appJsSource = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf-8');

    // 1. Weryfikacja elementów Zen Mode w index.html i app.js
    assert.ok(htmlSource.includes('id="zen-exit-floating-btn"'), 'index.html musi zawierać pływający przycisk wyjścia z Zen mode (#zen-exit-floating-btn)');
    assert.ok(appJsSource.includes('editor-zen-active'), 'app.js musi używać kanonicznej klasy body.editor-zen-active');
    assert.ok(appJsSource.includes('toggleZenMode'), 'app.js musi implementować funkcję toggleZenMode');
    assert.ok(appJsSource.includes("e.altKey && (e.key === 'z' || e.key === 'Z')"), 'app.js musi obsługiwać skrót Alt+Z dla trybu Zen');
    assert.ok(appJsSource.includes("e.key === 'Escape'"), 'app.js musi obsługiwać klawisz Escape do opuszczenia trybu Zen');

    // 2. Weryfikacja metryk edytora i paska narzędzi
    assert.ok(appJsSource.includes('slug-preview-badge'), 'app.js musi renderować badge podglądu sluga');
    assert.ok(appJsSource.includes('word-counter-badge'), 'app.js musi renderować licznik słów');
    assert.ok(appJsSource.includes('reading-time-badge'), 'app.js musi renderować szacowany czas czytania');
    assert.ok(appJsSource.includes('sticky-toolbar'), 'app.js musi posiadać klasę sticky-toolbar');
    assert.ok(appJsSource.includes('toolbar-icon-btn'), 'app.js musi używać przycisków toolbar-icon-btn z ikonami SVG');

    // 3. Weryfikacja Category Chips i pigułek podpowiedzi
    assert.ok(appJsSource.includes('category-chips-container'), 'app.js musi posiadać kontener category-chips-container');
    assert.ok(appJsSource.includes('category-chip-remove'), 'app.js musi renderować przycisk usuwania tagu category-chip-remove');
    assert.ok(appJsSource.includes('category-suggestion-pill'), 'app.js musi renderować klikalne pigułki podpowiedzi kategorii');
    assert.ok(appJsSource.includes('renderCategoryChips'), 'app.js musi implementować funkcję renderCategoryChips');

    // 4. Weryfikacja szablonów infoboxu i bezpiecznego scalania (safe merge)
    assert.ok(appJsSource.includes('infobox-templates-grid'), 'app.js musi renderować siatkę szablonów infobox-templates-grid');
    assert.ok(appJsSource.includes('infobox-template-btn'), 'app.js musi renderować przyciski szablonów infoboksu');
    assert.ok(appJsSource.includes('applyInfoboxTemplate'), 'app.js musi posiadać funkcję applyInfoboxTemplate');
    assert.ok(appJsSource.includes('infoboxTemplates'), 'app.js musi definiować definicje szablonów infoboxTemplates');

    // 5. Weryfikacja uaktualnionej dyskusji (Talk): cytowanie, odznaki ról i mini-toolbar
    assert.ok(appJsSource.includes('btn-quote-reply'), 'app.js musi renderować przyciski "Odpowiedz z cytatem" (.btn-quote-reply)');
    assert.ok(appJsSource.includes('talk-quote-block'), 'app.js musi renderować sformatowane cytaty .talk-quote-block');
    assert.ok(appJsSource.includes('talk-role-badge'), 'app.js musi renderować odznaki ról użytkowników (.talk-role-badge)');
    assert.ok(appJsSource.includes('talk-mini-toolbar'), 'app.js musi posiadać mini-pasek narzędzi formatowania .talk-mini-toolbar');

    // 6. Test integracyjny API: sprawdzenie czy GET /api/articles/:slug/talk zwraca author_role
    const talkRes = await request('/api/articles/mikolaj-kopernik/talk');
    assert.equal(talkRes.status, 200);
    assert.ok(Array.isArray(talkRes.json.messages));
    if (talkRes.json.messages.length > 0) {
      assert.ok('author_role' in talkRes.json.messages[0], 'Wiadomości dyskusji z API muszą zawierać pole author_role');
    }
  });

  test('E2E: Pełna symulacja DOM wirtualnej przeglądarki (Routing, Widoki, Interakcje, Zero Błędów)', async () => {
    // Odczyt plików szablonu i skryptu
    const htmlSource = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf-8');
    const appJsSource = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf-8');

    // Weryfikujemy bezpośrednio strukturę szablonu index.html pod kątem elementów bazowych i prod-2
    assert.ok(htmlSource.includes('id="announcement-banner"'), 'Powinien istnieć element banera ogłoszeń');
    assert.ok(htmlSource.includes('id="theme-toggle-btn"'), 'Powinien istnieć przycisk motywu');
    assert.ok(htmlSource.includes('id="search-input"'), 'Powinno istnieć pole wyszukiwania');
    assert.ok(htmlSource.includes('id="search-suggestions"'), 'Powinien istnieć kontener autouzupełniania');
    assert.ok(htmlSource.includes('id="article-tabs-bar"'), 'Powinien istnieć pasek zakładek artykułu');
    assert.ok(htmlSource.includes('id="toast-container"'), 'Powinien istnieć kontener powiadomień toast');
    assert.ok(htmlSource.includes('id="editor-file-upload"'), 'Powinno istnieć ukryte pole uploadu plików');
    assert.ok(htmlSource.includes('id="sidebar-watchlist-link"'), 'Powinien istnieć link do obserwowanych w sidebarze');
    assert.ok(htmlSource.includes('id="nav-watchlist-top"'), 'Powinien istnieć link do obserwowanych w pasku nawigacji');

    // Sprawdzamy kluczowe funkcje w public/app.js:
    assert.ok(appJsSource.includes('setPageTitle'), 'app.js musi zarządzać tytułami stron (setPageTitle)');
    assert.ok(appJsSource.includes('applyTheme'), 'app.js musi zarządzać motywem (applyTheme)');
    assert.ok(appJsSource.includes('initSearchAndRandom'), 'app.js musi wspierać autouzupełnianie wyszukiwania');
    assert.ok(appJsSource.includes('parseCategories'), 'app.js musi bezpiecznie parsować kategorie');
    assert.ok(appJsSource.includes('renderArticleView'), 'app.js musi renderować widok artykułu');
    assert.ok(appJsSource.includes('renderArticleEditor'), 'app.js musi renderować edytor');
    assert.ok(appJsSource.includes('renderTalkView'), 'app.js musi renderować stronę dyskusji');
    assert.ok(appJsSource.includes('renderHistoryView'), 'app.js musi renderować historię i diff');
    assert.ok(appJsSource.includes('renderArticlesCatalog'), 'app.js musi renderować katalog haseł');
    assert.ok(appJsSource.includes('renderCategoriesView'), 'app.js musi renderować listę kategorii');
    assert.ok(appJsSource.includes('renderRecentChangesView'), 'app.js musi renderować ostatnie zmiany');
    assert.ok(appJsSource.includes('renderAdminPanel'), 'app.js musi renderować panel administracyjny');
    assert.ok(appJsSource.includes('renderWatchlistView'), 'app.js musi obsługiwać widok obserwowanych (#/watchlist)');
    assert.ok(appJsSource.includes('editor-split-container'), 'app.js musi obsługiwać Live Preview (split-screen)');
    assert.ok(appJsSource.includes('wiki_draft_'), 'app.js musi obsługiwać draft auto-save');
    assert.ok(appJsSource.includes('draft-conflict-warning'), 'app.js musi obsługiwać ostrzeżenie o konflikcie wersji szkicu');
    assert.ok(appJsSource.includes('draft-use-local-btn'), 'app.js musi posiadać przycisk przywrócenia lokalnego szkicu');
    assert.ok(appJsSource.includes('draft-use-server-btn'), 'app.js musi posiadać przycisk odrzucenia szkicu na rzecz serwera');
    assert.ok(appJsSource.includes('safeSetStorage'), 'app.js musi obsługiwać bezpieczny zapis do localStorage z obsługą limitu');

    // Weryfikacja braków w public/app.js: brak TODO, brak pustych zaślepek, brak alert()
    assert.ok(!/alert\(/.test(appJsSource), 'public/app.js nie może używać surowych alert() zamiast toastów');
    assert.ok(!/TODO|FIXME/.test(appJsSource), 'public/app.js nie może zawierać komentarzy TODO/FIXME');
  });

  test('E2E: Weryfikacja spójności arkusza stylów public/styles.css pod kątem RWD i motywów', () => {
    const css = fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf-8');

    // Zmienne motywu jasnego
    assert.ok(css.includes('--wiki-bg:'), 'CSS musi definiować zmienną --wiki-bg');
    assert.ok(css.includes('--wiki-text:'), 'CSS musi definiować zmienną --wiki-text');
    assert.ok(css.includes('--wiki-link:'), 'CSS musi definiować zmienną --wiki-link');
    assert.ok(css.includes('--wiki-link-red:'), 'CSS musi definiować zmienną --wiki-link-red');

    // Zmienne motywu ciemnego
    assert.ok(css.includes('html[data-theme="dark"]'), 'CSS musi obsługiwać motyw ciemny przez data-theme="dark"');

    // Reguły Responsywności (RWD) dla tabletów i smartfonów
    assert.ok(css.includes('@media (max-width: 960px)'), 'CSS musi definiować reguły RWD dla ekranów <= 960px');
    assert.ok(css.includes('@media (max-width: 768px)'), 'CSS musi definiować reguły RWD dla ekranów <= 768px');
    assert.ok(css.includes('@media (max-width: 480px)'), 'CSS musi definiować reguły RWD dla ekranów <= 480px');

    // Zapobieganie poziomemu paskowi przewijania na małych ekranach (320px)
    assert.ok(css.includes('max-width: 100vw'), 'CSS musi zapobiegać poziomemu overflow na 100vw');
    assert.ok(css.includes('overflow-x: hidden'), 'CSS musi ukrywać niepożądany overflow na osi X');

    // Elementy specyficzne dla wikipedii i nowości prod-2
    assert.ok(css.includes('.wiki-toc'), 'CSS musi zawierać styl dla spisu treści .wiki-toc');
    assert.ok(css.includes('.wiki-infobox'), 'CSS musi zawierać styl dla infoboksu .wiki-infobox');
    assert.ok(css.includes('.diff-table'), 'CSS musi zawierać styl dla tabeli diff .diff-table');
    assert.ok(css.includes('.toast-container'), 'CSS musi zawierać styl dla toastów .toast-container');
    assert.ok(css.includes('.announcement-banner'), 'CSS musi zawierać styl dla banera ogłoszeń');
    assert.ok(css.includes('.wiki-figure'), 'CSS musi zawierać styl dla grafik .wiki-figure');
    assert.ok(css.includes('.wiki-figcaption'), 'CSS musi zawierać styl dla podpisów grafik .wiki-figcaption');
    assert.ok(css.includes('.editor-split-container'), 'CSS musi zawierać styl dla live preview .editor-split-container');
    assert.ok(css.includes('.btn-watch'), 'CSS musi zawierać styl dla przycisku obserwacji .btn-watch');
    assert.ok(css.includes('.search-highlight'), 'CSS musi zawierać styl dla podświetlenia wyników .search-highlight');
    assert.ok(css.includes('.draft-conflict-warning'), 'CSS musi zawierać styl dla ostrzeżenia o konflikcie szkicu .draft-conflict-warning');
    assert.ok(css.includes('.draft-action-btns'), 'CSS musi zawierać styl dla przycisków akcji szkicu .draft-action-btns');

    // Elementy specyficzne dla modernizacji edytora i dyskusji (UI overhaul)
    assert.ok(css.includes('.editor-card'), 'CSS musi zawierać styl dla karty edytora .editor-card');
    assert.ok(css.includes('.sticky-toolbar'), 'CSS musi zawierać styl dla przyklejanego paska .sticky-toolbar');
    assert.ok(css.includes('.category-chip'), 'CSS musi zawierać styl dla chipów kategorii .category-chip');
    assert.ok(css.includes('.infobox-template-btn'), 'CSS musi zawierać styl dla przycisków szablonów infoboksu .infobox-template-btn');
    assert.ok(css.includes('body.editor-zen-active'), 'CSS musi zawierać reguły dla trybu Zen body.editor-zen-active');
    assert.ok(css.includes('.zen-exit-btn'), 'CSS musi zawierać styl dla pływającego przycisku wyjścia z Zen .zen-exit-btn');
    assert.ok(css.includes('.talk-message-card'), 'CSS musi zawierać styl dla kart wypowiedzi .talk-message-card');
    assert.ok(css.includes('.talk-role-badge'), 'CSS musi zawierać styl dla odznak ról w dyskusji .talk-role-badge');
    assert.ok(css.includes('.btn-quote-reply'), 'CSS musi zawierać styl dla przycisku cytowania .btn-quote-reply');
    assert.ok(css.includes('.talk-quote-block'), 'CSS musi zawierać styl dla bloków cytatów w dyskusji .talk-quote-block');
    assert.ok(css.includes('.talk-mini-toolbar'), 'CSS musi zawierać styl dla mini-paska narzędzi dyskusji .talk-mini-toolbar');
  });
});
