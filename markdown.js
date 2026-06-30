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
      !/^(\s*)\d+\.\s+/.test(lines[i])
    ) { buf.push(lines[i]); i++; }
    out.push(`<p>${parseInline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }

  closeLists();
  return out.join('\n');
}

export { escapeHTML };
