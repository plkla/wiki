/**
 * wiki-parser.js - Parser składni Wiki i Markdown dla WikiKurekk
 * CommonJS: module.exports = { slugify, renderWikiContent, computeLineDiff }
 */

'use strict';

/**
 * Zamienia polskie znaki diakrytyczne i normalizuje tekst na bezpieczny URL slug.
 * @param {string} text
 * @returns {string}
 */
function slugify(text) {
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
    'ż': 'z', 'Ż': 'z',
    'ß': 'ss',
    'ø': 'o', 'Ø': 'o',
    'đ': 'd', 'Đ': 'd'
  };

  const replaced = str.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻßøØđĐ]/g, char => polishMap[char] || char);

  return replaced
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Bezpieczne escapowanie encji HTML.
 * Nie zamienia pojedynczego apostrofu ('), aby umożliwić parsowanie znaczników wiki ''' i ''.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renderuje znaczniki obrazów [[Plik:...]] oraz [[File:...]] do semantycznego <figure>.
 * @param {string} rawInner
 * @returns {string}
 */
function renderFigure(rawInner) {
  const parts = String(rawInner || '').split('|').map(p => p.trim());
  const filename = parts[0] || '';
  if (!filename) return '';

  let isThumb = false;
  let align = '';
  let caption = '';

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const lower = part.toLowerCase();
    if (lower === 'miniaturka' || lower === 'thumb' || lower === 'thumbnail') {
      isThumb = true;
    } else if (lower === 'prawo' || lower === 'right') {
      align = 'right';
    } else if (lower === 'lewo' || lower === 'left') {
      align = 'left';
    } else if (lower === 'środek' || lower === 'srodek' || lower === 'center') {
      align = 'center';
    } else {
      caption = part;
    }
  }

  const classes = ['wiki-figure'];
  if (isThumb) classes.push('wiki-figure-thumb');
  if (align) {
    classes.push(`wiki-figure-${align}`);
  } else if (isThumb) {
    classes.push('wiki-figure-right');
  }

  const cleanFilename = filename.replace(/^(\.\.[\/\\])+/, '');
  const src = cleanFilename.startsWith('/') || cleanFilename.startsWith('http')
    ? cleanFilename
    : `/uploads/${cleanFilename}`;

  const escapedSrc = escapeHtml(src);
  const escapedCaption = escapeHtml(caption);
  const escapedAlt = escapedCaption || escapeHtml(cleanFilename);

  const captionHtml = caption
    ? `<figcaption class="wiki-figcaption">${escapedCaption}</figcaption>`
    : '';

  return `<figure class="${classes.join(' ')}"><a href="${escapedSrc}" target="_blank"><img src="${escapedSrc}" alt="${escapedAlt}" /></a>${captionHtml}</figure>`;
}

/**
 * Renderuje elementy inline (pogrubienie, kursywa, kod, linki wiki).
 * @param {string} text Escapowany tekst
 * @param {Set<string>} slugSet
 * @param {string[]} linksOut
 * @returns {string}
 */
function renderInline(text, slugSet, linksOut) {
  let res = text;

  // 1. Zabezpieczenie kodu inline: `kod` przed formatowaniem markdown/wikitekstu
  const inlineCodes = [];
  res = res.replace(/`([^`\n]+)`/g, (match, code) => {
    const token = `@@@INLINE_CODE_${inlineCodes.length}@@@`;
    inlineCodes.push(`<code>${code}</code>`);
    return token;
  });

  // 2. Grafiki wiki: [[Plik:...]] lub [[File:...]] (przetwarzane przed linkami wiki)
  res = res.replace(/\[\[(?:Plik|File):([^\]\n]+)\]\]/gi, (match, inner) => {
    return renderFigure(inner);
  });

  // 3. Linki wiki: [[Cel|Etykieta]] lub [[Cel]]
  res = res.replace(/\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (match, targetRaw, labelRaw) => {
    const target = targetRaw.trim();
    const label = (labelRaw !== undefined ? labelRaw : target).trim();
    const slug = slugify(target);

    if (slug && !linksOut.includes(slug)) {
      linksOut.push(slug);
    }

    if (slugSet.has(slug)) {
      return `<a href="#/wiki/${slug}" class="wiki-link" data-slug="${slug}">${label}</a>`;
    } else {
      const encoded = encodeURIComponent(target);
      return `<a href="#/new?title=${encoded}" class="wiki-link wiki-link-red" data-missing-title="${target}" title="Strona jeszcze nie istnieje – kliknij, aby utworzyć">${label}</a>`;
    }
  });

  // 3. Pogrubienie i kursywa (MediaWiki ''''' oraz markdown ***) - obsługa również encji apostrofów
  res = res.replace(/(?:'''''|&#39;&#39;&#39;&#39;&#39;|&#039;&#039;&#039;&#039;&#039;)(.+?)(?:'''''|&#39;&#39;&#39;&#39;&#39;|&#039;&#039;&#039;&#039;&#039;)/g, '<strong><em>$1</em></strong>');
  res = res.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');

  // 4. Pogrubienie: '''tekst''' oraz **tekst**
  res = res.replace(/(?:'''|&#39;&#39;&#39;|&#039;&#039;&#039;)(.+?)(?:'''|&#39;&#39;&#39;|&#039;&#039;&#039;)/g, '<strong>$1</strong>');
  res = res.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

  // 5. Kursywa: ''tekst'' oraz *tekst*
  res = res.replace(/(?:''|&#39;&#39;|&#039;&#039;)(.+?)(?:''|&#39;&#39;|&#039;&#039;)/g, '<em>$1</em>');
  res = res.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');

  // 6. Przywrócenie nienaruszonego kodu inline (funkcja zapobiega problemom z $ w tekście)
  for (let idx = 0; idx < inlineCodes.length; idx++) {
    res = res.replace(`@@@INLINE_CODE_${idx}@@@`, () => inlineCodes[idx]);
  }

  return res;
}

/**
 * Renderuje treść artykułu wiki z obsługą sekcji, spisu treści, linków i przypisów.
 * @param {string} rawText
 * @param {Set<string>|Array<string>} existingSlugsSet
 * @returns {{ html: string, toc: Array<{ id: string, text: string, level: number }>, references: string[], links: string[] }}
 */
function renderWikiContent(rawText, existingSlugsSet = new Set()) {
  if (rawText == null) rawText = '';
  const text = String(rawText);

  const slugSet = existingSlugsSet instanceof Set ? existingSlugsSet : new Set(existingSlugsSet || []);
  const toc = [];
  const references = [];
  const links = [];

  let sectionCounter = 1;

  // 1. Ekstrakcja przypisów <ref>...</ref> PRZED escapowaniem HTML (obsługa również atrybutów, np. <ref name="...">)
  const refTokens = [];
  const textWithoutRefs = text.replace(/<ref(?:\s+[^>]*)?>([\s\S]*?)<\/ref>/gi, (match, refContent) => {
    const cleanRef = refContent.trim();
    references.push(cleanRef);
    const refIndex = references.length;
    const token = `@@@REF_${refIndex}@@@`;
    refTokens.push({
      token,
      html: `<sup class="wiki-ref" id="ref-cite-${refIndex}"><a href="#ref-note-${refIndex}">[${refIndex}]</a></sup>`
    });
    return token;
  }).replace(/<references\s*\/?>/gi, '');

  // 2. Ekstrakcja bloków kodu ```...```
  const codeBlocks = [];
  let codeBlockCounter = 0;
  const textWithoutCode = textWithoutRefs.replace(/```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g, (match, lang, code) => {
    const token = `@@@CODEBLOCK_${++codeBlockCounter}@@@`;
    const escapedCode = escapeHtml(code.replace(/\r?\n$/, ''));
    const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : '';
    codeBlocks.push({
      token,
      html: `<pre><code${langAttr}>${escapedCode}</code></pre>`
    });
    return token;
  });

  // 3. Normalizacja linii
  const normalizedLines = textWithoutCode.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const renderedBlocks = [];
  let currentParagraph = [];
  let currentList = null; // { type: 'ul' | 'ol', items: [] }
  let currentQuote = [];

  function flushParagraph() {
    if (currentParagraph.length > 0) {
      const pText = currentParagraph.join(' ').trim();
      if (pText) {
        const escaped = escapeHtml(pText);
        const inline = renderInline(escaped, slugSet, links);
        renderedBlocks.push(`<p>${inline}</p>`);
      }
      currentParagraph = [];
    }
  }

  function flushList() {
    if (currentList) {
      const itemsHtml = currentList.items.map(item => {
        const escaped = escapeHtml(item);
        const inline = renderInline(escaped, slugSet, links);
        return `<li>${inline}</li>`;
      }).join('\n');
      renderedBlocks.push(`<${currentList.type}>\n${itemsHtml}\n</${currentList.type}>`);
      currentList = null;
    }
  }

  function flushQuote() {
    if (currentQuote.length > 0) {
      const qText = currentQuote.join(' ').trim();
      if (qText) {
        const escaped = escapeHtml(qText);
        const inline = renderInline(escaped, slugSet, links);
        renderedBlocks.push(`<blockquote><p>${inline}</p></blockquote>`);
      }
      currentQuote = [];
    }
  }

  function flushAll() {
    flushParagraph();
    flushList();
    flushQuote();
  }

  for (let i = 0; i < normalizedLines.length; i++) {
    const rawLine = normalizedLines[i];
    const line = rawLine.trim();

    // Pusta linia
    if (!line) {
      flushAll();
      continue;
    }

    // Token bloku kodu
    if (/^@@@CODEBLOCK_\d+@@@$/.test(line)) {
      flushAll();
      renderedBlocks.push(line);
      continue;
    }

    // Samodzielna grafika blokowa [[Plik:...]] lub [[File:...]]
    const imageBlockMatch = line.match(/^\[\[(?:Plik|File):([^\]]+)\]\]$/i);
    if (imageBlockMatch) {
      flushAll();
      renderedBlocks.push(renderFigure(imageBlockMatch[1]));
      continue;
    }

    // Linia pozioma (---- lub ---)
    if (/^----+$/.test(line) || /^---+$/.test(line)) {
      flushAll();
      renderedBlocks.push('<hr />');
      continue;
    }

    // Nagłówki wiki '== Tytuł ==' lub markdown '## Tytuł'
    // Obsługa poziomów 1 - 6
    const wikiHeaderMatch = line.match(/^(={1,6})\s*(.*?)\s*\1$/);
    const mdHeaderMatch = line.match(/^(#{1,6})\s+(.*?)(?:\s+#+)?$/);

    if (wikiHeaderMatch || mdHeaderMatch) {
      flushAll();
      const level = wikiHeaderMatch ? wikiHeaderMatch[1].length : mdHeaderMatch[1].length;
      const titleRaw = wikiHeaderMatch ? wikiHeaderMatch[2].trim() : mdHeaderMatch[2].trim();

      const sectionId = `sekcja-${sectionCounter++}`;
      toc.push({
        id: sectionId,
        text: titleRaw,
        level: level
      });

      const escapedTitle = escapeHtml(titleRaw);
      const inlineTitle = renderInline(escapedTitle, slugSet, links);
      renderedBlocks.push(`<h${level} id="${sectionId}">${inlineTitle}</h${level}>`);
      continue;
    }

    // Cytat '> tekst'
    if (line.startsWith('>')) {
      flushParagraph();
      flushList();
      const quoteText = line.replace(/^>\s?/, '').trim();
      currentQuote.push(quoteText);
      continue;
    }

    // Listy nieuporządkowane (* lub -)
    const ulMatch = line.match(/^[\*\-]\s+(.*)$/);
    if (ulMatch) {
      flushParagraph();
      flushQuote();
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(ulMatch[1].trim());
      continue;
    }

    // Listy uporządkowane (1. tekst)
    const olMatch = line.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      flushParagraph();
      flushQuote();
      if (!currentList || currentList.type !== 'ol') {
        flushList();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(olMatch[1].trim());
      continue;
    }

    // Zwykła linia tekstu
    flushQuote();
    flushList();
    currentParagraph.push(line);
  }

  flushAll();

  let finalHtml = renderedBlocks.join('\n\n');

  // Przywrócenie bloków kodu (użycie funkcji zapobiega interpretacji znaków $ w treści kodu)
  for (const cb of codeBlocks) {
    finalHtml = finalHtml.replace(cb.token, () => cb.html);
  }

  // Przywrócenie przypisów w tekście
  for (const rf of refTokens) {
    finalHtml = finalHtml.replaceAll(rf.token, () => rf.html);
  }

  // Sekcja przypisów na dole (jeśli występują przypisy)
  if (references.length > 0) {
    const listItems = references.map((refText, idx) => {
      const num = idx + 1;
      const escapedRef = escapeHtml(refText);
      const inlineRef = renderInline(escapedRef, slugSet, links);
      return `    <li id="ref-note-${num}"><a href="#ref-cite-${num}" class="wiki-ref-back" title="Wróć do tekstu">^</a> ${inlineRef}</li>`;
    }).join('\n');

    const referencesSection = [
      '<div class="wiki-references">',
      '  <h3 id="sekcja-przypisy">Przypisy</h3>',
      '  <ol class="references-list">',
      listItems,
      '  </ol>',
      '</div>'
    ].join('\n');

    finalHtml += '\n\n' + referencesSection;
  }

  return {
    html: finalHtml,
    toc,
    references,
    links
  };
}

/**
 * Oblicza różnice linia po linii (LCS diff) pomiędzy starym i nowym tekstem.
 * @param {string} oldText
 * @param {string} newText
 * @returns {Array<{ type: 'same'|'add'|'del', line: string, oldLineNum?: number, newLineNum?: number }>}
 */
function computeLineDiff(oldText, newText) {
  const splitLines = (str) => {
    if (str == null || str === '') return [];
    return String(str).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  };

  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const m = oldLines.length;
  const n = newLines.length;

  if (m === 0 && n === 0) {
    return [];
  }

  // Szybka ścieżka: teksty identyczne
  if (oldText === newText) {
    return oldLines.map((line, idx) => ({
      type: 'same',
      line,
      oldLineNum: idx + 1,
      newLineNum: idx + 1
    }));
  }

  // Szybka ścieżka: całkowicie nowy tekst
  if (m === 0) {
    return newLines.map((line, idx) => ({
      type: 'add',
      line,
      newLineNum: idx + 1
    }));
  }

  // Szybka ścieżka: całkowite usunięcie tekstu
  if (n === 0) {
    return oldLines.map((line, idx) => ({
      type: 'del',
      line,
      oldLineNum: idx + 1
    }));
  }

  // Macierz programowania dynamicznego (LCS)
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (oldLines[i] === newLines[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i][j + 1], dp[i + 1][j]);
      }
    }
  }

  // Rekonstrukcja ścieżki (backtracking)
  let i = m;
  let j = n;
  const diff = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diff.push({
        type: 'same',
        line: oldLines[i - 1],
        oldLineNum: i,
        newLineNum: j
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.push({
        type: 'add',
        line: newLines[j - 1],
        newLineNum: j
      });
      j--;
    } else if (i > 0 && (j === 0 || dp[i - 1][j] >= dp[i][j - 1])) {
      diff.push({
        type: 'del',
        line: oldLines[i - 1],
        oldLineNum: i
      });
      i--;
    }
  }

  diff.reverse();
  return diff;
}

module.exports = {
  slugify,
  renderWikiContent,
  computeLineDiff,
  renderFigure
};
