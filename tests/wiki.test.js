const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');

// Hasła kont startowych (seed) są podawane przez zmienne środowiskowe
const TEST_ADMIN_PASSWORD = 'admin-test-pass-123';
const TEST_EDITOR_PASSWORD = 'editor-test-pass-123';
process.env.ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
process.env.EDITOR_PASSWORD = TEST_EDITOR_PASSWORD;

// =============================================================================
// 1. TESTY PARSERA WIKI (src/wiki-parser.js)
// =============================================================================
describe('1. Parser Wiki (src/wiki-parser.js)', () => {
  let slugify, renderWikiContent, computeLineDiff;

  before(() => {
    const parser = require('../src/wiki-parser.js');
    slugify = parser.slugify;
    renderWikiContent = parser.renderWikiContent;
    computeLineDiff = parser.computeLineDiff;
  });

  describe('slugify', () => {
    test('obsługuje polskie znaki diakrytyczne (ą,ć,ę,ł,ń,ó,ś,ź,ż)', () => {
      assert.equal(slugify('Mikołaj Kopernik'), 'mikolaj-kopernik');
      assert.equal(slugify('Zażółć gęślą jaźń'), 'zazolc-gesla-jazn');
      assert.equal(slugify('ZAŻÓŁĆ GĘŚLĄ JAŹŃ'), 'zazolc-gesla-jazn');
      assert.equal(slugify('Sztuczna inteligencja & Big Data!'), 'sztuczna-inteligencja-big-data');
    });

    test('usuwa wielokrotne myślniki i myślniki krańcowe', () => {
      assert.equal(slugify('---Polska---Warszawa---'), 'polska-warszawa');
      assert.equal(slugify('Specjalne // znaki $$ i ##'), 'specjalne-znaki-i');
    });

    test('obsługuje przypadki brzegowe slugify (puste, symbole, znaki specjalne)', () => {
      assert.equal(slugify(''), '');
      assert.equal(slugify(null), '');
      assert.equal(slugify(undefined), '');
      assert.equal(slugify('   '), '');
      assert.equal(slugify('???###$$$'), '');
      assert.equal(slugify('München & København'), 'munchen-kobenhavn');
    });
  });

  describe('renderWikiContent', () => {
    test('parsuje nagłówki == i ## oraz generuje spis treści TOC', () => {
      const input = `== Wstęp ==\nTreść wstępu\n## Podsekcja ##\nTreść podsekcji\n== Zakończenie ==\nKoniec`;
      const result = renderWikiContent(input, new Set());

      assert.ok(result.html.includes('<h2'), 'HTML powinien zawierać tag <h2>');
      assert.ok(result.toc && Array.isArray(result.toc), 'Wynik powinien zawierać tablicę toc');
      assert.ok(result.toc.length >= 2, 'TOC powinno zawierać co najmniej 2 pozycje');

      const titles = result.toc.map(item => item.text.trim());
      assert.ok(titles.includes('Wstęp'), 'TOC powinno zawierać sekcję Wstęp');
      assert.ok(titles.includes('Zakończenie'), 'TOC powinno zawierać sekcję Zakończenie');
    });

    test('formatuje pogrubienie, kursywę, kod inline, cytaty i listy', () => {
      const input = `
'''tekst pogrubiony''' i **alternatywny bold**
''tekst pochylony'' i *alternatywna kursywa*
\`const x = 42;\`
> To jest ważny cytat
* Punkt pierwszy
* Punkt drugi
`;
      const result = renderWikiContent(input, new Set());

      // Sprawdzenie konkretnie formatowania apostrofowego ''' i ''
      assert.ok(result.html.includes('<strong>tekst pogrubiony</strong>') || result.html.includes('<b>tekst pogrubiony</b>'),
        'Apostrofy \'\'\'tekst\'\'\' muszą zamienić się na pogrubienie <strong>');
      assert.ok(result.html.includes('<em>tekst pochylony</em>') || result.html.includes('<i>tekst pochylony</i>'),
        'Apostrofy \'\'tekst\'\' muszą zamienić się na kursywę <em>');
      assert.ok(!result.html.includes("'''"), 'Wynikowy HTML nie powinien zawierać niesparsowanych apostrofów');
      assert.ok(!result.html.includes('&#39;&#39;&#39;'), 'Wynikowy HTML nie powinien zawierać zakodowanych potrójnych apostrofów');

      assert.ok(result.html.includes('<code>const x = 42;</code>'), 'HTML powinien zawierać kod inline');
      assert.ok(result.html.includes('<blockquote>'), 'HTML powinien zawierać cytat blokowy');
      assert.ok(result.html.includes('<li>'), 'HTML powinien zawierać elementy listy');
    });

    test('tworzy przypisy <ref>...</ref> i generuje sekcję przypisów', () => {
      const input = `Polska jest krajem w Europie Środkowej<ref>Główny Urząd Statystyczny 2024</ref>. Stolicą jest Warszawa<ref>Encyklopedia PWN</ref>.`;
      const result = renderWikiContent(input, new Set());

      assert.ok(result.html.includes('<sup'), 'Przypis powinien zawierać znacznik <sup>');
      assert.ok(result.references && result.references.length === 2, 'Powinny być 2 przypisy');
      assert.ok(result.html.includes('Główny Urząd Statystyczny 2024'), 'HTML powinien zawierać treść przypisu');
    });

    test('obsługuje przypisy z atrybutami <ref name="..."> oraz zapobiega XSS', () => {
      const input = `Informacja<ref name="zrodlo-1">Źródło z atrybutem</ref> oraz próba ataku: <script>alert("XSS")</script>.`;
      const result = renderWikiContent(input, new Set());

      assert.ok(result.html.includes('Źródło z atrybutem'), 'Przypis z atrybutem powinien zostać poprawnie sparsowany');
      assert.ok(result.html.includes('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'), 'Tagi script muszą być bezpiecznie escapowane');
      assert.ok(!result.html.includes('<script>'), 'HTML nie może zawierać niezaescapowanego znacznika script');
    });

    test('bezpiecznie renderuje kod inline i bloki kodu ze znakami specjalnymi ($1, $&, gwiazdki, encje)', () => {
      const input = `
\`a * b * c\`
\`regex $1, $&, $'\`
\`[[link-w-kodzie]]\`
\`\`\`bash
echo "$1" && grep -E "foo|bar"
\`\`\`
`;
      const result = renderWikiContent(input, new Set());

      assert.ok(result.html.includes('<code>a * b * c</code>'), 'Gwiazdki w kodzie inline nie mogą być parsowane jako kursywa');
      assert.ok(result.html.includes('<code>regex $1, $&amp;, $\'</code>') || result.html.includes('<code>regex $1, $&, $\'</code>'),
        'Symbole $ w kodzie inline nie mogą być uszkadzane przez silnik regex');
      assert.ok(result.html.includes('<code>[[link-w-kodzie]]</code>'), 'Linki wiki w kodzie inline muszą pozostać dosłownym kodem');
      assert.ok(result.html.includes('echo &quot;$1&quot;'), 'Blok kodu powinien bezpiecznie zachować $1');
    });

    test('renderuje niebieskie linki dla istniejących stron i czerwone dla brakujących', () => {
      const existingSlugs = new Set(['polska', 'warszawa']);
      const input = `Oto link do [[Polska]] oraz [[Polska|stolicy Polski]]. Brakująca strona to [[Komputer kwantowy]].`;
      const result = renderWikiContent(input, existingSlugs);

      // Niebieski link (istniejący)
      assert.ok(result.html.includes('href="#/wiki/polska"'), 'Link do Polski powinien wskazywać na #/wiki/polska');
      assert.ok(result.html.includes('data-slug="polska"'), 'Link do Polski powinien mieć data-slug="polska"');
      assert.ok(!result.html.includes('wiki-link-red" data-slug="polska"'), 'Link do Polski nie może być czerwony');

      // Czerwony link (brakujący)
      assert.ok(result.html.includes('wiki-link-red'), 'Brakujący link powinien mieć klasę wiki-link-red');
      assert.ok(result.html.includes('#/new?title=Komputer%20kwantowy') || result.html.includes('#/new?title=Komputer+kwantowy'),
        'Czerwony link powinien kierować do #/new?title=...');
    });
  });

  describe('computeLineDiff', () => {
    test('poprawnie wykrywa linie same, add i del', () => {
      const oldText = 'Linia 1\nLinia 2 stary\nLinia 3';
      const newText = 'Linia 1\nLinia 2 nowy\nLinia 3\nLinia 4 dodana';

      const diff = computeLineDiff(oldText, newText);
      assert.ok(Array.isArray(diff), 'Diff powinien być tablicą');

      const types = diff.map(d => d.type);
      assert.ok(types.includes('same'), 'Diff powinien zawierać typ same');
      assert.ok(types.includes('del'), 'Diff powinien zawierać typ del');
      assert.ok(types.includes('add'), 'Diff powinien zawierać typ add');

      const delItem = diff.find(d => d.type === 'del');
      assert.ok(delItem.line.includes('Linia 2 stary'));

      const addItem = diff.find(d => d.type === 'add' && d.line.includes('Linia 4 dodana'));
      assert.ok(addItem, 'Dodana linia powinna być odnotowana');
    });

    test('computeLineDiff obsługuje przypadki brzegowe: identyczne teksty, puste teksty, brak starych/nowych linii', () => {
      assert.deepEqual(computeLineDiff('', ''), []);
      assert.deepEqual(computeLineDiff(null, null), []);

      const identical = computeLineDiff('A\nB\nC', 'A\nB\nC');
      assert.equal(identical.length, 3);
      assert.ok(identical.every(d => d.type === 'same'));

      const allAdded = computeLineDiff('', 'Nowa linia');
      assert.equal(allAdded.length, 1);
      assert.equal(allAdded[0].type, 'add');

      const allDeleted = computeLineDiff('Stara linia', '');
      assert.equal(allDeleted.length, 1);
      assert.equal(allDeleted[0].type, 'del');
    });
  });
});

// =============================================================================
// 2. TESTY BAZY DANYCH (src/db.js)
// =============================================================================
describe('2. Baza danych (src/db.js)', () => {
  let createWikiDb;
  let db;

  before(() => {
    const dbModule = require('../src/db.js');
    createWikiDb = dbModule.createWikiDb;
    db = createWikiDb(':memory:');
  });

  test('inicjalizuje tabele i seed startowy (użytkownicy admin i redaktor, 8 artykułów)', () => {
    const users = db.listUsers();
    assert.ok(users.length >= 2, 'Powinny być co najmniej 2 konta');
    const adminUser = users.find(u => u.username === 'admin');
    const editorUser = users.find(u => u.username === 'redaktor');
    assert.ok(adminUser, 'Konto admin powinno istnieć');
    assert.equal(adminUser.role, 'admin');
    assert.ok(editorUser, 'Konto redaktor powinno istnieć');
    assert.equal(editorUser.role, 'editor');

    const articles = db.listArticles({ includeUnpublished: 1 });
    assert.ok(articles.length >= 8, `Oczekiwano co najmniej 8 artykułów w seedzie, otrzymano ${articles.length}`);

    const polska = db.getArticleBySlug('polska');
    assert.ok(polska, 'Artykuł polska powinien istnieć');
    assert.equal(Boolean(polska.is_featured), true, 'Polska powinna być artykułem wyróżnionym');

    const rules = db.getArticleBySlug('zasady-wikikurekk');
    assert.ok(rules, 'Zasady WikiKurekk powinny istnieć');
    assert.equal(Boolean(rules.is_locked), true, 'Zasady powinny być zabezpieczone przed edycją');
  });

  test('CRUD artykułów, tworzenie rewizji oraz przywracanie rewizji (revert)', () => {
    // Create
    const created = db.createArticle({
      title: 'Fizyka relatywistyczna',
      slug: 'fizyka-relatywistyczna',
      summary: 'Dział fizyki opisujący zjawiska przy dużych prędkościach.',
      content: '== Wprowadzenie ==\nTeoria względności Einsteina.',
      infobox: { 'Twórca': 'Albert Einstein', 'Rok': '1905' },
      categories: ['Fizyka', 'Nauka'],
      editor: 'admin',
      edit_comment: 'Utworzenie artykułu'
    });
    assert.equal(created.slug, 'fizyka-relatywistyczna');

    const retrieved = db.getArticleBySlug('fizyka-relatywistyczna');
    assert.equal(retrieved.title, 'Fizyka relatywistyczna');

    let revisions = db.getRevisions('fizyka-relatywistyczna');
    assert.equal(revisions.length, 1);
    const rev1Id = revisions[0].id;

    // Update
    const updated = db.updateArticle('fizyka-relatywistyczna', {
      title: 'Fizyka relatywistyczna (zaktualizowana)',
      summary: 'Nowe podsumowanie.',
      content: '== Nowa treść ==\nDodatkowe wzory i obserwacje.',
      editor: 'redaktor',
      edit_comment: 'Aktualizacja o nowe odkrycia'
    });
    assert.equal(updated.title, 'Fizyka relatywistyczna (zaktualizowana)');

    revisions = db.getRevisions('fizyka-relatywistyczna');
    assert.equal(revisions.length, 2);

    // Revert
    const reverted = db.revertArticleToRevision('fizyka-relatywistyczna', rev1Id, 'admin');
    assert.ok(reverted.content.includes('Teoria względności Einsteina'), 'Treść powinna wrócić do wersji 1');

    revisions = db.getRevisions('fizyka-relatywistyczna');
    assert.equal(revisions.length, 3, 'Po revert powinna powstać nowa 3. rewizja');
  });

  test('dodawanie, pobieranie i usuwanie wiadomości dyskusji (talk)', () => {
    const slug = 'polska';
    const msg = db.addTalkMessage(slug, {
      author: 'Anonimowy Krytyk',
      content: 'Czy możemy zaktualizować dane o ludności?'
    });
    assert.ok(msg && msg.id, 'Wiadomość talk powinna mieć id');

    const messages = db.getTalkMessages(slug);
    assert.ok(messages.some(m => m.id === msg.id), 'Wiadomość powinna być w liście wątku');

    const allTalk = db.listAllTalkMessages(50);
    assert.ok(allTalk.some(m => m.id === msg.id), 'Wiadomość powinna być w liście ogólnej dyskusji');

    db.deleteTalkMessage(msg.id, 'admin');
    const messagesAfter = db.getTalkMessages(slug);
    assert.ok(!messagesAfter.some(m => m.id === msg.id), 'Wiadomość powinna zostać usunięta');
  });

  test('listAllTalkMessages zwraca wpisy z przypisanym article_title', () => {
    const allTalk = db.listAllTalkMessages(10);
    assert.ok(Array.isArray(allTalk) && allTalk.length > 0, 'Powinny być wiadomości dyskusji');
    const first = allTalk[0];
    assert.ok('article_title' in first, 'Wpis dyskusji powinien posiadać pole article_title');
  });

  test('getRecentChanges zwraca obiekty ze slug oraz article_slug', () => {
    const changes = db.getRecentChanges(10);
    assert.ok(Array.isArray(changes) && changes.length > 0, 'Powinny być wpisy ostatnich zmian');
    const first = changes[0];
    assert.ok(first.slug, 'Wpis recentChanges powinien zawierać pole slug');
    assert.ok(first.article_slug, 'Wpis recentChanges powinien zawierać pole article_slug');
    assert.equal(first.slug, first.article_slug, 'slug i article_slug powinny być zgodne');
  });

  test('uwierzytelnianie, rejestracja i zmiana roli użytkownika', () => {
    // Poprawne hasło
    const authAdmin = db.authenticateUser('admin', TEST_ADMIN_PASSWORD);
    assert.ok(authAdmin, 'Uwierzytelnienie admin/ADMIN_PASSWORD powinno się powieść');
    assert.equal(authAdmin.username, 'admin');
    assert.equal(authAdmin.role, 'admin');
    assert.strictEqual(authAdmin.password_hash, undefined, 'Hash hasła nie może być zwracany');

    // Błędne hasło
    const badAuth = db.authenticateUser('admin', 'niepoprawne_haslo');
    assert.ok(!badAuth, 'Błędne hasło powinno zwrócić falsy/null');

    // Rejestracja nowego użytkownika
    const newUser = db.registerUser({
      username: 'jan_kowalski',
      password: 'hasloTestowe123!',
      bio: 'Encyklopedysta hobbysta'
    });
    assert.ok(newUser && newUser.id);
    assert.ok(newUser.role === 'user' || newUser.role === 'editor', 'Nowy użytkownik powinien mieć rolę user lub editor');

    const authNew = db.authenticateUser('jan_kowalski', 'hasloTestowe123!');
    assert.ok(authNew);

    // Zmiana roli
    const updatedUser = db.updateUserRole(newUser.id, 'blocked', 'admin');
    assert.equal(updatedUser.role, 'blocked');
  });

  test('ustawienia wiki, statystyki i audit logi', () => {
    const initialSettings = db.getSettings();
    assert.ok(initialSettings && initialSettings.site_name, 'Ustawienia powinny zawierać site_name');

    db.updateSettings({ announcement_banner: 'Prace konserwacyjne o północy.' }, 'admin');
    const updatedSettings = db.getSettings();
    assert.equal(updatedSettings.announcement_banner, 'Prace konserwacyjne o północy.');

    const stats = db.getStats();
    assert.ok(stats.articlesCount > 0);
    assert.ok(stats.usersCount >= 2);

    const logs = db.getAuditLogs(20);
    assert.ok(Array.isArray(logs));
    assert.ok(logs.length > 0, 'Powinny być zapisane wpisy w audit_log');
  });

  test('walidacja unikalności slug i wymaganych pól (title, content) przy tworzeniu i edycji', () => {
    // Próba utworzenia artykułu z pustym tytułem
    assert.throws(() => {
      db.createArticle({ title: '', content: 'Treść' });
    }, /Tytuł artykułu jest wymagany/);

    // Próba utworzenia artykułu bez treści
    assert.throws(() => {
      db.createArticle({ title: 'Test bez treści', content: null });
    }, /Treść artykułu jest wymagana/);

    // Próba utworzenia duplikatu slug
    assert.throws(() => {
      db.createArticle({ title: 'Polska', content: 'Inna treść o Polsce' });
    }, /już istnieje/);

    // Próba edycji z pustym tytułem
    assert.throws(() => {
      db.updateArticle('polska', { title: '   ' });
    }, /Tytuł artykułu nie może być pusty/);

    // Próba edycji nieistniejącego artykułu
    assert.throws(() => {
      db.updateArticle('artykul-ktorego-nie-ma', { content: 'Nowa treść' });
    }, /nie istnieje/);
  });

  test('bezpieczne parsowanie uszkodzonego formatu JSON w infobox i categories', () => {
    // Utwórz artykuł z uszkodzonymi wartościami tekstowymi
    const created = db.createArticle({
      title: 'Odporność na błędy danych',
      slug: 'odpornosc-na-bledy-danych',
      content: 'Test stabilności',
      infobox: 'nie-json',
      categories: 'nie-json-ale-tekst'
    });

    assert.ok(typeof created.infobox === 'object' && created.infobox !== null);
    assert.ok(Array.isArray(created.categories));
    assert.ok(created.categories.includes('nie-json-ale-tekst'));

    // getCategories deduplikuje kategorie dla danego artykułu
    const cats = db.getCategories();
    assert.ok(Array.isArray(cats));
  });

  test('revert do rewizji innego artykułu rzuca błąd (ochrona spójności danych)', () => {
    const revsPolska = db.getRevisions('polska');
    assert.ok(revsPolska.length > 0);
    const polskaRevId = revsPolska[0].id;

    // Próba przywrócenia rewizji z Polski do Zasady WikiKurekk
    assert.throws(() => {
      db.revertArticleToRevision('zasady-wikikurekk', polskaRevId, 'admin');
    }, /Nie odnaleziono rewizji/);
  });

  test('zarządzanie statusem i usuwaniem nieistniejących artykułów oraz walidacja ról', () => {
    // updateArticleAdminStatus dla nieistniejącego slug zwraca null
    const nonExistentStatus = db.updateArticleAdminStatus('brakujacy-artykul', { is_featured: 1 });
    assert.strictEqual(nonExistentStatus, null);

    // deleteArticle dla nieistniejącego slug zwraca false
    const nonExistentDelete = db.deleteArticle('brakujacy-artykul');
    assert.strictEqual(nonExistentDelete, false);

    // Walidacja ról w createUserByAdmin
    assert.throws(() => {
      db.createUserByAdmin({ username: 'zly_uzytkownik', password: 'haslo123', role: 'nieistniejaca_rola' });
    }, /Nieprawidłowa rola/);

    // Walidacja ról w updateUserRole
    assert.throws(() => {
      db.updateUserRole(1, 'hacker');
    }, /Nieprawidłowa rola/);
  });
});

// =============================================================================
// 3. TESTY API HTTP (src/server.js)
// =============================================================================
describe('3. Serwer HTTP API (src/server.js)', () => {
  let serverInstance;
  let pipePath = null;
  let serverPort = null;
  let adminToken;
  let editorToken;
  let blockedToken;
  let blockedUserId;

  function apiRequest(urlPath, options = {}) {
    return new Promise((resolve, reject) => {
      const reqOptions = pipePath
        ? {
            socketPath: pipePath,
            path: urlPath,
            method: options.method || 'GET',
            headers: options.headers || {}
          }
        : {
            host: '127.0.0.1',
            port: serverPort,
            path: urlPath,
            method: options.method || 'GET',
            headers: options.headers || {}
          };

      const req = http.request(reqOptions, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(body); } catch (_) {}
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body,
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

  before(async () => {
    const { createWikiServer } = require('../src/server.js');
    serverInstance = createWikiServer({ dbPath: ':memory:' });
    const app = serverInstance.app;

    // Próba uruchomienia na porcie losowym (port 0)
    let canTcp = false;
    await new Promise((resolve) => {
      try {
        app.listen(0, '127.0.0.1', () => {
          serverPort = app.address().port;
          const probe = http.get(`http://127.0.0.1:${serverPort}`, () => {
            canTcp = true;
            resolve();
          });
          probe.on('error', () => {
            canTcp = false;
            resolve();
          });
        });
      } catch (_) {
        canTcp = false;
        resolve();
      }
    });

    // Jeśli środowisko piaskownicy blokuje TCP loopback z EACCES, przełącz na IPC pipe
    if (!canTcp) {
      await new Promise(r => app.close(r));
      pipePath = `\\\\.\\pipe\\wiki-test-${Date.now()}`;
      await new Promise(r => app.listen(pipePath, r));
    }

    // Zaloguj administratora
    const adminRes = await apiRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: 'admin', password: TEST_ADMIN_PASSWORD }
    });
    adminToken = adminRes.json.token;

    // Zaloguj redaktora
    const editorRes = await apiRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: 'redaktor', password: TEST_EDITOR_PASSWORD }
    });
    editorToken = editorRes.json.token;

    // Utwórz użytkownika dla testów security
    const regRes = await apiRequest('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: 'pirat', password: 'pirat123', bio: 'Wandal' }
    });
    blockedToken = regRes.json.token;
    blockedUserId = regRes.json.user.id;

    // Zablokuj go przez admin API
    await apiRequest(`/api/admin/users/${blockedUserId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: { role: 'blocked' }
    });
  });

  after(async () => {
    if (serverInstance && serverInstance.app) {
      await new Promise((resolve) => serverInstance.app.close(resolve));
    }
  });

  test('GET /api/bootstrap zwraca pełne podsumowanie stanu wiki', async () => {
    const res = await apiRequest('/api/bootstrap');
    assert.equal(res.status, 200);
    assert.ok(res.json.settings, 'Powinien zawierać settings');
    assert.ok(res.json.stats, 'Powinien zawierać stats');
    assert.ok(res.json.featuredArticle, 'Powinien zawierać featuredArticle');
    assert.ok(Array.isArray(res.json.categories), 'Powinien zawierać kategorie');
    assert.ok(Array.isArray(res.json.allSlugs), 'Powinien zawierać listę slugów');
  });

  test('GET /api/articles/:slug zwraca artykuł wraz z wyrenderowanym HTML i TOC', async () => {
    const res = await apiRequest('/api/articles/polska');
    assert.equal(res.status, 200);
    assert.equal(res.json.article.slug, 'polska');
    assert.ok(res.json.renderedHtml && res.json.renderedHtml.length > 0);
    assert.ok(Array.isArray(res.json.toc));
  });

  test('GET /api/articles/random zwraca losowy slug artykułu', async () => {
    const res = await apiRequest('/api/articles/random');
    assert.equal(res.status, 200);
    assert.ok(typeof res.json.slug === 'string' && res.json.slug.length > 0);
  });

  test('POST /api/auth/login weryfikuje poprawne i błędne dane logowania', async () => {
    const successRes = await apiRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: 'admin', password: TEST_ADMIN_PASSWORD }
    });
    assert.equal(successRes.status, 200);
    assert.ok(successRes.json.token);
    assert.equal(successRes.json.user.username, 'admin');

    const failRes = await apiRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: 'admin', password: 'zlehypotetycznehaslo' }
    });
    assert.equal(failRes.status, 401);
  });

  test('POST /api/articles oraz PUT /api/articles/:slug - tworzenie i edycja artykułów', async () => {
    // Tworzenie
    const createRes = await apiRequest('/api/articles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        title: 'Architektura REST',
        slug: 'architektura-rest',
        summary: 'Styl architektury oprogramowania.',
        content: '== Wstęp ==\nREST to styl architektury sieciowej bazujący na protokole HTTP.',
        categories: ['Informatyka', 'Sieci komputerowe'],
        edit_comment: 'Inicjalne hasło'
      }
    });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.json.article.slug, 'architektura-rest');

    // Edycja
    const editRes = await apiRequest('/api/articles/architektura-rest', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        title: 'Architektura REST (Representational State Transfer)',
        summary: 'Zaktualizowane podsumowanie stylu REST.',
        content: '== Wstęp ==\nREST to wzorzec bazujący na bezstanowości i standardowych metodach HTTP.\n== Metody ==\nGET, POST, PUT, DELETE.',
        edit_comment: 'Rozszerzenie opisu'
      }
    });
    assert.equal(editRes.status, 200);
    assert.ok(editRes.json.renderedHtml.includes('Metody'));
  });

  test('POST /api/preview zwraca wyrenderowany HTML bez zapisywania w bazie', async () => {
    const res = await apiRequest('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        title: 'Podgląd testowy',
        content: '== Sekcja testowa ==\nTest tekstu \'\'kursywą\'\' oraz link do [[Polska]].'
      }
    });
    assert.equal(res.status, 200);
    assert.ok(res.json.renderedHtml.includes('href="#/wiki/polska"'));
    assert.ok(Array.isArray(res.json.toc));
  });

  test('Rewizje, Diff i Revert: /api/articles/:slug/revisions, diff i revert', async () => {
    const slug = 'architektura-rest';

    // Pobranie rewizji
    const revsRes = await apiRequest(`/api/articles/${slug}/revisions`);
    assert.equal(revsRes.status, 200);
    assert.ok(revsRes.json.revisions.length >= 2);

    const id1 = revsRes.json.revisions[revsRes.json.revisions.length - 1].id; // pierwsza
    const id2 = revsRes.json.revisions[0].id; // najnowsza

    // Diff
    const diffRes = await apiRequest(`/api/articles/${slug}/diff?from=${id1}&to=${id2}`);
    assert.equal(diffRes.status, 200);
    assert.ok(Array.isArray(diffRes.json.diff));

    // Revert
    const revertRes = await apiRequest(`/api/articles/${slug}/revert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: { revisionId: id1 }
    });
    assert.equal(revertRes.status, 200);
  });

  test('Dyskusja (talk): GET i POST /api/articles/:slug/talk', async () => {
    const slug = 'polska';
    const postRes = await apiRequest(`/api/articles/${slug}/talk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${editorToken}`
      },
      body: {
        content: 'Świetny artykuł, brawo dla autorów!',
        author: 'redaktor'
      }
    });
    assert.equal(postRes.status, 201);

    const getRes = await apiRequest(`/api/articles/${slug}/talk`);
    assert.equal(getRes.status, 200);
    assert.ok(Array.isArray(getRes.json.messages));
    assert.ok(getRes.json.messages.some(m => m.content.includes('Świetny artykuł')));
  });

  test('Zabezpieczenia i uprawnienia: zablokowany użytkownik (403) oraz strona zablokowana (403 dla redaktora)', async () => {
    // 1. Zablokowany użytkownik próbuje edytować
    const blockedRes = await apiRequest('/api/articles/polska', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${blockedToken}`
      },
      body: {
        content: 'Wandalizm'
      }
    });
    assert.equal(blockedRes.status, 403, 'Zablokowany użytkownik powinien otrzymać status 403');

    // 2. Redaktor próbuje edytować chroniony artykuł (zasady-wikikurekk jest is_locked)
    const lockedRes = await apiRequest('/api/articles/zasady-wikikurekk', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${editorToken}`
      },
      body: {
        content: 'Nieautoryzowana zmiana regulaminu'
      }
    });
    assert.equal(lockedRes.status, 403, 'Nie-admin nie może edytować zablokowanego artykułu (403)');

    // 3. Gość (niezalogowany) nie może tworzyć ani edytować artykułów (401)
    const guestCreateRes = await apiRequest('/api/articles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { title: 'Test gościa', content: 'Treść' }
    });
    assert.equal(guestCreateRes.status, 401, 'Gość nie może tworzyć artykułów (401)');

    const guestEditRes = await apiRequest('/api/articles/polska', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: { content: 'Edycja gościa' }
    });
    assert.equal(guestEditRes.status, 401, 'Gość nie może edytować artykułów (401)');

    // 4. Zwykły zalogowany użytkownik (rola user) nie może edytować (403), natomiast redaktor może (200)
    const regUserRes = await apiRequest('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: 'zwykly_czytelnik', password: 'haslo1234' }
    });
    const regularToken = regUserRes.json.token;

    const userEditRes = await apiRequest('/api/articles/polska', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${regularToken}`
      },
      body: { content: 'Próba edycji przez zwykłego użytkownika' }
    });
    assert.equal(userEditRes.status, 403, 'Użytkownik z rolą user nie może edytować artykułów (403)');

    const editorEditRes = await apiRequest('/api/articles/polska', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${editorToken}`
      },
      body: { content: '== Geografia ==\nAktualizacja redaktorska.', edit_comment: 'Korekta redaktora' }
    });
    assert.equal(editorEditRes.status, 200, 'Redaktor powinien móc edytować otwarty artykuł (200)');
  });

  test('Endpointy administratora /api/admin/* (autoryzacja i operacje)', async () => {
    // Brak uprawnień dla redaktora -> 403
    const forbiddenRes = await apiRequest('/api/admin/dashboard', {
      headers: { 'Authorization': `Bearer ${editorToken}` }
    });
    assert.equal(forbiddenRes.status, 403);

    // Dostęp dla admina -> 200
    const dashRes = await apiRequest('/api/admin/dashboard', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.equal(dashRes.status, 200);
    assert.ok(dashRes.json.stats);
    assert.ok(dashRes.json.articles);
    assert.ok(dashRes.json.users);

    // PATCH /api/admin/articles/:slug/status
    const statusRes = await apiRequest('/api/admin/articles/architektura-rest/status', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: { is_featured: 1 }
    });
    assert.equal(statusRes.status, 200);

    // PUT /api/admin/settings
    const setRes = await apiRequest('/api/admin/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        site_name: 'WikiKurekk Testowa',
        site_tagline: 'Wiedza dla każdego'
      }
    });
    assert.equal(setRes.status, 200);

    // DELETE /api/admin/articles/:slug
    const delRes = await apiRequest('/api/admin/articles/architektura-rest', {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.equal(delRes.status, 200);
  });

  test('walidacja JSON i kody błędów 400/404 dla żądań do artykułów i rewizji', async () => {
    // 1. Nieprawidłowy JSON w żądaniu POST
    const badJsonRes = await apiRequest('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ to nie jest poprawny json'
    });
    assert.equal(badJsonRes.status, 400, 'Nieprawidłowy JSON powinien zwrócić status 400');
    assert.ok(badJsonRes.json.error);

    // 2. 404 dla nieistniejącego artykułu w GET /api/articles/:slug
    const notFoundArtRes = await apiRequest('/api/articles/nieistniejacy-artykul-xyz');
    assert.equal(notFoundArtRes.status, 404);

    // 3. 404 dla nieistniejącego artykułu w revisions
    const notFoundRevsRes = await apiRequest('/api/articles/nieistniejacy-artykul-xyz/revisions');
    assert.equal(notFoundRevsRes.status, 404);

    // 4. 404 dla nieistniejącego artykułu w dyskusji GET i POST /talk
    const notFoundTalkGet = await apiRequest('/api/articles/nieistniejacy-artykul-xyz/talk');
    assert.equal(notFoundTalkGet.status, 404);

    const notFoundTalkPost = await apiRequest('/api/articles/nieistniejacy-artykul-xyz/talk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { content: 'Wiadomość do pustki' }
    });
    assert.equal(notFoundTalkPost.status, 404);

    // 5. 400 dla pustej wiadomości w dyskusji istniejącego artykułu
    const emptyTalkRes = await apiRequest('/api/articles/polska/talk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { content: '   ' }
    });
    assert.equal(emptyTalkRes.status, 400);

    // 6. 404 dla revert na nieistniejącym artykule
    const notFoundRevert = await apiRequest('/api/articles/nieistniejacy-artykul-xyz/revert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: { revisionId: 1 }
    });
    assert.equal(notFoundRevert.status, 404);
  });

  test('ochrona przed wyciekiem rewizji pomiędzy różnymi artykułami w /api/articles/:slug/diff (400)', async () => {
    // Pobierz rewizję z artykułu polska i z artykułu javascript
    const polskaRevs = await apiRequest('/api/articles/polska/revisions');
    const jsRevs = await apiRequest('/api/articles/javascript/revisions');
    assert.ok(polskaRevs.json.revisions.length > 0);
    assert.ok(jsRevs.json.revisions.length > 0);

    const polskaRevId = polskaRevs.json.revisions[0].id;
    const jsRevId = jsRevs.json.revisions[0].id;

    // Próba porównania rewizji z JavaScript przez ścieżkę artykułu Polska -> 400
    const leakDiffRes = await apiRequest(`/api/articles/polska/diff?from=${polskaRevId}&to=${jsRevId}`);
    assert.equal(leakDiffRes.status, 400, 'Diff z rewizją innego artykułu powinien zwrócić 400 Bad Request');
    assert.ok(leakDiffRes.json.error.includes('Rewizje nie należą'));

    // Błędne identyfikatory from/to (NaN) -> 400
    const badParamsDiff = await apiRequest('/api/articles/polska/diff?from=abc&to=xyz');
    assert.equal(badParamsDiff.status, 400);
  });

  test('walidacja unikalności i wymaganych pól w POST /api/articles (400 i 409) oraz PUT (400 i 404)', async () => {
    // 1. Brak tytułu w POST /api/articles -> 400
    const noTitleRes = await apiRequest('/api/articles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: { content: 'Treść bez tytułu' }
    });
    assert.equal(noTitleRes.status, 400);

    // 2. Duplikat tytułu/slug -> 409 Conflict
    const dupRes = await apiRequest('/api/articles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: { title: 'Polska', content: 'Kopia' }
    });
    assert.equal(dupRes.status, 409, 'Tworzenie duplikatu artykułu powinno zwrócić 409 Conflict');

    // 3. PUT na nieistniejącym artykule -> 404
    const notFoundPut = await apiRequest('/api/articles/nie-ma-takiego-artykulu', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: { content: 'Nowa treść' }
    });
    assert.equal(notFoundPut.status, 404);

    // 4. PUT z pustym tytułem -> 400
    const emptyTitlePut = await apiRequest('/api/articles/polska', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: { title: '   ' }
    });
    assert.equal(emptyTitlePut.status, 400);
  });

  test('walidacja i statusy w panelu administratora (404, 400, 409)', async () => {
    // 1. DELETE nieistniejącego artykułu -> 404
    const delNonExistent = await apiRequest('/api/admin/articles/nie-ma-artykulu-123', {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.equal(delNonExistent.status, 404);

    // 2. DELETE nieistniejącej wiadomości talk -> 404
    const delNonExistentTalk = await apiRequest('/api/admin/talk/999999', {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.equal(delNonExistentTalk.status, 404);

    // 3. PATCH statusu nieistniejącego artykułu -> 404
    const patchNonExistentStatus = await apiRequest('/api/admin/articles/nie-ma-artykulu-123/status', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: { is_featured: 1 }
    });
    assert.equal(patchNonExistentStatus.status, 404);

    // 4. POST użytkownika który już istnieje -> 409
    const dupUser = await apiRequest('/api/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: { username: 'admin', password: 'nowehaslo123', role: 'admin' }
    });
    assert.equal(dupUser.status, 409);

    // 5. POST użytkownika z nieprawidłową rolą -> 400
    const badRoleUser = await apiRequest('/api/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: { username: 'nowy_tester', password: 'haslo123', role: 'root_super_admin' }
    });
    assert.equal(badRoleUser.status, 400);

    // 6. PATCH /api/admin/users/:id - próba odebrania sobie uprawnień admina -> 400
    const meRes = await apiRequest('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const myId = meRes.json.user.id;
    const demoteSelf = await apiRequest(`/api/admin/users/${myId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: { role: 'blocked' }
    });
    assert.equal(demoteSelf.status, 400, 'Administrator nie może zablokować ani zdemotować samego siebie');
  });

  test('bezpieczeństwo tokenów i brak wycieku hashy/soli w odpowiedziach API auth oraz blokada path traversal', async () => {
    // 1. Sprawdzenie czy endpointy logowania i profilu nie zwracają pól hash/salt
    const loginCheck = await apiRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: 'admin', password: TEST_ADMIN_PASSWORD }
    });
    assert.equal(loginCheck.status, 200);
    assert.strictEqual(loginCheck.json.user.password_hash, undefined);
    assert.strictEqual(loginCheck.json.user.salt, undefined);

    const meCheck = await apiRequest('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(meCheck.json.user.password_hash, undefined);
    assert.strictEqual(meCheck.json.user.salt, undefined);

    // 2. Próba wyjścia poza public/ (path traversal) -> 403 Forbidden
    const traversal = await apiRequest('/../package.json');
    assert.equal(traversal.status, 403, 'Path traversal poza katalog public/ musi zwracać 403 Forbidden');
  });
});

// =============================================================================
// 4. SPRAWDZENIE SPÓJNOŚCI PLIKÓW INTERFEJSU (public/)
// =============================================================================
describe('4. Spójność plików interfejsu (public/)', () => {
  const indexPath = path.join(ROOT_DIR, 'public', 'index.html');
  const appJsPath = path.join(ROOT_DIR, 'public', 'app.js');
  const stylesCssPath = path.join(ROOT_DIR, 'public', 'styles.css');

  test('weryfikacja obecności kluczowych ID w public/index.html', () => {
    assert.ok(fs.existsSync(indexPath), 'Plik public/index.html musi istnieć');
    const html = fs.readFileSync(indexPath, 'utf-8');

    const requiredIds = [
      'view-root',
      'auth-modal',
      'search-form',
      'article-tabs-bar'
    ];

    for (const id of requiredIds) {
      assert.ok(
        html.includes(`id="${id}"`) || html.includes(`id='${id}'`),
        `public/index.html powinien zawierać element o id="${id}"`
      );
    }
  });

  test('interfejs nie zawiera wbudowanych danych logowania ani publicznych linków do panelu', () => {
    const html = fs.readFileSync(indexPath, 'utf-8');
    const js = fs.readFileSync(appJsPath, 'utf-8');
    for (const [name, src] of [['index.html', html], ['app.js', js]]) {
      assert.ok(!/admin123|wiki123/.test(src), `${name} nie może zawierać zaszytych haseł`);
      assert.ok(!src.includes('#/admin'), `${name} nie może linkować do #/admin`);
      assert.ok(!/quick-admin-btn|demo-admin-login-btn|demo-editor-login-btn/.test(src), `${name} nie może zawierać przycisków szybkiego logowania`);
    }
    assert.ok(html.includes('id="register-modal-btn"'), 'Nagłówek powinien mieć przycisk "Zarejestruj się"');
    assert.ok(js.includes("'#/panel'"), 'Panel powinien być dostępny pod #/panel');
  });

  test('sprawdzenie poprawności składni public/app.js (node --check)', () => {
    assert.ok(fs.existsSync(appJsPath), 'Plik public/app.js musi istnieć');
    assert.doesNotThrow(() => {
      execSync(`node --check "${appJsPath}"`, { stdio: 'pipe' });
    }, 'Składnia public/app.js musi być poprawna w node --check');
  });

  test('sprawdzenie obecności arkusza stylów public/styles.css oraz klas katalogu', () => {
    assert.ok(fs.existsSync(stylesCssPath), 'Plik public/styles.css musi istnieć');
    const css = fs.readFileSync(stylesCssPath, 'utf-8');
    assert.ok(css.length > 50, 'public/styles.css nie może być pusty');
    assert.ok(css.includes('.catalog-article-card'), 'public/styles.css powinien zawierać styl .catalog-article-card');
    assert.ok(css.includes('.catalog-filter-bar'), 'public/styles.css powinien zawierać styl .catalog-filter-bar');
    assert.ok(css.includes('.form-control'), 'public/styles.css powinien zawierać styl .form-control');
  });

  test('weryfikacja braku wycieku [object Object] w opcjach kategorii katalogu w public/app.js', () => {
    const appJs = fs.readFileSync(appJsPath, 'utf-8');
    assert.ok(!appJs.includes('<option value="${escapeHtml(c)}"'), 'public/app.js nie może mapować bezpośrednio obiektów kategorii c do opcji');
    assert.ok(appJs.includes('getCatName(c)'), 'public/app.js powinien używać pomocnika getCatName');
  });
});
