'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createWikiDb } = require('./db.js');
const { renderWikiContent, computeLineDiff, slugify } = require('./wiki-parser.js');

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
  const { password_hash, salt, ...rest } = user;
  return rest;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) {
        req.destroy();
        const err = new Error('Payload too large');
        err.statusCode = 413;
        reject(err);
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

function serveStatic(req, res, pathname) {
  if (pathname.includes('..') || req.url.includes('..') || req.url.includes('%2e') || req.url.includes('%2E')) {
    return sendError(res, 403, 'Forbidden');
  }

  let relativePath = pathname;
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
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Access-Control-Allow-Origin': '*'
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        sendError(res, 500, 'Błąd odczytu pliku.');
      } else {
        res.end();
      }
    });
    stream.pipe(res);
    return;
  }

  if (pathname.startsWith('/api')) {
    return sendError(res, 404, 'Endpoint nie istnieje.');
  }

  // Jeśli zażądano pliku ze znanym rozszerzeniem zasobu (np. .js, .css, .json, .png), który nie istnieje na dysku
  const requestedExt = path.extname(pathname);
  if (requestedExt && requestedExt !== '.html') {
    return sendError(res, 404, 'Plik nie istnieje.');
  }

  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    const indexStat = fs.statSync(indexPath);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': indexStat.size,
      'Access-Control-Allow-Origin': '*'
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(indexPath);
    stream.on('error', () => {
      if (!res.headersSent) {
        sendError(res, 500, 'Błąd odczytu pliku.');
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } else {
    const fallbackHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>WikiKurekk</title></head><body><div id="view-root">WikiKurekk</div></body></html>';
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(fallbackHtml);
  }
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
        if (err.statusCode === 413 || err.message === 'Payload too large') {
          return sendError(res, 413, 'Żądanie przekracza dopuszczalny limit wielkości (5 MB).');
        }
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

        const recentArticles = db.listArticles ? db.listArticles({ limit: 10 }) : [];
        const recentChanges = db.getRecentChanges ? db.getRecentChanges(10) : [];
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
        if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
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
        if (username.trim().length > 50) {
          return sendError(res, 400, 'Nazwa użytkownika nie może przekraczać 50 znaków.');
        }
        if (typeof password !== 'string' || password.length < 3) {
          return sendError(res, 400, 'Hasło musi zawierać co najmniej 3 znaki.');
        }
        if (password.length > 256) {
          return sendError(res, 400, 'Hasło nie może przekraczać 256 znaków.');
        }
        if (bio !== undefined && bio !== null && (typeof bio !== 'string' || bio.length > 1000)) {
          return sendError(res, 400, 'Biogram nie może przekraczać 1000 znaków.');
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
        const limit = query.limit ? parseInt(query.limit, 10) : undefined;
        const articles = db.listArticles({
          q: query.q,
          category: query.category,
          includeUnpublished,
          limit
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
        if (!currentUser) {
          return sendError(res, 401, 'Wymagane logowanie do edycji encyklopedii.');
        }
        if (currentUser.role === 'blocked') {
          return sendError(res, 403, 'Konto zablokowane.');
        }
        if (!canUserEdit(currentUser)) {
          return sendError(res, 403, 'Edycja encyklopedii wymaga uprawnień redaktora lub administratora.');
        }

        const { title, slug: customSlug, summary, content, infobox, categories, edit_comment } = body;
        if (!title || typeof title !== 'string' || !title.trim()) {
          return sendError(res, 400, 'Tytuł jest wymagany.');
        }
        if (title.trim().length > 255) {
          return sendError(res, 400, 'Tytuł nie może przekraczać 255 znaków.');
        }
        if (content === undefined || content === null) {
          return sendError(res, 400, 'Treść artykułu jest wymagana.');
        }

        const editor = currentUser ? currentUser.username : 'Anonim';
        const finalSlug = (customSlug && customSlug.trim())
          ? slugify(customSlug.trim())
          : slugify(title.trim());

        try {
          const article = db.createArticle({
            title: title.trim(),
            slug: finalSlug,
            summary: summary || '',
            content,
            infobox: typeof infobox === 'object' ? infobox : (infobox || '{}'),
            categories: Array.isArray(categories) ? categories : (categories || []),
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
          const statusCode = (err.message && err.message.includes('już istnieje')) ? 409 : 400;
          return sendError(res, statusCode, err.message || 'Błąd podczas tworzenia artykułu.');
        }
      }

      // 5. POST /api/preview
      if (pathname === '/api/preview' && req.method === 'POST') {
        const { content } = body;
        const allSlugs = new Set(db.getAllSlugs ? db.getAllSlugs() : []);
        const { html, toc, references } = renderWikiContent(content || '', allSlugs);
        return sendJson(res, 200, {
          renderedHtml: html,
          toc,
          references
        });
      }

      // 6. GET /api/recent-changes
      if (pathname === '/api/recent-changes' && req.method === 'GET') {
        const isAdmin = currentUser && currentUser.role === 'admin';
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

        // GET /api/articles/:slug
        if (!subRoute && req.method === 'GET') {
          const isAdmin = currentUser && currentUser.role === 'admin';
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
          const { html, toc, references } = renderWikiContent(article.content || '', allSlugs);
          const revisions = db.getRevisions ? db.getRevisions(slug) : [];
          const talkMessages = db.getTalkMessages ? db.getTalkMessages(slug) : [];

          return sendJson(res, 200, {
            article,
            renderedHtml: html,
            toc,
            references,
            revisionsCount: revisions.length,
            talkCount: talkMessages.length
          });
        }

        // PUT /api/articles/:slug
        if (!subRoute && req.method === 'PUT') {
          if (!currentUser) {
            return sendError(res, 401, 'Wymagane logowanie do edycji encyklopedii.');
          }
          if (currentUser.role === 'blocked') {
            return sendError(res, 403, 'Konto zablokowane.');
          }
          if (!canUserEdit(currentUser)) {
            return sendError(res, 403, 'Edycja encyklopedii wymaga uprawnień redaktora lub administratora.');
          }

          const existing = db.getArticleBySlug(slug, { includeUnpublished: true });
          if (!existing) {
            return sendError(res, 404, 'Artykuł nie został odnaleziony.');
          }
          if (existing.is_published === 0 && (!currentUser || currentUser.role !== 'admin')) {
            return sendError(res, 404, 'Artykuł nie został odnaleziony.');
          }
          if (existing.is_locked && (!currentUser || currentUser.role !== 'admin')) {
            return sendError(res, 403, 'Artykuł jest zabezpieczony przed edycją.');
          }
          if (body.title !== undefined && (typeof body.title !== 'string' || !body.title.trim())) {
            return sendError(res, 400, 'Tytuł artykułu nie może być pusty.');
          }
          if (body.content !== undefined && (body.content === null || typeof body.content !== 'string' && typeof body.content !== 'number')) {
            return sendError(res, 400, 'Treść artykułu nie może być pusta.');
          }

          const editor = currentUser ? currentUser.username : 'Anonim';
          try {
            const updated = db.updateArticle(slug, {
              title: body.title !== undefined ? body.title : existing.title,
              summary: body.summary !== undefined ? body.summary : existing.summary,
              content: body.content !== undefined ? body.content : existing.content,
              infobox: typeof body.infobox === 'object' ? body.infobox : (body.infobox !== undefined ? body.infobox : existing.infobox),
              categories: Array.isArray(body.categories) ? body.categories : (body.categories !== undefined ? body.categories : existing.categories),
              editor,
              edit_comment: body.edit_comment || 'Edycja artykułu'
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
          const isAdmin = currentUser && currentUser.role === 'admin';
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
          const isAdmin = currentUser && currentUser.role === 'admin';
          const article = db.getArticleBySlug(slug, { includeUnpublished: isAdmin });
          if (!article) {
            return sendError(res, 404, 'Artykuł nie został odnaleziony.');
          }
          const fromId = parseInt(query.from, 10);
          const toId = parseInt(query.to, 10);
          if (isNaN(fromId) || isNaN(toId) || fromId <= 0 || toId <= 0) {
            return sendError(res, 400, 'Wymagane poprawne parametry from i to.');
          }
          const fromRev = db.getRevisionById(fromId);
          const toRev = db.getRevisionById(toId);
          if (!fromRev || !toRev) {
            return sendError(res, 404, 'Nie znaleziono wskazanych rewizji.');
          }
          if (fromRev.article_slug.toLowerCase() !== slug.toLowerCase() || toRev.article_slug.toLowerCase() !== slug.toLowerCase()) {
            return sendError(res, 400, 'Rewizje nie należą do wskazanego artykułu.');
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

          const existing = db.getArticleBySlug(slug, { includeUnpublished: true });
          if (!existing) {
            return sendError(res, 404, 'Artykuł nie został odnaleziony.');
          }
          if (existing.is_published === 0 && (!currentUser || currentUser.role !== 'admin')) {
            return sendError(res, 404, 'Artykuł nie został odnaleziony.');
          }
          if (existing.is_locked && (!currentUser || currentUser.role !== 'admin')) {
            return sendError(res, 403, 'Artykuł jest zabezpieczony przed edycją.');
          }

          const revisionId = parseInt(body.revisionId, 10);
          if (!revisionId || isNaN(revisionId) || revisionId <= 0) {
            return sendError(res, 400, 'Wymagany poprawny parametr revisionId.');
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
          const isAdmin = currentUser && currentUser.role === 'admin';
          const article = db.getArticleBySlug(slug, { includeUnpublished: isAdmin });
          if (!article) {
            return sendError(res, 404, 'Artykuł nie został odnaleziony.');
          }
          const messages = db.getTalkMessages(slug);
          return sendJson(res, 200, { messages });
        }

        // POST /api/articles/:slug/talk
        if (subRoute === 'talk' && req.method === 'POST') {
          const isAdmin = currentUser && currentUser.role === 'admin';
          const article = db.getArticleBySlug(slug, { includeUnpublished: isAdmin });
          if (!article) {
            return sendError(res, 404, 'Artykuł nie został odnaleziony.');
          }
          if (currentUser && currentUser.role === 'blocked') {
            return sendError(res, 403, 'Konto zablokowane.');
          }
          const { content, author: customAuthor } = body;
          if (!content || typeof content !== 'string' || !content.trim()) {
            return sendError(res, 400, 'Treść wiadomości nie może być pusta.');
          }
          if (content.trim().length > 5000) {
            return sendError(res, 400, 'Treść wiadomości nie może przekraczać 5000 znaków.');
          }

          const author = currentUser
            ? currentUser.username
            : (customAuthor && typeof customAuthor === 'string' && customAuthor.trim() ? customAuthor.trim() : 'Anonim');

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
          const deleted = db.deleteArticle(slug, currentUser.username);
          if (!deleted) {
            return sendError(res, 404, 'Artykuł nie został odnaleziony.');
          }
          return sendJson(res, 200, { deleted: true, slug });
        }

        // POST /api/admin/users
        if (pathname === '/api/admin/users' && req.method === 'POST') {
          const { username, password, role, bio } = body;
          if (!username || !password) {
            return sendError(res, 400, 'Nazwa użytkownika i hasło są wymagane.');
          }
          if (typeof username !== 'string' || username.trim().length < 2) {
            return sendError(res, 400, 'Nazwa użytkownika musi mieć co najmniej 2 znaki.');
          }
          if (username.trim().length > 50) {
            return sendError(res, 400, 'Nazwa użytkownika nie może przekraczać 50 znaków.');
          }
          if (typeof password !== 'string' || password.length < 3) {
            return sendError(res, 400, 'Hasło musi mieć co najmniej 3 znaki.');
          }
          if (password.length > 256) {
            return sendError(res, 400, 'Hasło nie może przekraczać 256 znaków.');
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
            const statusCode = (err.message && err.message.includes('już istnieje')) ? 409 : 400;
            return sendError(res, statusCode, err.message || 'Błąd podczas tworzenia użytkownika.');
          }
        }

        // PATCH /api/admin/users/:id
        const userPatchMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
        if (userPatchMatch && req.method === 'PATCH') {
          const targetId = parseInt(userPatchMatch[1], 10);
          if (isNaN(targetId) || targetId <= 0) {
            return sendError(res, 400, 'Nieprawidłowe ID użytkownika.');
          }
          const { role } = body;
          if (!role) {
            return sendError(res, 400, 'Brak nowej roli użytkownika.');
          }
          if (currentUser && currentUser.id === targetId && role !== 'admin') {
            return sendError(res, 400, 'Nie można odebrać sobie uprawnień administratora.');
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
          if (isNaN(talkId) || talkId <= 0) {
            return sendError(res, 400, 'Nieprawidłowe ID wiadomości.');
          }
          const deleted = db.deleteTalkMessage(talkId, currentUser.username);
          if (!deleted) {
            return sendError(res, 404, 'Wiadomość dyskusji nie została odnaleziona.');
          }
          return sendJson(res, 200, { deleted: true });
        }

        // PUT /api/admin/settings
        if (pathname === '/api/admin/settings' && req.method === 'PUT') {
          const { site_name, site_tagline, announcement_banner, allow_anonymous_edits } = body;
          if (site_name !== undefined && (typeof site_name !== 'string' || !site_name.trim())) {
            return sendError(res, 400, 'Nazwa witryny nie może być pusta.');
          }
          try {
            const updatedSettings = db.updateSettings({
              site_name: site_name !== undefined ? site_name.trim() : undefined,
              site_tagline,
              announcement_banner,
              allow_anonymous_edits: allow_anonymous_edits !== undefined ? String(allow_anonymous_edits) : undefined
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
