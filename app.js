// app.js — Controller. Wires UI to DB + markdown renderer.
import { DB } from './db.js';
import { renderMarkdown, escapeHTML } from './markdown.js';

// ---- element refs ----
const $ = (id) => document.getElementById(id);
const els = {
  app:        document.querySelector('.app'),
  list:       $('note-list'),
  search:     $('search'),
  tagFilter:  $('tag-filter'),
  title:      $('title-input'),
  tags:       $('tags-input'),
  editor:     $('editor'),
  preview:    $('preview'),
  split:      document.querySelector('.split'),
  emptyState: $('empty-state'),
  saveStatus: $('save-status'),
  metaInfo:   $('meta-info'),
  noteCount:  $('note-count'),
  tabs:       $('tabs'),
  backdrop:   $('backdrop'),
};

// ---- state ----
let notes = [];
let currentId = null;
let activeTag = null;
let searchTerm = '';
let saveTimer = null;

// ---- helpers ----
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function fmtDate(ts) {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60000) return 'agora';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' min';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' h';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function snippet(content) {
  return content.replace(/[#*`>\-\[\]!]/g, '').replace(/\s+/g, ' ').trim().slice(0, 70);
}

// Extract #tags from content, merge with the tags field.
function tagsFromContent(content) {
  const found = [...content.matchAll(/(?:^|\s)#([\w\u00C0-\u017F-]+)/g)].map((m) => m[1].toLowerCase());
  return [...new Set(found)];
}

function parseTagsField(value) {
  return [...new Set(
    value.split(',').map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean)
  )];
}

// ---- rendering ----
function renderList() {
  const term = searchTerm.toLowerCase();
  let filtered = notes.filter((n) => {
    const matchesTag = !activeTag || (n.tags || []).includes(activeTag);
    const matchesTerm =
      !term ||
      n.title.toLowerCase().includes(term) ||
      n.content.toLowerCase().includes(term) ||
      (n.tags || []).some((t) => t.includes(term));
    return matchesTag && matchesTerm;
  });

  els.list.innerHTML = '';
  if (filtered.length === 0) {
    const li = document.createElement('li');
    li.className = 'note-snippet';
    li.style.padding = '14px';
    li.textContent = notes.length ? 'Nenhuma nota corresponde.' : 'Crie sua primeira nota.';
    els.list.appendChild(li);
  }

  for (const n of filtered) {
    const li = document.createElement('li');
    li.className = 'note-item' + (n.id === currentId ? ' active' : '');
    li.dataset.id = n.id;

    const tagsHTML = (n.tags || [])
      .slice(0, 3)
      .map((t) => `<span class="t">#${escapeHTML(t)}</span>`)
      .join('');

    li.innerHTML = `
      <div class="note-title">${escapeHTML(n.title || 'Sem título')}</div>
      <div class="note-snippet">${escapeHTML(snippet(n.content) || 'Vazio')}</div>
      <div class="note-meta">${tagsHTML}<span class="note-date">${fmtDate(n.updatedAt)}</span></div>
    `;
    li.addEventListener('click', () => selectNote(n.id));
    els.list.appendChild(li);
  }

  els.noteCount.textContent = `${notes.length} nota${notes.length === 1 ? '' : 's'}`;
}

async function renderTagFilter() {
  const tags = await DB.allTags();
  els.tagFilter.innerHTML = '';
  for (const { tag, count } of tags) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip' + (tag === activeTag ? ' active' : '');
    chip.textContent = `#${tag} ${count}`;
    chip.addEventListener('click', () => {
      activeTag = activeTag === tag ? null : tag;
      renderTagFilter();
      renderList();
    });
    els.tagFilter.appendChild(chip);
  }
}

function renderPreview() {
  els.preview.innerHTML = renderMarkdown(els.editor.value);
}

function showEditor(show) {
  document.querySelector('.toolbar').style.display = show ? '' : 'none';
  document.querySelector('.tags-row').style.display = show ? '' : 'none';
  els.split.style.display = show ? '' : 'none';
  document.querySelector('.statusbar').style.display = show ? '' : 'none';
  els.emptyState.hidden = show;
}

// ---- note ops ----
async function loadAll() {
  notes = await DB.all();
  renderList();
  await renderTagFilter();
}

function selectNote(id) {
  const n = notes.find((x) => x.id === id);
  if (!n) return;
  currentId = id;
  els.title.value = n.title;
  els.editor.value = n.content;
  els.tags.value = (n.tags || []).map((t) => '#' + t).join(', ');
  renderPreview();
  updateMeta(n);
  showEditor(true);
  renderList();
  els.app.classList.remove('drawer-open');
}

function updateMeta(n) {
  const words = n.content.trim() ? n.content.trim().split(/\s+/).length : 0;
  els.metaInfo.textContent =
    `${words} palavra${words === 1 ? '' : 's'} · editado ${fmtDate(n.updatedAt)}`;
}

async function newNote() {
  const n = await DB.create({ title: 'Sem título', content: '' });
  notes.unshift(n);
  selectNote(n.id);
  await renderTagFilter();
  els.title.focus();
  els.title.select();
}

const persist = debounce(async () => {
  if (!currentId) return;
  const fieldTags = parseTagsField(els.tags.value);
  const contentTags = tagsFromContent(els.editor.value);
  const tags = [...new Set([...fieldTags, ...contentTags])];
  try {
    const updated = await DB.update(currentId, {
      title: els.title.value.trim() || 'Sem título',
      content: els.editor.value,
      tags,
    });
    const idx = notes.findIndex((x) => x.id === currentId);
    if (idx > -1) notes[idx] = updated;
    notes.sort((a, b) => b.updatedAt - a.updatedAt);
    els.saveStatus.textContent = 'Salvo';
    els.saveStatus.classList.remove('saving');
    updateMeta(updated);
    renderList();
    renderTagFilter();
  } catch (err) {
    console.error('Falha ao salvar a nota:', err);
    els.saveStatus.textContent = 'Erro ao salvar';
    els.saveStatus.classList.remove('saving');
  }
}, 500);

function onEdit() {
  els.saveStatus.textContent = 'Salvando…';
  els.saveStatus.classList.add('saving');
  renderPreview();
  persist();
}

async function deleteCurrent() {
  if (!currentId) return;
  const n = notes.find((x) => x.id === currentId);
  if (!confirm(`Excluir "${n?.title || 'esta nota'}"? Esta ação não pode ser desfeita.`)) return;
  await DB.remove(currentId);
  notes = notes.filter((x) => x.id !== currentId);
  currentId = null;
  await renderTagFilter();
  if (notes.length) {
    selectNote(notes[0].id);
  } else {
    showEditor(false);
    renderList();
  }
}

// ---- export ----
function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeName(s) {
  return (s || 'nota').replace(/[^\w\u00C0-\u017F -]/g, '').trim().replace(/\s+/g, '-') || 'nota';
}

function exportMD() {
  if (!currentId) return;
  download(safeName(els.title.value) + '.md', els.editor.value, 'text/markdown');
}

function exportHTML() {
  if (!currentId) return;
  const body = renderMarkdown(els.editor.value);
  const title = escapeHTML(els.title.value || 'Nota');
  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  body { max-width: 720px; margin: 40px auto; padding: 0 20px;
    font-family: Georgia, 'Times New Roman', serif; line-height: 1.7; color: #2b2620; }
  h1 { border-bottom: 2px solid #c2641a; padding-bottom: .2em; }
  a { color: #8f4711; } img { max-width: 100%; }
  code { font-family: ui-monospace, Consolas, monospace; background: #efe9dc;
    padding: .12em .4em; border-radius: 4px; }
  pre { background: #efe9dc; padding: 14px 16px; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #c2641a; margin: 1em 0; padding: .4em 1em;
    color: #6b6357; font-style: italic; }
  hr { border: none; border-top: 1px solid #e0d8c8; }
</style></head>
<body>${body}</body></html>`;
  download(safeName(els.title.value) + '.html', html, 'text/html');
}

// ---- theme ----
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('notepad-theme', theme);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

// ---- tabs (mobile) ----
function setPane(pane) {
  els.split.dataset.pane = pane;
  els.tabs.querySelectorAll('.tab').forEach((t) =>
    t.classList.toggle('active', t.dataset.pane === pane));
}

// ---- wire events ----
function bind() {
  $('btn-new').addEventListener('click', newNote);
  $('btn-new-empty').addEventListener('click', newNote);
  $('btn-delete').addEventListener('click', deleteCurrent);
  $('btn-export-md').addEventListener('click', exportMD);
  $('btn-export-html').addEventListener('click', exportHTML);
  $('btn-theme').addEventListener('click', toggleTheme);

  els.editor.addEventListener('input', onEdit);
  els.title.addEventListener('input', onEdit);
  els.tags.addEventListener('input', onEdit);

  els.search.addEventListener('input', (e) => {
    searchTerm = e.target.value;
    renderList();
  });

  els.tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) setPane(tab.dataset.pane);
  });

  $('drawer-toggle').addEventListener('click', () => els.app.classList.toggle('drawer-open'));
  els.backdrop.addEventListener('click', () => els.app.classList.remove('drawer-open'));

  // Tab key inserts two spaces in editor
  els.editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = els.editor.selectionStart, en = els.editor.selectionEnd;
      els.editor.value = els.editor.value.slice(0, s) + '  ' + els.editor.value.slice(en);
      els.editor.selectionStart = els.editor.selectionEnd = s + 2;
      onEdit();
    }
  });

  // Ctrl/Cmd+N new note
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      newNote();
    }
  });
}

// ---- init ----
async function init() {
  applyTheme(localStorage.getItem('notepad-theme') || 'light');
  setPane('editor');
  bind();
  await loadAll();
  if (notes.length) {
    selectNote(notes[0].id);
  } else {
    showEditor(false);
  }
}

init();
