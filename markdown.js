// markdown.js — minimal markdown → HTML parser, no dependencies.
// XSS-safe: raw text is only ever emitted through escapeHTML (via parseInline
// or explicit escaping for code blocks). Block structure is detected on the
// RAW source, then text content is escaped on the way into HTML.

function escapeHTML(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only allow safe URL schemes for links/images.
function safeURL(url) {
  const u = (url || '').trim();
  if (/^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(u)) return escapeHTML(u);
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return '#'; // block javascript:, data:, etc.
  return escapeHTML(u);
}

// Inline parsing. Receives RAW text, escapes it, then injects safe markup.
function parseInline(text) {
  const codeSpans = [];
  // pull out inline code first (raw), escape its contents, store placeholder
  text = text.replace(/`([^`]+)`/g, (_, c) => {
    codeSpans.push(escapeHTML(c));
    return '\u0000' + (codeSpans.length - 1) + '\u0000';
  });

  // escape everything else now that code is parked
  text = escapeHTML(text);

  // images ![alt](url)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) =>
    `<img src="${safeURL(url)}" alt="${alt}">`);
  // links [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
    `<a href="${safeURL(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  // bold then italic
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // restore code spans
  text = text.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codeSpans[+i]}</code>`);
  return text;
}

// Split a table row into cells, honoring escaped pipes (\|) and trimming the
// optional leading/trailing pipes. Returns an array of raw cell strings.
function splitRow(line) {
  const cells = [];
  let cur = '';
  for (let k = 0; k < line.length; k++) {
    const ch = line[k];
    if (ch === '\\' && line[k + 1] === '|') { cur += '|'; k++; continue; }
    if (ch === '|') { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  // drop empty edges produced by the optional outer pipes
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

// A separator row: cells made only of dashes with optional :align: colons.
function isTableSeparator(line) {
  if (!/\|/.test(line) && !/^\s*:?-+:?\s*$/.test(line)) return false;
  const cells = splitRow(line);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-+:?$/.test(c));
}

function cellAlign(sep) {
  const left = sep.startsWith(':');
  const right = sep.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return '';
}

// A table needs a header row containing a pipe, a valid separator on the next
// line, and matching column counts — the column check keeps a plain `text ---`
// (setext-ish / horizontal rule) from being mistaken for a table.
function looksLikeTable(header, sep) {
  if (header == null || sep == null) return false;
  if (!/\|/.test(header)) return false;
  if (!isTableSeparator(sep)) return false;
  return splitRow(header).length === splitRow(sep).length;
}

export function renderMarkdown(src) {
  const lines = (src || '').split('\n');
  const out = [];
  let i = 0;

  const listStack = []; // each: { type:'ul'|'ol' }
  function closeLists(toDepth = 0) {
    while (listStack.length > toDepth) {
      out.push(`</li></${listStack.pop().type}>`);
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block ```
    if (/^```/.test(line.trim())) {
      closeLists();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
      i++; // closing fence
      out.push(`<pre><code>${escapeHTML(buf.join('\n'))}</code></pre>`);
      continue;
    }

    // horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeLists();
      out.push('<hr>');
      i++;
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeLists();
      out.push(`<h${h[1].length}>${parseInline(h[2].trim())}</h${h[1].length}>`);
      i++;
      continue;
    }

    // blockquote (collapse consecutive > lines)
    if (/^\s*>\s?/.test(line)) {
      closeLists();
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${parseInline(buf.join('\n')).replace(/\n/g, '<br>')}</blockquote>`);
      continue;
    }

    // table: a header row followed by a |---|---| separator row
    if (looksLikeTable(line, lines[i + 1])) {
      closeLists();
      const headers = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map(cellAlign);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() !== '' && /\|/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const alignAttr = (idx) => (aligns[idx] ? ` style="text-align:${aligns[idx]}"` : '');
      let html = '<table><thead><tr>';
      headers.forEach((h, idx) => { html += `<th${alignAttr(idx)}>${parseInline(h)}</th>`; });
      html += '</tr></thead><tbody>';
      for (const cells of rows) {
        html += '<tr>';
        for (let idx = 0; idx < headers.length; idx++) {
          html += `<td${alignAttr(idx)}>${parseInline(cells[idx] || '')}</td>`;
        }
        html += '</tr>';
      }
      html += '</tbody></table>';
      out.push(html);
      continue;
    }

    // lists
    const ul = line.match(/^(\s*)[-*]\s+(.*)$/);
    const ol = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (ul || ol) {
      const m = ul || ol;
      const type = ul ? 'ul' : 'ol';
      const depth = Math.floor(m[1].length / 2) + 1;

      // open deeper levels (nest inside the current <li>, which stays open)
      while (listStack.length < depth) {
        out.push(`<${type}>`);
        listStack.push({ type });
      }
      // close deeper levels back down to target depth
      while (listStack.length > depth) {
        out.push(`</li></${listStack.pop().type}>`);
      }
      // same depth, different marker type → swap list
      if (listStack[listStack.length - 1].type !== type) {
        out.push(`</li></${listStack.pop().type}>`);
        out.push(`<${type}>`);
        listStack.push({ type });
      } else if (out[out.length - 1] !== `<${type}>`) {
        // sibling item: close previous <li>
        out.push('</li>');
      }
      out.push(`<li>${parseInline(m[2])}`);
      i++;
      continue;
    } else {
      closeLists();
    }

    // blank line
    if (line.trim() === '') { i++; continue; }

    // paragraph
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6}\s|\s*>\s?|```|\s*(-{3,}|\*{3,}|_{3,})\s*$)/.test(lines[i]) &&
      !/^(\s*)[-*]\s+/.test(lines[i]) &&
      !/^(\s*)\d+\.\s+/.test(lines[i]) &&
      !looksLikeTable(lines[i], lines[i + 1])
    ) { buf.push(lines[i]); i++; }
    out.push(`<p>${parseInline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }

  closeLists();
  return out.join('\n');
}

export { escapeHTML };
