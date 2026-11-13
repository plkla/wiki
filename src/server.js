'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createWikiDb } = require('./db.js');
const { renderWikiContent, computeLineDiff, slugify, isSafeUrl, computeReadingStats } = require('./wiki-parser.js');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
};

function safeDecode(str) {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...rest } = user;
  return rest;
}

function parseInfoboxInput(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

function validateInfoboxForSave(raw) {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null || raw === '') return { ok: true, value: '{}' };

  const obj = parseInfoboxInput(raw);
  if (!obj) {
    return { ok: true, value: '{}' };
  }

  if ('image' in obj && obj.image !== undefined && obj.image !== null) {
    const img = String(obj.image).trim();
    if (img !== '' && !isSafeUrl(img, { allowRelative: true })) {
      return {
        ok: false,
        error: 'Nieprawidłowy adres URL obrazka w infoboksie. Dozwolone są wyłącznie protokoły http://, https:// lub ścieżka względna /.'
      };
    }
  }

  return { ok: true, value: JSON.stringify(obj) };
}

function sanitizeInfoboxForPreview(raw) {
  const obj = parseInfoboxInput(raw);
  if (!obj || Object.keys(obj).length === 0) return null;

  const clean = { ...obj };
  if ('image' in clean) {
    const img = clean.image == null ? '' : String(clean.image).trim();
    if (!img || !isSafeUrl(img, { allowRelative: true })) {
      delete clean.image;
    } else {
      clean.image = img;
    }
  }
  return clean;
}

function normalizePreviewCategories(raw) {
  if (Array.isArray(raw)) {
    return raw.map(c => String(c || '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map(c => String(c || '').trim()).filter(Boolean);
        }
      } catch {}
    }
    return trimmed.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function checkEditPermission(user, settings, canUserEditFn) {
  const anonAllowed = String(settings && settings.allow_anonymous_edits) === '1';
  if (!user && !anonAllowed) {
    return { status: 401, message: 'Wymagane logowanie do edycji encyklopedii.' };
  }
  if (user && user.role === 'blocked') {
    return { status: 403, message: 'Konto zablokowane.' };
  }
  if (user && !anonAllowed && !canUserEditFn(user)) {
    return { status: 403, message: 'Edycja encyklopedii wymaga uprawnień redaktora lub administratora.' };
  }
  return null;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw || !raw.trim()) {
        return resolve({});
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed);
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Wiki-Token'
  });
  res.end(json);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function getToken(req) {
  const auth = req.headers['authorization'];
  if (auth && typeof auth === 'string') {
    const parts = auth.split(' ');
    if (parts.length === 2 && /^bearer$/i.test(parts[0])) {
      return parts[1].trim();
    }
  }
  const custom = req.headers['x-wiki-token'];
  if (custom && typeof custom === 'string') {
    return custom.trim();
  }
  return null;
}

function getAuthUser(req, sessions, db) {
  const token = getToken(req);
  if (!token) return { token: null, user: null };
  const userId = sessions.get(token);
  if (userId === undefined) return { token, user: null };
  const user = db.getUserById(userId);
  if (!user) {
    sessions.delete(token);
    return { token, user: null };
  }
  return { token, user };
}

const STATIC_NO_CACHE_HEADERS = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
  'Access-Control-Allow-Origin': '*'
};

/**
 * Send a static file from PUBLIC_DIR with no-cache headers so clients never keep stale assets.
 */
function sendStaticFile(req, res, filePath, stat) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    ...STATIC_NO_CACHE_HEADERS
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

function serveStatic(req, res, pathname) {
  let relativePath = String(pathname || '/').split('?')[0];
  if (relativePath === '/' || relativePath === '') {
    relativePath = '/index.html';
  }

  const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendError(res, 403, 'Forbidden');
  }

  let stat = null;
  try {
    if (fs.existsSync(filePath)) {
      stat = fs.statSync(filePath);
    }
  } catch {
    stat = null;
  }

  if (stat && stat.isFile()) {
    return sendStaticFile(req, res, filePath, stat);
  }

  if (relativePath.startsWith('/api')) {
    return sendError(res, 404, 'Endpoint nie istnieje.');
  }

  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    const indexStat = fs.statSync(indexPath);
    return sendStaticFile(req, res, indexPath, indexStat);
  }

  const fallbackHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>WikiKurekk</title></head><body><div id="view-root">WikiKurekk</div></body></html>';
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(fallbackHtml),
    ...STATIC_NO_CACHE_HEADERS
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(fallbackHtml);
}

function createWikiServer({ dbPath } = {}) {
  const db = createWikiDb(dbPath);
  const sessions = new Map();

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Wiki-Token',
        'Content-Length': 0
      });
      res.end();
      return;
    }

    const host = req.headers.host || 'localhost';
    const parsedUrl = new URL(req.url, `http://${host}`);
    const pathname = parsedUrl.pathname;
    const query = Object.fromEntries(parsedUrl.searchParams.entries());

    if (!pathname.startsWith('/api')) {
      if (req.method === 'GET' || req.method === 'HEAD') {
        return serveStatic(req, res, pathname);
      }
      return sendError(res, 405, 'Metoda niedozwolona.');
    }

    const { token, user: currentUser } = getAuthUser(req, sessions, db);

    let body = {};
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        return sendError(res, 400, 'Nieprawidłowe dane JSON w treści żądania.');
      }
    }

    try {
      // 1. GET /api/bootstrap
      if (pathname === '/api/bootstrap' && req.method === 'GET') {
        const settings = db.getSettings ? db.getSettings() : {};
        const stats = db.getStats ? db.getStats() : {};
        const allSlugs = db.getAllSlugs ? db.getAllSlugs() : [];
        const slugsSet = new Set(allSlugs);

        let featuredArticle = null;
        const rawFeatured = db.getFeaturedArticle ? db.getFeaturedArticle() : null;
        if (rawFeatured) {
          const { html, toc } = renderWikiContent(rawFeatured.content || '', slugsSet);
          featuredArticle = {
            ...rawFeatured,
            renderedHtml: html,
            toc
          };
        }

        const isAdmin = Boolean(currentUser && currentUser.role === 'admin');
        const recentArticles = db.listArticles ? db.listArticles({ limit: 10 }) : [];
        const recentChanges = db.getRecentChanges ? db.getRecentChanges(10, { includeUnpublished: isAdmin }) : [];
        const categories = db.getCategories ? db.getCategories() : [];

        return sendJson(res, 200, {
          settings,
          stats,
          featuredArticle,
          recentArticles,
          recentChanges,
          categories,
          allSlugs,
          currentUser: sanitizeUser(currentUser)
        });
      }

      // 2. Auth routes
      if (pathname === '/api/auth/login' && req.method === 'POST') {
        const { username, password } = body;
        if (!username || !password) {
          return sendError(res, 400, 'Wymagana nazwa użytkownika i hasło.');
        }
        const user = db.authenticateUser(username, password);
        if (!user) {
          return sendError(res, 401, 'Nieprawidłowa nazwa użytkownika lub hasło.');
        }
        const newToken = crypto.randomBytes(24).toString('hex');
        sessions.set(newToken, user.id);
        return sendJson(res, 200, {
          token: newToken,
          user: sanitizeUser(user)
        });
      }

      if (pathname === '/api/auth/register' && req.method === 'POST') {
        const { username, password, bio } = body;
        if (!username || !password) {
          return sendError(res, 400, 'Wymagana nazwa użytkownika i hasło.');
        }
        if (typeof username !== 'string' || username.trim().length < 2) {
          return sendError(res, 400, 'Nazwa użytkownika musi zawierać co najmniej 2 znaki.');
        }
        if (typeof password !== 'string' || password.length < 3) {
          return sendError(res, 400, 'Hasło musi zawierać co najmniej 3 znaki.');
        }
        const existing = db.getUserByUsername ? db.getUserByUsername(username.trim()) : null;
        if (existing) {
          return sendError(res, 409, 'Użytkownik o takiej nazwie już istnieje.');
        }
        try {
          const user = db.registerUser({
            username: username.trim(),
            password,
            bio: bio || ''
          });
          if (!user) {
            return sendError(res, 400, 'Rejestracja nie powiodła się.');
          }
          const newToken = crypto.randomBytes(24).toString('hex');
          sessions.set(newToken, user.id);
          return sendJson(res, 201, {
            token: newToken,
            user: sanitizeUser(user)
          });
        } catch (err) {
          return sendError(res, 400, err.message || 'Błąd rejestracji.');
        }
      }

      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        if (token) {
          sessions.delete(token);
        }
        return sendJson(res, 200, { ok: true });
      }

      if (pathname === '/api/auth/me' && req.method === 'GET') {
        return sendJson(res, 200, {
          user: sanitizeUser(currentUser) || null
        });
      }

      // 3. Articles list & random
      if (pathname === '/api/articles' && req.method === 'GET') {
        const isAdmin = currentUser && currentUser.role === 'admin';
        const includeUnpublished = query.includeUnpublished === '1' && isAdmin;
        const articles = db.listArticles({
          q: query.q,
          category: query.category,
          includeUnpublished
        });
        return sendJson(res, 200, { articles });
      }

      if (pathname === '/api/articles/random' && req.method === 'GET') {
        const slug = db.getRandomArticleSlug();
        if (!slug) {
          return sendError(res, 404, 'Brak artykułów w encyklopedii.');
        }
        return sendJson(res, 200, { slug });
      }

      // Helper uprawnień edycji: tylko zalogowany admin lub editor
      const canUserEdit = (user) => Boolean(user && (user.role === 'admin' || user.role === 'editor'));

      // 4. POST /api/articles (Create article)
      if (pathname === '/api/articles' && req.method === 'POST') {
        const settings = db.getSettings ? db.getSettings() : {};
        const permError = checkEditPermission(currentUser, settings, canUserEdit);
        if (permError) {
          return sendError(res, permError.status, permError.message);
        }

        const { title, slug: customSlug, summary, content, infobox, categories, edit_comment } = body;
        if (typeof title !== 'string' || !title.trim()) {
          return sendError(res, 400, 'Tytuł jest wymagany.');
        }
        if (typeof content !== 'string' || !content.trim()) {
          return sendError(res, 400, 'Treść artykułu jest wymagana i nie może być pusta.');
        }
        const infoboxCheck = validateInfoboxForSave(infobox);
        if (!infoboxCheck.ok) {
          return sendError(res, 400, infoboxCheck.error);
        }

        const editor = currentUser ? currentUser.username : 'Anonim';
        const finalSlug = (typeof customSlug === 'string' && customSlug.trim())
          ? slugify(customSlug.trim())
          : slugify(title.trim());

        try {
          const article = db.createArticle({
            title: title.trim(),
            slug: finalSlug,
            summary: summary || '',
            content,
            infobox: infoboxCheck.value !== undefined ? infoboxCheck.value : '{}',
            categories: categories !== undefined ? categories : '',
            editor,
            edit_comment: edit_comment || 'Utworzenie artykułu'
          });

          const allSlugs = new Set(db.getAllSlugs ? db.getAllSlugs() : []);
          const { html, toc } = renderWikiContent(article.content || '', allSlugs);
          return sendJson(res, 201, {
            article,
            renderedHtml: html,
            toc
          });
        } catch (err) {
          return sendError(res, 400, err.message || 'Błąd podczas tworzenia artykułu.');
        }
      }

      // 5. POST /api/preview
      if (pathname === '/api/preview' && req.method === 'POST') {
        const { title = '', summary = '', content = '', infobox = null, categories = [] } = body || {};
        const allSlugs = new Set(db.getAllSlugs ? db.getAllSlugs() : []);
        const rawContent = content == null ? '' : String(content);
        const { html, toc, references, links } = renderWikiContent(rawContent, allSlugs);
        const { wordCount, readingTimeMinutes } = computeReadingStats(html);
        const safeInfobox = sanitizeInfoboxForPreview(infobox);
        const safeCategories = normalizePreviewCategories(categories);

        return sendJson(res, 200, {
          title: typeof title === 'string' ? title.trim() : '',
          summary: typeof summary === 'string' ? summary.trim() : '',
          renderedHtml: html,
          toc,
          references,
          links,
          wordCount,
          readingTimeMinutes,
          infobox: safeInfobox,
          categories: safeCategories
        });
      }

      // 6. GET /api/recent-changes
      if (pathname === '/api/recent-changes' && req.method === 'GET') {
        const isAdmin = Boolean(currentUser && currentUser.role === 'admin');
        const limit = parseInt(query.limit, 10) || 50;
        const changes = db.getRecentChanges(limit, { includeUnpublished: isAdmin });
        return sendJson(res, 200, { changes });
      }

      // 7. Article Sub-routes: /api/articles/:slug(...)
      const articleMatch = pathname.match(/^\/api\/articles\/([^/]+)(?:\/(revisions|diff|revert|talk))?$/);
      if (articleMatch) {
        const rawSlug = articleMatch[1];
        const subRoute = articleMatch[2];
        const slug = safeDecode(rawSlug);
        const isAdmin = Boolean(currentUser && currentUser.role === 'admin');

        // GET /api/articles/:slug
        if (!subRoute && req.method === 'GET') {
          const incrementViews = query.noView !== '1';
          const article = db.getArticleBySlug(slug, {
            incrementViews,
            includeUnpublished: isAdmin
          });

          if (!article) {
            return sendError(res, 404, 'Artykuł nie został odnaleziony.');
          }
          if (article.is_published === 0 && !isAdmin) {
            return sendError(res, 404, 'Artykuł nie został odnaleziony.');
          }

          const allSlugs = new Set(db.getAllSlugs ? db.getAllSlugs() : []);
          const { html, toc, references, links } = renderWikiContent(article.content || '', allSlugs);
          const revisions = db.getRevisions ? db.getRevisions(slug) : [];
          const talkMessages = db.getTalkMessages ? db.getTalkMessages(slug) : [];

          return sendJson(res, 200, {
            article,
            renderedHtml: html,
            toc,
            references,
            links,
            revisionsCount: revisions.length,
            talkCount: talkMessages.length
          });
        }

        // PUT /api/articles/:slug
        if (!subRoute && req.method === 'PUT') {
          const settings = db.getSettings ? db.getSettings() : {};
          const permError = checkEditPermission(currentUser, settings, canUserEdit);
          if (permError) {
            return sendError(res, permError.status, permError.message);
          }

          const existing = db.getArticleBySlug(slug, { includeUnpublished: isAdmin });
          if (!existing) {
            return sendError(res, 404, 'Artykuł nie został odnaleziony.');
          }
          if (existing.is_locked && !isAdmin) {
            return sendError(res, 403, 'Artykuł jest zabezpieczony przed edycją.');
          }

          if (body.title !== undefined && (typeof body.title !== 'string' || !body.title.trim())) {
            return sendError(res, 400, 'Tytuł artykułu nie może być pusty.');
          }
          if (body.content !== undefined && (typeof body.content !== 'string' || !body.content.trim())) {
            return sendError(res, 400, 'Treść artykułu nie może być pusta.');
          }

          const infoboxCheck = validateInfoboxForSave(body.infobox);
          if (!infoboxCheck.ok) {
            return sendError(res, 400, infoboxCheck.error);
          }

          if (
            body.base_updated_at !== undefined &&
            body.base_updated_at !== null &&
            String(body.base_updated_at).trim() !== '' &&
            String(body.base_updated_at) !== String(existing.updated_at)
          ) {
            return sendJson(res, 409, {
              error: 'Wykryto konflikt edycji: artykuł został zaktualizowany w międzyczasie.',
              conflict: true,
              currentArticle: existing
            });
          }

          const editor = currentUser ? currentUser.username : 'Anonim';
          try {
            const updated = db.updateArticle(slug, {
              title: body.title !== undefined ? body.title : existing.title,
              summary: body.summary !== undefined ? body.summary : existing.summary,
              content: body.content !== undefined ? body.content : existing.content,
              infobox: infoboxCheck.value !== undefined ? infoboxCheck.value : existing.infobox,
              categories: body.categories !== undefined ? body.categories : existing.categories,
              editor,
              edit_comment: body.edit_comment || 'Edycja artykułu',
              force: isAdmin
            });

            const allSlugs = new Set(db.getAllSlugs ? db.getAllSlugs() : []);
            const { html, toc } = renderWikiContent(updated.content || '', allSlugs);
            return sendJson(res, 200, {
              article: updated,
              renderedHtml: html,
              toc
            });
          } catch (err) {
            return sendError(res, 400, err.message || 'Błąd podczas aktualizacji artykułu.');
          }
        }

        // GET /api/articles/:slug/revisions
        if (subRoute === 'revisions' && req.method === 'GET') {
          const article = db.getArticleBySlug(slug, { includeUnpublished: isAdmin });
          if (!article) {
            return sendError(res, 404, 'Artykuł nie został odnaleziony.');
          }
          const revisions = db.getRevisions(slug);
          return sendJson(res, 200, {
            article: { slug: article.slug, title: article.title },
            revisions
          });
        }

        // GET /api/articles/:slug/diff?from=:id1&to=:id2
        if (subRoute === 'diff' && req.method === 'GET') {
          const article = db.getArticleBySlug(slug, { includeUnpublished: isAdmin });
          if (!article) {
            return sendError(res, 404, 'Artykuł nie został odnaleziony.');
          }
          const fromId = parseInt(query.from, 10);
          const toId = parseInt(query.to, 10);
          if (!fromId || !toId) {
            return sendError(res, 400, 'Wymagane poprawne parametry from i to.');
          }
          const fromRev = db.getRevisionById(fromId);
          const toRev = db.getRevisionById(toId);
          if (
            !fromRev ||
            !toRev ||
            String(fromRev.article_slug).toLowerCase() !== article.slug.toLowerCase() ||
            String(toRev.article_slug).toLowerCase() !== article.slug.toLowerCase()
          ) {
            return sendError(res, 404, 'Nie znaleziono wskazanych rewizji dla tego artykułu.');
          }
          const diff = computeLineDiff(fromRev.content, toRev.content);
          return sendJson(res, 200, { fromRev, toRev, diff });
        }

        // POST /api/articles/:slug/revert
        if (subRoute === 'revert' && req.method === 'POST') {
          if (!currentUser) {
            return sendError(res, 401, 'Wymagane logowanie do edycji encyklopedii.');
          }
          if (currentUser.role === 'blocked') {
            return sendError(res, 403, 'Konto zablokowane.');
          }
          if (!canUserEdit(currentUser)) {
            return sendError(res, 403, 'Przywracanie wersji wymaga uprawnień redaktora lub administratora.');
          }

          const existing = db.getArticleBySlug(slug, { includeUnpublished: isAdmin });
          if (!existing) {
            return sendError(res, 404, 'Artykuł nie został odnaleziony.');
          }
          if (existing.is_locked && !isAdmin) {
            return sendError(res, 403, 'Artykuł jest zabezpieczony przed edycją.');
          }

          const revisionId = parseInt(body.revisionId, 10);
          if (!revisionId) {
            return sendError(res, 400, 'Wymagany parametr revisionId.');
          }

          const actor = currentUser ? currentUser.username : 'Anonim';
          try {
            const article = db.revertArticleToRevision(slug, revisionId, actor);
            if (!article) {
              return sendError(res, 400, 'Nie udało się przywrócić wskazanej rewizji.');
            }
            const allSlugs = new Set(db.getAllSlugs ? db.getAllSlugs() : []);
            const { html, toc } = renderWikiContent(article.content || '', allSlugs);
            return sendJson(res, 200, {
              article,
              renderedHtml: html,
              toc
            });
          } catch (err) {
            return sendError(res, 400, err.message || 'Błąd podczas przywracania wersji.');
          }
        }

        // GET /api/articles/:slug/talk
        if (subRoute === 'talk' && req.method === 'GET') {
          const article = db.getArticleBySlug(slug, { includeUnpublished: isAdmin });
          if (!article) {
            return sendError(res, 404, 'Artykuł nie został odnaleziony.');
          }
          const messages = db.getTalkMessages(slug);
          return sendJson(res, 200, { messages });
        }

        // POST /api/articles/:slug/talk
        if (subRoute === 'talk' && req.method === 'POST') {
          if (currentUser && currentUser.role === 'blocked') {
            return sendError(res, 403, 'Konto zablokowane.');
          }
          const article = db.getArticleBySlug(slug, { includeUnpublished: isAdmin });
          if (!article) {
            return sendError(res, 404, 'Artykuł nie został odnaleziony.');
          }
          const { content, author: customAuthor } = body;
          if (!content || !content.trim()) {
            return sendError(res, 400, 'Treść wiadomości nie może być pusta.');
          }

          const author = currentUser
            ? currentUser.username
            : (customAuthor && customAuthor.trim() ? customAuthor.trim() : 'Anonim');

          try {
            const message = db.addTalkMessage(slug, {
              author,
              content: content.trim()
            });
            return sendJson(res, 201, { message });
          } catch (err) {
            return sendError(res, 400, err.message || 'Błąd podczas dodawania wiadomości.');
          }
        }
      }

      // 8. Admin Panel API (/api/admin/*)
      if (pathname.startsWith('/api/admin/')) {
        if (!currentUser || currentUser.role !== 'admin') {
          return sendError(res, 403, 'Wymagane uprawnienia administratora.');
        }

        // GET /api/admin/dashboard
        if (pathname === '/api/admin/dashboard' && req.method === 'GET') {
          const stats = db.getStats ? db.getStats() : {};
          const settings = db.getSettings ? db.getSettings() : {};
          const articles = db.listArticles ? db.listArticles({ includeUnpublished: true }) : [];
          const users = (db.listUsers ? db.listUsers() : []).map(sanitizeUser);
          const recentAuditLogs = db.getAuditLogs ? db.getAuditLogs(20) : [];
          const recentTalkMessages = db.listAllTalkMessages ? db.listAllTalkMessages(20) : [];

          return sendJson(res, 200, {
            stats,
            settings,
            articles,
            users,
            recentAuditLogs,
            recentTalkMessages
          });
        }

        // PATCH /api/admin/articles/:slug/status
        const articleStatusMatch = pathname.match(/^\/api\/admin\/articles\/([^/]+)\/status$/);
        if (articleStatusMatch && req.method === 'PATCH') {
          const slug = safeDecode(articleStatusMatch[1]);
          const { is_locked, is_featured, is_published } = body;
          const article = db.updateArticleAdminStatus(slug, {
            is_locked,
            is_featured,
            is_published
          }, currentUser.username);

          if (!article) {
            return sendError(res, 404, 'Artykuł nie został odnaleziony.');
          }
          return sendJson(res, 200, { article });
        }

        // DELETE /api/admin/articles/:slug
        const articleDeleteMatch = pathname.match(/^\/api\/admin\/articles\/([^/]+)$/);
        if (articleDeleteMatch && req.method === 'DELETE') {
          const slug = safeDecode(articleDeleteMatch[1]);
          db.deleteArticle(slug, currentUser.username);
          return sendJson(res, 200, { deleted: true, slug });
        }

        // POST /api/admin/users
        if (pathname === '/api/admin/users' && req.method === 'POST') {
          const { username, password, role, bio } = body;
          if (!username || !password) {
            return sendError(res, 400, 'Nazwa użytkownika i hasło są wymagane.');
          }
          try {
            const user = db.createUserByAdmin({
              username: username.trim(),
              password,
              role: role || 'editor',
              bio: bio || ''
            }, currentUser.username);
            return sendJson(res, 201, { user: sanitizeUser(user) });
          } catch (err) {
            return sendError(res, 400, err.message || 'Błąd podczas tworzenia użytkownika.');
          }
        }

        // PATCH /api/admin/users/:id
        const userPatchMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
        if (userPatchMatch && req.method === 'PATCH') {
          const targetId = parseInt(userPatchMatch[1], 10);
          const { role } = body;
          if (!role) {
            return sendError(res, 400, 'Brak nowej roli użytkownika.');
          }
          try {
            const user = db.updateUserRole(targetId, role, currentUser.username);
            if (!user) {
              return sendError(res, 404, 'Użytkownik nie został odnaleziony.');
            }
            return sendJson(res, 200, { user: sanitizeUser(user) });
          } catch (err) {
            return sendError(res, 400, err.message || 'Błąd podczas aktualizacji roli użytkownika.');
          }
        }

        // DELETE /api/admin/talk/:id
        const talkDeleteMatch = pathname.match(/^\/api\/admin\/talk\/([^/]+)$/);
        if (talkDeleteMatch && req.method === 'DELETE') {
          const talkId = parseInt(talkDeleteMatch[1], 10);
          db.deleteTalkMessage(talkId, currentUser.username);
          return sendJson(res, 200, { deleted: true });
        }

        // PUT /api/admin/settings
        if (pathname === '/api/admin/settings' && req.method === 'PUT') {
          const { site_name, site_tagline, announcement_banner, allow_anonymous_edits } = body;
          const normalizedAnon = allow_anonymous_edits !== undefined
            ? ((allow_anonymous_edits === true || allow_anonymous_edits === 1 || allow_anonymous_edits === '1' || allow_anonymous_edits === 'true') ? '1' : '0')
            : undefined;
          try {
            const updatedSettings = db.updateSettings({
              site_name,
              site_tagline,
              announcement_banner,
              allow_anonymous_edits: normalizedAnon
            }, currentUser.username);
            return sendJson(res, 200, { settings: updatedSettings });
          } catch (err) {
            return sendError(res, 400, err.message || 'Błąd podczas zapisu ustawień.');
          }
        }
      }

      return sendError(res, 404, 'Endpoint nie istnieje.');

    } catch (err) {
      console.error('Unhandled server error:', err);
      return sendError(res, 500, 'Wewnętrzny błąd serwera.');
    }
  });

  return { app: server, db, sessions };
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  const { app } = createWikiServer();
  app.listen(port, () => {
    console.log(`WikiKurekk server running on http://localhost:${port}`);
  });
}

module.exports = {
  createWikiServer
};
