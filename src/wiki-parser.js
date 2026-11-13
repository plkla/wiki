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
    'ż': 'z', 'Ż': 'z'
  };

  const replaced = str.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, char => polishMap[char] || char);

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
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Waliduje adres URL dla obrazków / linków: dozwolone wyłącznie http://, https:// lub bezpieczna ścieżka względna /...
 * Odrzuca javascript:, data:, vbscript:, //evil.com oraz znaki kontrolne.
 * @param {string} url
 * @param {{ allowRelative?: boolean }} [options]
 * @returns {boolean}
 */
function isSafeUrl(url, { allowRelative = true } = {}) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || /[\x00-\x1f\x7f\s<>"']/.test(trimmed)) {
    return false;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }
  if (allowRelative && trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\')) {
    return true;
  }
  return false;
}

/**
 * Oddziela końcową interpunkcję od gołego adresu URL (zachowując zbalansowane nawiasy).
 * @param {string} rawUrl
 * @returns {{ clean: string, trailing: string }}
 */
function splitTrailingPunctuation(rawUrl) {
  let clean = rawUrl;
  let trailing = '';
  while (clean.length > 0) {
    const last = clean[clean.length - 1];
    if (/[.,;:!?]/.test(last)) {
      trailing = last + trailing;
      clean = clean.slice(0, -1);
    } else if (last === ')') {
      const opens = (clean.match(/\(/g) || []).length;
      const closes = (clean.match(/\)/g) || []).length;
      if (closes > opens) {
        trailing = last + trailing;
        clean = clean.slice(0, -1);
      } else {
        break;
      }
    } else {
      break;
    }
  }
  return { clean, trailing };
}

/**
 * Nakłada formatowanie inline (pogrubienie, kursywa, przekreślenie) na już escapowany tekst.
 * @param {string} escapedText
 * @returns {string}
 */
function applyInlineFormatting(escapedText) {
  let res = escapedText;

  // Pogrubienie + kursywa: '''''tekst''''' oraz ***tekst***
  res = res.replace(/'''''([^\n]+?)'''''/g, '<strong><em>$1</em></strong>');
  res = res.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');

  // Pogrubienie: '''tekst''' oraz **tekst**
  res = res.replace(/'''([^\n]+?)'''/g, '<strong>$1</strong>');
  res = res.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

  // Kursywa: ''tekst'' oraz *tekst*
  res = res.replace(/''([^\n]+?)''/g, '<em>$1</em>');
  res = res.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');

  // Przekreślenie: ~~tekst~~
  res = res.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');

  return res;
}

/**
 * Tworzy fabrykę unikalnych tokenów zastępczych odpornych na kolizje z tekstem wejściowym.
 * @param {string} sourceText
 */
function createTokenStore(sourceText) {
  let nonce = 'WKTK';
  while (sourceText.includes(nonce) || sourceText.includes('\u0002') && sourceText.includes('\u0002' + nonce)) {
    nonce += Math.random().toString(36).slice(2, 6).toUpperCase();
  }
  // Upewniamy się, że sam prefiks z sentinelem nigdzie nie występuje
  const sentinelPrefix = `\u0002${nonce}`;
  let counter = 0;
  const entries = new Map();

  function add(kind, html, rawText = '') {
    const token = `${sentinelPrefix}${kind}${++counter}\u0003`;
    entries.set(token, { html, rawText });
    return token;
  }

  function restoreHtml(str, kinds = null) {
    let out = str;
    for (const [token, entry] of entries.entries()) {
      if (kinds && !kinds.some(k => token.startsWith(`${sentinelPrefix}${k}`))) {
        continue;
      }
      if (out.includes(token)) {
        out = out.replaceAll(token, () => entry.html);
      }
    }
    return out;
  }

  function restoreRaw(str) {
    let out = str;
    for (const [token, entry] of entries.entries()) {
      if (out.includes(token)) {
        out = out.replaceAll(token, () => entry.rawText);
      }
    }
    return out;
  }

  return { add, restoreHtml, restoreRaw, sentinelPrefix };
}

/**
 * Renderuje elementy inline (linki wiki, linki zewnętrzne, formatowanie) z surowego tekstu
 * (z tokenami kodu inline i przypisów już wydzielonymi).
 * @param {string} rawText
 * @param {Set<string>} slugSet
 * @param {string[]} linksOut
 * @param {ReturnType<typeof createTokenStore>} [outerTokens]
 * @returns {string}
 */
function renderInline(rawText, slugSet, linksOut, outerTokens = null) {
  if (!rawText) return '';
  const localLinks = [];

  function saveLocalLink(html) {
    const id = localLinks.length;
    localLinks.push(html);
    if (outerTokens) {
      return outerTokens.add('IL', html, html);
    }
    return `\u0004IL${id}\u0005`;
  }

  let res = String(rawText);

  // 1. Linki wiki: [[Cel|Etykieta]] lub [[Cel]] na surowym (nieescapowanym) tekście,
  // aby uniknąć podwójnego kodowania '&' jako '&amp;' w slugify() oraz encodeURIComponent().
  res = res.replace(/\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (match, targetRaw, labelRaw) => {
    const target = targetRaw.trim();
    const label = (labelRaw !== undefined ? labelRaw : target).trim();
    const slug = slugify(target);

    if (slug && !linksOut.includes(slug)) {
      linksOut.push(slug);
    }

    const renderedLabel = applyInlineFormatting(escapeHtml(label));
    if (slugSet.has(slug)) {
      return saveLocalLink(`<a href="#/wiki/${slug}" class="wiki-link" data-slug="${slug}">${renderedLabel}</a>`);
    }
    const encoded = encodeURIComponent(target);
    return saveLocalLink(
      `<a href="#/new?title=${encoded}" class="wiki-link wiki-link-red" data-missing-title="${escapeHtml(target)}" title="Strona jeszcze nie istnieje – kliknij, aby utworzyć">${renderedLabel}</a>`
    );
  });

  // 2. Zabezpieczenie ewentualnych inline obrazków ![alt](url) przed zamianą URL na link zewnętrzny lub XSS
  res = res.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g, (match, altRaw, urlRaw) => {
    const alt = altRaw.trim();
    const url = urlRaw.trim();
    if (!isSafeUrl(url, { allowRelative: true })) {
      return saveLocalLink(`[Zablokowano obraz${alt ? ': ' + escapeHtml(alt) : ''}]`);
    }
    return saveLocalLink(`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" />`);
  });

  // 3. Jawne linki zewnętrzne: [https://url Etykieta] lub [https://url]
  res = res.replace(/\[(https?:\/\/[^\s\]<>"']+)(?:\s+([^\]]+))?\]/gi, (match, urlRaw, labelRaw) => {
    if (!isSafeUrl(urlRaw, { allowRelative: false })) {
      return match;
    }
    const label = (labelRaw !== undefined && labelRaw.trim()) ? labelRaw.trim() : urlRaw.trim();
    const renderedLabel = applyInlineFormatting(escapeHtml(label));
    return saveLocalLink(
      `<a href="${escapeHtml(urlRaw.trim())}" class="wiki-link-external" target="_blank" rel="noopener noreferrer">${renderedLabel}</a>`
    );
  });

  // 4. Gołe linki zewnętrzne: https://... lub http://...
  res = res.replace(/(https?:\/\/[^\s<>"'\]]+)/gi, (match) => {
    const { clean, trailing } = splitTrailingPunctuation(match);
    if (!isSafeUrl(clean, { allowRelative: false })) {
      return match;
    }
    const safeEscaped = escapeHtml(clean);
    const anchor = `<a href="${safeEscaped}" class="wiki-link-external" target="_blank" rel="noopener noreferrer">${safeEscaped}</a>`;
    return saveLocalLink(anchor) + trailing;
  });

  // 5. Escapowanie HTML pozostałego tekstu i aplikacja formatowania wiki/markdown
  res = applyInlineFormatting(escapeHtml(res));

  // 6. Przywrócenie lokalnych linków (jeśli nie użyto outerTokens)
  if (!outerTokens && localLinks.length > 0) {
    for (let i = 0; i < localLinks.length; i++) {
      res = res.replaceAll(`\u0004IL${i}\u0005`, () => localLinks[i]);
    }
  }

  return res;
}

/**
 * Dzieli wiersz tabeli Markdown po niezescapowanych znakach '|' poza linkami [[...|...]].
 * @param {string} line
 * @returns {string[]}
 */
function splitTableRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) trimmed = trimmed.slice(0, -1);

  const cells = [];
  let current = '';
  let wikiDepth = 0;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    const next = trimmed[i + 1];

    if (ch === '\\' && next === '|') {
      current += '|';
      i++;
      continue;
    }
    if (ch === '[' && next === '[') {
      wikiDepth++;
      current += '[[';
      i++;
      continue;
    }
    if (ch === ']' && next === ']' && wikiDepth > 0) {
      wikiDepth--;
      current += ']]';
      i++;
      continue;
    }
    if (ch === '|' && wikiDepth === 0) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Sprawdza, czy linia jest poprawnym separatorem nagłówka tabeli Markdown i zwraca wyrównania kolumn.
 * @param {string} line
 * @returns {Array<'left'|'center'|'right'|null>|null}
 */
function parseTableSeparator(line) {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;
  const cells = splitTableRow(trimmed);
  if (cells.length === 0) return null;

  const alignments = [];
  for (const cell of cells) {
    if (!/^:?-{2,}:?$/.test(cell)) {
      return null;
    }
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) alignments.push('center');
    else if (right) alignments.push('right');
    else if (left) alignments.push('left');
    else alignments.push(null);
  }
  return alignments;
}

const CALLOUT_TITLES = {
  note: 'Notatka',
  tip: 'Wskazówka',
  warning: 'Ostrzeżenie',
  important: 'Ważne'
};

/**
 * Renderuje tablicę znormalizowanych linii na blokowy kod HTML.
 * @param {string[]} lines
 * @param {object} ctx
 * @returns {string}
 */
function renderBlocks(lines, ctx) {
  const { slugSet, links, toc, tokens, nextSectionId } = ctx;
  const renderedBlocks = [];
  let currentParagraph = [];
  let currentList = null; // { type: 'ul' | 'ol', items: [] }
  let currentQuote = [];

  function flushParagraph() {
    if (currentParagraph.length > 0) {
      const pText = currentParagraph.join(' ').trim();
      if (pText) {
        const inline = renderInline(pText, slugSet, links, tokens);
        renderedBlocks.push(`<p>${inline}</p>`);
      }
      currentParagraph = [];
    }
  }

  function flushList() {
    if (currentList) {
      const itemsHtml = currentList.items
        .map(item => `<li>${renderInline(item, slugSet, links, tokens)}</li>`)
        .join('\n');
      renderedBlocks.push(`<${currentList.type}>\n${itemsHtml}\n</${currentList.type}>`);
      currentList = null;
    }
  }

  function flushQuote() {
    if (currentQuote.length > 0) {
      const qText = currentQuote.join(' ').trim();
      if (qText) {
        const inline = renderInline(qText, slugSet, links, tokens);
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

  const codeBlockTokenRe = new RegExp(`^${tokens.sentinelPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}CB\\d+\u0003$`);

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) {
      flushAll();
      continue;
    }

    // Token wydzielonego bloku kodu
    if (codeBlockTokenRe.test(line)) {
      flushAll();
      renderedBlocks.push(line);
      continue;
    }

    // Callout / ramka ostrzegawcza: :::note|tip|warning|important [Tytuł]
    const calloutOpen = line.match(/^:::\s*(note|tip|warning|important)(?:\s+(.*))?$/i);
    if (calloutOpen) {
      flushAll();
      const type = calloutOpen[1].toLowerCase();
      const customTitle = calloutOpen[2] ? calloutOpen[2].trim() : '';
      const titleText = customTitle || CALLOUT_TITLES[type] || 'Notatka';

      const innerLines = [];
      let j = i + 1;
      while (j < lines.length) {
        if (/^:::\s*$/.test(lines[j].trim())) {
          break;
        }
        innerLines.push(lines[j]);
        j++;
      }
      i = j < lines.length ? j : lines.length - 1;

      const titleHtml = renderInline(titleText, slugSet, links, tokens);
      const bodyHtml = renderBlocks(innerLines, ctx);
      renderedBlocks.push(
        `<div class="wiki-callout wiki-callout-${type}"><div class="wiki-callout-title">${titleHtml}</div><div class="wiki-callout-body">${bodyHtml}</div></div>`
      );
      continue;
    }

    // Obrazek / Rycina: ![Alt](url "Podpis") lub ![Alt](url)
    const figureMatch = line.match(/^!\[([^\]]*)\]\(([^\s)]+)(?:\s+(?:"([^"]*)"|'([^']*)'))?\)$/);
    if (figureMatch) {
      flushAll();
      const alt = figureMatch[1].trim();
      const url = figureMatch[2].trim();
      const caption = (figureMatch[3] || figureMatch[4] || '').trim();

      if (!isSafeUrl(url, { allowRelative: true })) {
        renderedBlocks.push(`<p>[Zablokowano obraz${alt ? ': ' + escapeHtml(alt) : ''}]</p>`);
      } else {
        const captionHtml = caption
          ? `<figcaption>${renderInline(caption, slugSet, links, tokens)}</figcaption>`
          : '';
        renderedBlocks.push(
          `<figure class="wiki-figure"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" />${captionHtml}</figure>`
        );
      }
      continue;
    }

    // Tabela Markdown: | H1 | H2 | + separator | --- | --- |
    if (line.includes('|') && i + 1 < lines.length) {
      const alignments = parseTableSeparator(lines[i + 1]);
      if (alignments) {
        flushAll();
        const headerCells = splitTableRow(line);
        const colCount = Math.max(headerCells.length, alignments.length);

        const formatCellAttr = (idx) => {
          const align = alignments[idx];
          return align ? ` style="text-align: ${align}"` : '';
        };

        let theadCells = '';
        for (let c = 0; c < colCount; c++) {
          const cellRaw = headerCells[c] || '';
          const cellHtml = renderInline(cellRaw, slugSet, links, tokens);
          theadCells += `<th${formatCellAttr(c)}>${cellHtml}</th>`;
        }

        const bodyRows = [];
        let j = i + 2;
        while (j < lines.length) {
          const rowLine = lines[j].trim();
          if (!rowLine || !rowLine.includes('|')) break;
          if (/^(={1,6}\s|#{1,6}\s|:::\s*|```|>|\*\s|\d+\.\s|-{3,}$)/.test(rowLine)) break;

          const rowCells = splitTableRow(rowLine);
          let rowHtml = '';
          for (let c = 0; c < colCount; c++) {
            const cellRaw = rowCells[c] || '';
            const cellHtml = renderInline(cellRaw, slugSet, links, tokens);
            rowHtml += `<td${formatCellAttr(c)}>${cellHtml}</td>`;
          }
          bodyRows.push(`<tr>${rowHtml}</tr>`);
          j++;
        }
        i = j - 1;

        const tbodyInner = bodyRows.length > 0 ? `\n${bodyRows.join('\n')}\n` : '';
        renderedBlocks.push(
          `<div class="wiki-table-wrap"><table class="wiki-article-table">\n<thead>\n<tr>${theadCells}</tr>\n</thead>\n<tbody>${tbodyInner}</tbody>\n</table></div>`
        );
        continue;
      }
    }

    // Linia pozioma (---- lub ---)
    if (/^----+$/.test(line) || /^---+$/.test(line)) {
      flushAll();
      renderedBlocks.push('<hr />');
      continue;
    }

    // Nagłówki wiki '== Tytuł ==' lub markdown '## Tytuł' (poziomy 1 - 6)
    const wikiHeaderMatch = line.match(/^(={1,6})\s*(.*?)\s*\1$/);
    const mdHeaderMatch = line.match(/^(#{1,6})\s+(.*?)(?:\s+#+)?$/);

    if (wikiHeaderMatch || mdHeaderMatch) {
      flushAll();
      const level = wikiHeaderMatch ? wikiHeaderMatch[1].length : mdHeaderMatch[1].length;
      const titleRaw = wikiHeaderMatch ? wikiHeaderMatch[2].trim() : mdHeaderMatch[2].trim();

      const sectionId = nextSectionId();
      toc.push({
        id: sectionId,
        text: tokens.restoreRaw(titleRaw).trim(),
        level
      });

      const inlineTitle = renderInline(titleRaw, slugSet, links, tokens);
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
  return renderedBlocks.join('\n\n');
}

/**
 * Renderuje treść artykułu wiki z obsługą sekcji, spisu treści, linków, przypisów, tabel, calloutów i obrazków.
 * @param {string} rawText
 * @param {Set<string>|Array<string>} existingSlugsSet
 * @returns {{ html: string, toc: Array<{ id: string, text: string, level: number }>, references: string[], links: string[] }}
 */
function renderWikiContent(rawText, existingSlugsSet = new Set()) {
  if (rawText == null) rawText = '';
  const text = String(rawText).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const slugSet = existingSlugsSet instanceof Set ? existingSlugsSet : new Set(existingSlugsSet || []);
  const toc = [];
  const references = [];
  const refRenderSources = [];
  const links = [];

  const tokens = createTokenStore(text);

  // 1. Ekstrakcja bloków kodu ```lang ... ``` PRZED przypisami i formatowaniem inline
  const textWithoutCodeBlocks = text.replace(
    /^[ \t]*```([a-zA-Z0-9_-]*)[ \t]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm,
    (match, lang, code) => {
      const escapedCode = escapeHtml(code.replace(/\n$/, ''));
      const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      return tokens.add('CB', `<pre><code${langAttr}>${escapedCode}</code></pre>`, match);
    }
  );

  // 2. Ekstrakcja kodu inline `...` oraz ``...`` PRZED <ref> i linkami/formatowaniem
  const textWithoutInlineCode = textWithoutCodeBlocks.replace(
    /``([^\n]+?)``|`([^`\n]+?)`/g,
    (match, dblCode, sglCode) => {
      const codeContent = dblCode !== undefined ? dblCode : sglCode;
      return tokens.add('IN', `<code>${escapeHtml(codeContent)}</code>`, match);
    }
  );

  // 3. Ekstrakcja przypisów <ref>...</ref>
  const textWithoutRefs = textWithoutInlineCode.replace(/<ref>([\s\S]*?)<\/ref>/gi, (match, refContent) => {
    const cleanRef = refContent.trim();
    refRenderSources.push(cleanRef);
    references.push(tokens.restoreRaw(cleanRef));
    const refIndex = references.length;
    return tokens.add(
      'RF',
      `<sup class="wiki-ref" id="ref-cite-${refIndex}"><a href="#ref-note-${refIndex}">[${refIndex}]</a></sup>`,
      ''
    );
  });

  // 4. Parsowanie blokowe
  let sectionCounter = 1;
  const ctx = {
    slugSet,
    links,
    toc,
    tokens,
    nextSectionId: () => `sekcja-${sectionCounter++}`
  };

  let finalHtml = renderBlocks(textWithoutRefs.split('\n'), ctx);

  // 5. Sekcja przypisów na dole (jeśli występują przypisy)
  if (refRenderSources.length > 0) {
    const listItems = refRenderSources.map((refSource, idx) => {
      const num = idx + 1;
      const inlineRef = renderInline(refSource, slugSet, links, tokens);
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

    finalHtml = finalHtml ? `${finalHtml}\n\n${referencesSection}` : referencesSection;
  }

  // 6. Przywrócenie wszystkich tokenów w kolejności: linki/przypisy -> kod inline -> bloki kodu
  // Użycie funkcji zwrotnej () => html w replaceAll() zabezpiecza przed wzorcami $&, $$, $'.
  finalHtml = tokens.restoreHtml(finalHtml, ['IL', 'RF']);
  finalHtml = tokens.restoreHtml(finalHtml, ['IN']);
  finalHtml = tokens.restoreHtml(finalHtml, ['CB']);

  return {
    html: finalHtml,
    toc,
    references,
    links
  };
}

/**
 * Oblicza liczbę słów i szacowany czas czytania na podstawie wyrenderowanego HTML.
 * @param {string} renderedHtml
 * @returns {{ wordCount: number, readingTimeMinutes: number }}
 */
function computeReadingStats(renderedHtml) {
  if (!renderedHtml) {
    return { wordCount: 0, readingTimeMinutes: 0 };
  }
  const plain = String(renderedHtml)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&\w+;|&#\d+;/g, ' ')
    .trim();
  if (!plain) {
    return { wordCount: 0, readingTimeMinutes: 0 };
  }
  const words = plain.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const readingTimeMinutes = wordCount > 0 ? Math.max(1, Math.ceil(wordCount / 200)) : 0;
  return { wordCount, readingTimeMinutes };
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
  isSafeUrl,
  computeReadingStats
};
