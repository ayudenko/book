import { LibrarySync, apiRequest } from './sync.js';
import { uid, words, snapshot, restore, createBook, toLibrary, archiveBook, deleteBook, emptyOutline, detachChapterOutline, moveOutlineItem } from './model.js';
const $ = s => document.querySelector(s);
const icons = {
 plus:'M12 5v14M5 12h14', chevron:'m9 5 7 7-7 7', download:'M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4', upload:'M12 16V4m-4 4 4-4 4 4M5 16v4h14v-4', check:'m5 12 4 4L19 6', focus:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5', menu:'M4 6h16M4 12h16M4 18h16', sun:'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0', highlight:'m5 14 9-10 6 6-9 9-6-5Zm0 0-2 7 8-2M14 4l6 6', undo:'M4 10h10a6 6 0 0 1 0 12M4 10l5-5m-5 5 5 5', history:'M3 11a9 9 0 1 1 3 8M3 4v7h7m2-4v6l4 2', leaf:'M19 3C7 3 2 8 6 15s16 2 13-12ZM5 20l10-11', settings:'M4 6h16M4 18h16M8 3v6m8 6v6', close:'m6 6 12 12M6 18 18 6', edit:'m4 16-1 5 5-1L20 7l-4-4L4 16Zm10-11 4 4', page:'M6 3h8l4 4v14H6V3Zm8 0v5h4M9 12h6m-6 4h6'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.page}"/></svg>`;
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function sanitize(html) {
 const source = new DOMParser().parseFromString(html, 'text/html');
 const allowed = new Set(['P','BR','DIV','B','STRONG','I','EM','U','H2','H3','BLOCKQUOTE','MARK']);
 const walk = node => {
  if (node.nodeType === 3) return document.createTextNode(node.textContent);
  const frag = document.createDocumentFragment();
  if (['SCRIPT','STYLE','IFRAME','OBJECT','SVG','MATH','IMG'].includes(node.nodeName)) return frag;
  const out = allowed.has(node.nodeName) ? document.createElement(node.nodeName.toLowerCase()) : frag;
  for (const child of node.childNodes) out.append(walk(child));
  return out;
 };
 const out = document.createElement('div');
 for (const child of source.body.childNodes) out.append(walk(child));
 return out.innerHTML;
}
function plain(html) {
 const el = document.createElement('div'); el.innerHTML = sanitize(html).replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(p|div|h2|h3|blockquote)>/gi, '\n');
 return el.textContent.trim();
}
const LEGACY_KEY = 'quiet-chapter:v1';
let KEY = '', account = null, sync = null, syncTimer, lastQueued = '', authMode = 'login', cacheUnavailable = false;
let library = {version: 2, activeBookId: null, books: []}, state = null;
let persistenceBlocked = false, libraryView = true, shelf = 'active', outlineView = false;
function cleanLibrary(value) {
 const result = toLibrary(value);
 for (const book of result.books) {
  for (const c of book.chapters) {c.html = sanitize(c.html);c.history.forEach(h => h.html = sanitize(h.html));}
  if (!book.chapters.some(c => c.id === book.activeId)) book.activeId = book.chapters[0].id;
 }
 return result;
}
let tab = 'notes', timer, toastTimer, dialogHandler, selectedRange = null;
const current = () => state?.chapters.find(c => c.id === state.activeId);
const fmt = n => new Intl.NumberFormat('ru-RU').format(n);
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 5000); }
function persist() {
 if (!account || !sync) return false;
 if (persistenceBlocked) {toast('Сохранение остановлено. Скачайте копию и загрузите данные с сервера.');return false;}
 const payload = JSON.stringify(library);
 if (payload !== lastQueued) {
  try {localStorage.setItem(KEY, JSON.stringify({revision:sync.revision, dirty:true, library}));cacheUnavailable=false;}
  catch {cacheUnavailable=true;}
  sync.enqueue(library); lastQueued = payload;
  clearTimeout(syncTimer); syncTimer = setTimeout(() => sync?.flush(), 700);
 }
 updateSyncUI(); return true;
}
function capture() { if (libraryView || outlineView || !current()) return; current().html = sanitize($('#editor').innerHTML); current().title = $('#chapter-title').value; }
function flush() { clearTimeout(timer); capture(); if (current() && !libraryView && !outlineView) snapshot(current()); return persist(); }
function onEdit() {
 capture(); persist(); updateCounts(); renderChapters();
 clearTimeout(timer); const id = state.activeId;
 timer = setTimeout(() => { const c = state.chapters.find(c => c.id === id); if (c && snapshot(c)) { persist(); if (tab === 'history') renderPanel(); } }, 12000);
}
function updateCounts() {
 const count = words(plain(current().html));
 const total = state.chapters.reduce((sum, c) => sum + words(plain(c.html)), 0);
 $('#word-count').textContent = `${fmt(count)} слов · ${fmt(plain(current().html).length)} знаков`;
 $('#reading-time').textContent = count ? `~ ${Math.ceil(count / 200)} мин чтения` : 'Чистый лист';
 $('#total-words').textContent = fmt(total); $('#goal-total').textContent = `/ ${fmt(state.goal)} слов`;
 const progress = Math.min(100, total / state.goal * 100);
 $('#progress').style.width = `${progress}%`;
 $('#goal-caption').textContent = progress >= 100 ? 'Цель достигнута. Ваша история стала книгой!' : `${Math.round(progress * 10) / 10}% пути пройдено. Каждое слово имеет значение.`;
 $('#breadcrumb-chapter').textContent = current().title || 'Без названия';
}
function renderChapters() {
 $('#chapters').innerHTML = state.chapters.map((c, i) => `<button class="chapter-item ${c.id === state.activeId ? 'active' : ''}" data-chapter="${esc(c.id)}" ${c.id === state.activeId ? 'aria-current="page"' : ''}><span class="chapter-number">${String(i+1).padStart(2,'0')}</span><span class="chapter-label">${esc(c.title || 'Без названия')}</span>${icon('page')}</button>`).join('');
}
function renderBook() { $('#book-name').textContent = state.title; $('#cover-title').textContent = state.title; document.title = `${state.title} — Тихая глава`; }
function renderEditor() {
 outlineView=false;$('#outline-panel').hidden=true;$('#manuscript-panel').hidden=false;
 $('#chapter-title').value = current().title; $('#editor').innerHTML = current().html;
 $('#chapter-kicker').textContent = `ГЛАВА ${String(state.chapters.indexOf(current()) + 1).padStart(2,'0')}`;
 selectedRange = null; renderChapters(); updateCounts(); renderPanel();
}
function renderPanel() {
 document.querySelectorAll('[data-tab]').forEach(b => {b.setAttribute('aria-selected', b.dataset.tab === tab); b.tabIndex = b.dataset.tab === tab ? 0 : -1;});
 const info = {notes:['Под рукой','Идеи, которые важно не потерять'],characters:['Знакомые лица','Характеры, мотивы и маленькие детали'],geography:['Места вашей истории','Города, страны и неизведанные земли'],history:['История главы','До 60 версий · после паузы в наборе']}[tab];
 $('#panel-title').textContent = info[0]; $('#panel-description').textContent = info[1];
 $('#add-note').hidden = tab === 'history'; $('#add-note').setAttribute('aria-label', tab === 'characters' ? 'Добавить персонажа' : tab === 'geography' ? 'Добавить место' : 'Добавить заметку');
 if (tab === 'history') {
  $('#panel-content').innerHTML = [...current().history].reverse().map(h => `<div class="history-item"><h3>${esc(h.label)}</h3><p>${new Date(h.at).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'})} · ${words(plain(h.html))} слов</p><button data-version="${esc(h.id)}">Просмотреть и восстановить</button></div>`).join(''); return;
 }
 const notes = state.notes.filter(n => tab === 'characters' ? n.kind === 'character' : tab === 'geography' ? n.kind === 'location' : ['note','annotation'].includes(n.kind) && (!n.chapterId || n.chapterId === state.activeId));
 $('#panel-content').innerHTML = notes.length ? notes.map(n => `<article class="note-card ${n.kind}"><button class="icon-button edit-note" data-note="${esc(n.id)}" aria-label="Редактировать ${esc(n.title)}">${icon('edit')}</button><h3>${esc(n.title)}</h3>${n.quote ? `<blockquote>${esc(n.quote)}</blockquote>` : ''}<p>${esc(n.body)}</p><span class="note-tag">${n.kind === 'location' ? esc(n.locationType) : n.kind === 'character' ? 'ПЕРСОНАЖ' : n.kind === 'annotation' ? 'ПОМЕТКА К ЭТОЙ ГЛАВЕ' : 'ЗАМЕТКА К КНИГЕ'}</span></article>`).join('') : `<div class="empty-state">${tab === 'geography' ? 'Где разворачивается ваша история?<br>Нажмите +, чтобы описать первое место.' : 'Здесь есть место для новой идеи.<br>Нажмите +, чтобы её сохранить.'}</div>`;
}
function dialog(title, body, handler, submit = 'Сохранить') {
 $('#dialog-title').textContent = title; $('#dialog-body').innerHTML = body; $('#dialog-submit').textContent = submit; dialogHandler = handler; $('#dialog').showModal();
}
$('#dialog-form').addEventListener('submit', e => {e.preventDefault(); if (dialogHandler() !== false) $('#dialog').close();});
$('#close-dialog').onclick = $('#cancel-dialog').onclick = () => $('#dialog').close();
function noteDialog(existing, quote = '') {
 const kind = existing?.kind || (quote ? 'annotation' : tab === 'characters' ? 'character' : tab === 'geography' ? 'location' : 'note');
 const labels = {annotation:'Пометка к тексту',character:'Персонаж',note:'Заметка к книге',location:'Географический объект'};
 const isLocation = kind === 'location';
 const deleteLabel = isLocation ? 'Удалить место' : kind === 'character' ? 'Удалить персонажа' : 'Удалить заметку';
 dialog(labels[kind], `${quote || existing?.quote ? `<div class="version-preview">${esc(quote || existing.quote)}</div>` : ''}
  <label for="note-title">${kind === 'character' ? 'Имя' : 'Название'}</label>
  <input id="note-title" required maxlength="160" value="${esc(existing?.title || '')}" placeholder="${isLocation ? 'Например, город у моря' : kind === 'character' ? 'Кто живёт в вашей истории?' : 'О чём эта мысль?'}">
  ${isLocation ? `<label for="location-type">Тип объекта</label><input id="location-type" required maxlength="80" list="location-types" value="${esc(existing?.locationType || 'Место')}" placeholder="Выберите или введите свой тип"><datalist id="location-types">${['Город','Деревня','Страна','Регион','Остров','Гора','Река','Озеро','Море','Лес','Здание','Место'].map(t => `<option value="${t}"></option>`).join('')}</datalist>` : ''}
  <label for="note-body">${isLocation ? 'Описание места' : kind === 'character' ? 'Характер, история, мотивация' : 'Ваша заметка'}</label>
  <textarea id="note-body" required ${isLocation ? 'placeholder="Расположение, природа, жители, история и роль в сюжете…"' : ''}>${esc(existing?.body || '')}</textarea>
  ${existing ? `<button type="button" class="danger" id="delete-note">${deleteLabel}</button>` : ''}`, () => {
  const title = $('#note-title').value.trim(), body = $('#note-body').value.trim();
  const locationType = isLocation ? $('#location-type').value.trim() : null;
  if (!title || !body || (isLocation && !locationType)) {toast('Заполните название, описание и тип объекта, если он указан');return false;}
  const fields = {title, body, ...(isLocation ? {locationType} : {})};
  if (existing) Object.assign(existing, fields);
  else state.notes.unshift({id:uid(),kind,...fields,quote,chapterId:kind === 'annotation' ? state.activeId : null});
  const saved = persist(); renderPanel(); if (saved) toast(isLocation ? 'Место сохранено в географии книги' : 'Сохранено в вашем блокноте');
 });
 if (existing) $('#delete-note').onclick = () => { dialog(`${deleteLabel}?`,`<p>«${esc(existing.title)}» будет удалено из материалов книги.</p>`,() => {state.notes = state.notes.filter(n => n.id !== existing.id); persist(); renderPanel();},'Удалить'); };
}
$('#add-note').onclick = () => noteDialog();
$('#panel-content').onclick = e => {
 const note = e.target.closest('[data-note]'); if (note) noteDialog(state.notes.find(n => n.id === note.dataset.note));
 const version = e.target.closest('[data-version]');
 if (version) {
  const c = current(), h = c.history.find(h => h.id === version.dataset.version);
  dialog('Версия главы', `<p>${esc(h.title)} · ${new Date(h.at).toLocaleString('ru-RU')}</p><div class="version-preview">${esc(plain(h.html) || 'Пустая глава')}</div><p>Текущий текст останется в истории перед восстановлением.</p>`, () => {clearTimeout(timer);capture();restore(c,h);persist();renderEditor();toast('Версия восстановлена');},'Восстановить');
 }
};
document.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => {if (b.dataset.tab === 'history') flush();tab = b.dataset.tab;renderPanel();}; b.onkeydown = e => {if (!['ArrowLeft','ArrowRight'].includes(e.key)) return; e.preventDefault(); const tabs = [...document.querySelectorAll('[data-tab]')]; const next = tabs[(tabs.indexOf(b)+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length]; next.click(); next.focus();}; });
$('#chapters').onclick = e => { const b = e.target.closest('[data-chapter]'); if (!b) return;flush();state.activeId = b.dataset.chapter;persist();renderEditor();$('#sidebar').classList.remove('open'); };
function addChapter() { dialog('Новая глава','<label for="new-title">Название</label><input id="new-title" required maxlength="200" placeholder="У каждой главы — своё начало">', () => {const title = $('#new-title').value.trim(); if (!title) return false;flush();const c = {id:uid(),title,html:'',history:[]};snapshot(c,'Начальная версия');state.chapters.push(c);state.activeId=c.id;persist();renderEditor();toast('Новая глава готова');}); }
$('#add-chapter').onclick = $('#add-chapter-bottom').onclick = addChapter;
$('#chapter-title').oninput = $('#editor').oninput = onEdit;
$('#editor').addEventListener('paste', e => {e.preventDefault();const text = e.clipboardData.getData('text/plain');document.execCommand('insertText',false,text);onEdit();});
$('#editor').addEventListener('drop', e => e.preventDefault());
document.addEventListener('selectionchange', () => {const selection = window.getSelection();if (selection.rangeCount && $('#editor').contains(selection.anchorNode) && $('#editor').contains(selection.focusNode)) selectedRange = selection.getRangeAt(0).cloneRange();});
function restoreSelection() {$('#editor').focus();if (selectedRange && $('#editor').contains(selectedRange.commonAncestorContainer)) { const s = window.getSelection();s.removeAllRanges();s.addRange(selectedRange); }}
document.querySelectorAll('[data-command]').forEach(b => {b.onmousedown=e=>e.preventDefault();b.onclick=()=>{restoreSelection();document.execCommand(b.dataset.command);onEdit();};});
$('#block-format').onchange = e => {restoreSelection();document.execCommand('formatBlock',false,e.target.value);onEdit();};
$('#undo').onmousedown = e => e.preventDefault();
$('#undo').onclick = () => {restoreSelection();document.execCommand('undo');onEdit();};
$('#annotate').onmousedown = e => e.preventDefault();
$('#annotate').onclick = () => {const quote = selectedRange?.toString().trim();if (!quote) {toast('Сначала выделите в тексте фрагмент для пометки');return;} tab='notes';renderPanel();noteDialog(null,quote);};
$('#save-version').onclick = () => {capture();const changed=snapshot(current(),'Сохранено автором');const saved=persist();if(tab==='history')renderPanel();if(saved)toast(changed?'Версия сохранена в истории':'Эта версия уже есть в истории');};
function toggleFocus() {if(outlineView)renderEditor();document.body.classList.toggle('focus');}
$('#focus').onclick = $('#exit-focus').onclick = toggleFocus;
document.addEventListener('keydown', e => {if(e.key==='Escape') {document.body.classList.remove('focus');$('#sidebar').classList.remove('open');}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(flush())toast('Изменения подготовлены к сохранению');}});
$('#menu').onclick = () => $('#sidebar').classList.toggle('open');
$('#edit-goal').onclick = () => dialog('Ваша цель по объёму',`<p>Цель относится ко всей книге. Меняйте её по мере развития истории.</p><label for="goal-input">Количество слов</label><input id="goal-input" type="number" min="1" max="10000000" step="1" required value="${state.goal}">`,()=>{state.goal=Number($('#goal-input').value);persist();updateCounts();});
$('#book-settings').onclick = () => dialog('Настройки рукописи',`<label for="book-title-input">Название книги</label><input id="book-title-input" required maxlength="200" value="${esc(state.title)}"><p>Глав: ${state.chapters.length}. Чтобы переименовать главу, нажмите на её заголовок в редакторе.</p><button type="button" id="delete-chapter" class="delete-chapter" ${state.chapters.length<2?'disabled':''}>Удалить текущую главу</button>`,()=>{const title=$('#book-title-input').value.trim();if(!title)return false;state.title=title;persist();renderBook();});
$('#dialog-body').addEventListener('click',e=>{if(e.target.id==='delete-chapter'){const c=current();dialog('Удалить главу?',`<p>Будут удалены глава «${esc(c.title)}», её история и пометки. План главы сохранится в разделе «Без глав». Перед удалением можно скачать резервную копию всей книги.</p>`,()=>{clearTimeout(timer);detachChapterOutline(state,c.id);state.chapters=state.chapters.filter(x=>x.id!==c.id);state.notes=state.notes.filter(n=>n.chapterId!==c.id);state.activeId=state.chapters[0].id;persist();renderEditor();},'Удалить главу');}});
function download(text,filename,type) {const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const filename = () => state.title.replace(/[\\/:*?"<>|]/g,'_').slice(0,100) || 'Рукопись';
$('#export').onclick=()=>{flush();download(`${state.title}\n\n${state.chapters.map((c,i)=>`Глава ${i+1}. ${c.title}\n\n${plain(c.html)}`).join('\n\n————————————————\n\n')}`,`${filename()}.txt`,'text/plain;charset=utf-8');toast('Рукопись экспортирована в TXT');};
$('#backup').onclick=()=>{flush();download(JSON.stringify(state,null,2),`${filename()} — копия.json`,'application/json');toast('Копия содержит главы, заметки и историю');};
$('#import').onclick=$('#library-import').onclick=()=>$('#import-file').click();
$('#import-file').onchange=async e=>{
 const file=e.target.files[0];e.target.value='';if(!file)return;
 if(file.size>20*1024*1024){toast('Файл слишком большой. Максимум — 20 МБ.');return;}
 try {
  const data=JSON.parse(await file.text());
  const imported=cleanLibrary(data.version===2 ? data : toLibrary(data));
  dialog('Добавить книгу из копии?',`<p>Будут добавлены книги: ${imported.books.map(b=>esc(b.title)).join(', ')}. Существующие книги сохранятся.</p>`,()=>{
   if (!flush()) return false;
   const next = structuredClone(library);
   const books = imported.books.map(b=>({...b,id:uid()}));
   next.books.push(...books); const book=books.find(b=>!b.archived); if(book)next.activeBookId=book.id;
   if (!commitLibrary(next)) return false;
   if(book)openBook(book.id);else renderLibrary(); toast('Копия добавлена в библиотеку');
  },'Добавить книгу');
 }catch{toast('Это не резервная копия «Тихой главы» или файл повреждён.');}
};
window.addEventListener('pagehide', () => {flush();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){flush();sync?.flush();}});
window.addEventListener('beforeunload', e => {if(sync?.pending || persistenceBlocked){e.preventDefault();e.returnValue='';}});
window.addEventListener('online',()=>sync?.flush());
window.addEventListener('storage',e=>{
 if(account && (e.key===KEY || e.key===null || e.key==='quiet-chapter:account-event')) {
  persistenceBlocked=true;
  const error=new Error('Данные или аккаунт изменены в другой вкладке. Скачайте свою копию и загрузите библиотеку с сервера.');error.status=409;
  sync.pause(error);
 }
});

function commitLibrary(next) {
 const previous = library;
 library = next;
 if (!persist()) { library = previous; return false; }
 state = library.books.find(b => b.id === library.activeBookId) || null;
 return true;
}
function renderLibrary() {
 libraryView = true;
 document.body.classList.remove('focus');
 $('#writing-app').hidden = true;
 $('#library').hidden = false;
 document.title = 'Ваши истории — Тихая глава';
 $('#active-books').textContent = `В работе · ${library.books.filter(b => !b.archived).length}`;
 $('#archived-books').textContent = `Архив · ${library.books.filter(b => b.archived).length}`;
 $('#active-books').setAttribute('aria-pressed', shelf === 'active');
 $('#archived-books').setAttribute('aria-pressed', shelf === 'archive');
 const books = library.books.filter(b => b.archived === (shelf === 'archive'));
 $('#library-books').innerHTML = books.length ? books.map((b, i) => {
  const count = b.chapters.reduce((sum, c) => sum + words(plain(c.html)), 0);
  return `<article class="library-card tone-${i % 3}"><div class="library-card-cover"><span class="eyebrow">${b.archived ? 'В АРХИВЕ' : 'РУКОПИСЬ'}</span><h2>${esc(b.title)}</h2><span class="cover-flourish" aria-hidden="true">∿</span></div><div class="library-card-body"><p>${b.chapters.length} гл. · ${fmt(count)} слов</p><div class="library-card-actions">${b.archived ? `<button class="button primary" data-book-action="restore" data-book="${esc(b.id)}">Вернуть в работу</button>` : `<button class="button primary" data-book-action="open" data-book="${esc(b.id)}">Продолжить писать ${icon('chevron')}</button>`}<button class="button quiet" data-book-action="backup" data-book="${esc(b.id)}" aria-label="Скачать копию книги ${esc(b.title)}" title="Скачать копию">${icon('download')}</button></div><div class="library-card-secondary">${!b.archived ? `<button data-book-action="archive" data-book="${esc(b.id)}">В архив</button>` : '<span>Текст, заметки и история сохранены</span>'}<button class="delete-book" data-book-action="delete" data-book="${esc(b.id)}">Удалить</button></div></div></article>`;
 }).join('') : `<div class="library-empty"><span aria-hidden="true">✧</span><h2>${shelf === 'archive' ? 'В архиве пока тихо' : 'Место для вашей первой истории'}</h2><p>${shelf === 'archive' ? 'Здесь будут книги, которые вы отложили. Их всегда можно вернуть в работу.' : 'Создайте книгу — мы приготовим чистую страницу для первой главы.'}</p>${shelf === 'active' ? '<button class="button primary" data-book-action="create">Создать книгу</button>' : ''}</div>`;
}
function openBook(id) {
 const book = library.books.find(b => b.id === id && !b.archived);
 if (!book) return;
 clearTimeout(timer);
 library.activeBookId = id;
 state = book;
 libraryView = false;
 tab = 'notes';
 $('#library').hidden = true;
 $('#writing-app').hidden = false;
 $('#sidebar').classList.remove('open');
 renderBook(); renderEditor(); persist();
 $('#chapter-title').focus();
}
function newBookDialog() {
 dialog('Новая книга', '<label for="new-book-title">Название книги</label><input id="new-book-title" required maxlength="200" placeholder="Как будет называться ваша история?"><p>Начните с рабочего названия. Его можно изменить в любой момент.</p>', () => {
  const title = $('#new-book-title').value.trim();
  if (!title) { $('#new-book-title').setCustomValidity('Введите название книги'); $('#new-book-title').reportValidity(); return false; }
  const next = structuredClone(library), book = createBook(title);
  next.books.push(book); next.activeBookId = book.id;
  if (!commitLibrary(next)) return false;
  openBook(book.id); toast('Новая книга готова к первой строке');
 }, 'Создать книгу');
 $('#new-book-title').oninput = e => e.target.setCustomValidity('');
}
$('#create-book').onclick = newBookDialog;
$('#active-books').onclick = () => {shelf = 'active'; renderLibrary();};
$('#archived-books').onclick = () => {shelf = 'archive'; renderLibrary();};
function backToLibrary() {flush(); renderLibrary(); $('#create-book').focus();}
$('#back-library').onclick = $('#top-library').onclick = backToLibrary;
$('#library-books').onclick = e => {
 const button = e.target.closest('[data-book-action]');
 if (!button) return;
 const action = button.dataset.bookAction;
 if (action === 'create') {newBookDialog(); return;}
 const book = library.books.find(b => b.id === button.dataset.book);
 if (!book) return;
 if (action === 'open') {openBook(book.id); return;}
 if (action === 'backup') {
  download(JSON.stringify(book,null,2),`${book.title.replace(/[\\/:*?"<>|]/g,'_').slice(0,100) || 'Рукопись'} — копия.json`,'application/json');
  toast('Копия содержит текст, заметки и историю книги'); return;
 }
 if (action === 'archive' || action === 'restore') {
  const next = structuredClone(library);
  archiveBook(next, book.id, action === 'archive');
  if (!commitLibrary(next)) return;
  renderLibrary(); toast(action === 'archive' ? 'Книга перенесена в архив. Её можно вернуть в работу.' : 'Книга возвращена в раздел «В работе»');
 }
 if (action === 'delete') {
  dialog('Удалить книгу?', `<p>Книга «${esc(book.title)}», все её главы, заметки и история будут удалены без возможности восстановления. При необходимости сначала скачайте копию из библиотеки.</p><label for="delete-book-confirm">Введите название книги для подтверждения</label><input id="delete-book-confirm" required autocomplete="off">`, () => {
   const input = $('#delete-book-confirm');
   if (input.value !== book.title) {input.setCustomValidity('Название не совпадает');input.reportValidity();return false;}
   const next = structuredClone(library); deleteBook(next, book.id);
   if (!commitLibrary(next)) return false;
   renderLibrary(); toast('Книга удалена');
  }, 'Удалить навсегда');
  $('#delete-book-confirm').oninput = e => e.target.setCustomValidity('');
 }
};

function updateSyncUI() {
 if (!sync) return;
 const failed = sync.error || persistenceBlocked;
 const text = failed ? 'Не сохранено на сервере' : sync.pending ? 'Сохранение…' : 'Сохранено на сервере';
 $('#cloud-status').textContent = text;
 $('#save-status').textContent = text;
 $('#sync-banner').hidden = !failed && !cacheUnavailable;
 $('#sync-message').textContent = failed ? (sync.error?.message || 'Сохранение остановлено.') : cacheUnavailable ? 'Локальная копия недоступна. Дождитесь сохранения на сервере перед закрытием страницы; при потере сети скачайте библиотеку.' : '';
 $('#sync-retry').hidden = sync.paused;
 $('#sync-login').hidden = sync.error?.status !== 401 && sync.error?.code !== 'account_changed';
}
function cacheSync() {
 if (!sync) return;
 if (!persistenceBlocked) {
  try {localStorage.setItem(KEY,JSON.stringify({revision:sync.revision,dirty:!!sync.pending,library}));cacheUnavailable=false;}
  catch {cacheUnavailable=true;}
 }
 updateSyncUI();
}
function showAuth(message = '') {
 $('#auth-screen').hidden=false;$('#library').hidden=true;$('#writing-app').hidden=true;$('#account-bar').hidden=true;
 document.body.classList.remove('focus');$('#auth-error').textContent=message;
 $('#auth-password').value='';
}
async function loadAccount(user) {
 clearTimeout(timer); clearTimeout(syncTimer);
 if(sync){sync.pause(new Error('Аккаунт переключается'));sync.onChange=()=>{};}
 const remote = await apiRequest('/api/library',{accountId:user.id});
 const key = `quiet-chapter:account:${user.id}`;
 let cached = null, cacheError = false;
 try {const raw=localStorage.getItem(key);if(raw){cached=JSON.parse(raw);cleanLibrary(cached.library);if(!Number.isSafeInteger(cached.revision)||typeof cached.dirty!=='boolean')throw new Error();}}
 catch {cached=null;cacheError=true;}
 account=user;KEY=key;persistenceBlocked=false;cacheUnavailable=false;
 library=cleanLibrary(cached?.dirty ? cached.library : remote.library);
 state=library.books.find(b=>b.id===library.activeBookId)||null;
 lastQueued=JSON.stringify(library);
 sync=new LibrarySync({revision:cached?.dirty?cached.revision:remote.revision,
  save:payload=>apiRequest('/api/library',{method:'PUT',body:payload,accountId:user.id}),onChange:cacheSync});
 if(cached?.dirty)sync.enqueue(library);
 if(cacheError || (cached?.dirty && cached.revision!==remote.revision)) {
  persistenceBlocked=true;
  const error=new Error(cacheError?'Локальная копия повреждена. Серверные книги загружены; перед продолжением загрузите их кнопкой ниже.':'Есть несохранённая локальная копия и более новая версия на сервере. Скачайте локальную библиотеку, затем загрузите серверную версию.');error.status=409;
  sync.pause(error);
 }
 $('#auth-screen').hidden=true;$('#account-bar').hidden=false;$('#account-email').textContent=user.email;
 $('#auth-password').value='';
 try {$('#migrate-local').hidden=!localStorage.getItem(LEGACY_KEY)||localStorage.getItem(`quiet-chapter:migrated:${user.id}`)==='yes';}catch{$('#migrate-local').hidden=true;}
 renderLibrary();updateSyncUI();
 if(!persistenceBlocked) {cacheSync();if(sync.pending)sync.flush();}
}
async function bootstrap() {
 $('#auth-submit').disabled=true;
 try {const result=await apiRequest('/api/auth/me');await loadAccount(result.user);}
 catch(error){showAuth(error.status===401?'':`Сервер недоступен. ${error.message}`);}
 finally{$('#auth-submit').disabled=false;}
}
$('#auth-toggle').onclick=()=>{
 authMode=authMode==='login'?'register':'login';
 $('#auth-title').textContent=authMode==='login'?'Войдите, чтобы писать':'Начните свою историю';
 $('#auth-submit').textContent=authMode==='login'?'Войти':'Создать аккаунт';
 $('#auth-toggle').textContent=authMode==='login'?'Нет аккаунта? Зарегистрироваться':'Уже есть аккаунт? Войти';
 $('#auth-password').minLength=authMode==='register'?12:1;
 $('#auth-password').autocomplete=authMode==='register'?'new-password':'current-password';
 $('#auth-error').textContent='';
};
$('#auth-form').onsubmit=async e=>{
 e.preventDefault();$('#auth-submit').disabled=true;$('#auth-toggle').disabled=true;$('#auth-error').textContent='';
 try {
  const result=await apiRequest(`/api/auth/${authMode}`,{method:'POST',body:{email:$('#auth-email').value,password:$('#auth-password').value}});
  $('#auth-password').value='';
  try{localStorage.setItem('quiet-chapter:account-event',uid());}catch{}
  await loadAccount(result.user);
 }catch(error){$('#auth-error').textContent=error.message;}
 finally{$('#auth-submit').disabled=false;$('#auth-toggle').disabled=false;}
};
$('#logout').onclick=async()=>{
 $('#logout').disabled=true;$('#writing-app').inert=true;$('#library').inert=true;
 try {
  if(!flush() || !(await sync.flush())) {toast('Сначала сохраните изменения на сервере или скачайте копию и загрузите серверную версию.');return;}
  await apiRequest('/api/auth/logout',{method:'POST',body:{}});
  clearTimeout(timer);clearTimeout(syncTimer);
  try {localStorage.removeItem(KEY);localStorage.setItem('quiet-chapter:account-event',uid());} catch {}
  account=null;sync=null;state=null;library={version:2,activeBookId:null,books:[]};libraryView=true;
  $('#editor').innerHTML='';$('#panel-content').innerHTML='';$('#library-books').innerHTML='';$('#chapter-title').value='';
  $('#sync-banner').hidden=true;showAuth();
 }catch(error){toast(error.message);}finally{$('#logout').disabled=false;$('#writing-app').inert=false;$('#library').inert=false;}
};
$('#sync-retry').onclick=()=>sync?.flush();
$('#sync-backup').onclick=()=>{capture();download(JSON.stringify(library,null,2),'Тихая глава — вся библиотека.json','application/json');};
$('#sync-login').onclick=()=>{flush();showAuth('Войдите снова. Несохранённая копия останется в этом браузере.');};
$('#sync-reload').onclick=()=>{
 dialog('Загрузить серверную версию?','<p>Текущая библиотека будет скачана резервной копией. Затем загрузится версия из вашего аккаунта. Нужные книги из копии можно добавить через «Открыть копию».</p>',()=>{
  capture();download(JSON.stringify(library,null,2),'Тихая глава — перед загрузкой.json','application/json');
  clearTimeout(syncTimer);clearTimeout(timer);
  if(sync){sync.onChange=()=>{};sync.pause(new Error('Перезагрузка'));sync=null;}
  try{localStorage.removeItem(KEY);}catch{toast('Не удалось очистить локальную копию');return false;}
  persistenceBlocked=false;account=null;state=null;libraryView=true;
  showAuth('Загружаем библиотеку с сервера…');bootstrap();
 },'Скачать копию и загрузить');
};
$('#migrate-local').onclick=()=>{
 try {
  const old=cleanLibrary(JSON.parse(localStorage.getItem(LEGACY_KEY)));
  dialog('Перенести локальные книги?',`<p>${old.books.length} книг будут добавлены в аккаунт ${esc(account.email)}. Исходная копия в браузере сохранится.</p>`,()=>{
   const next=structuredClone(library);next.books.push(...old.books.map(b=>({...b,id:uid()})));
   if(!commitLibrary(next))return false;
   renderLibrary();
   sync.flush().then(saved=>{if(saved){localStorage.setItem(`quiet-chapter:migrated:${account.id}`,'yes');$('#migrate-local').hidden=true;toast('Книги перенесены на сервер');}});
  },'Перенести книги');
 }catch{toast('Не удалось прочитать старую библиотеку. Исходные данные не изменены.');}
};
bootstrap();

function showOutline() {
 if (!state || libraryView) return;
 if (!outlineView) flush();
 state.outline ??= emptyOutline();
 outlineView=true;
 document.body.classList.remove('focus');
 $('#manuscript-panel').hidden=true;$('#outline-panel').hidden=false;
 $('#sidebar').classList.remove('open');
 $('#outline-summary').value=state.outline.summary;
 renderOutline();
}
function renderOutline() {
 const outline=state.outline, free=outline.mode==='free';
 $('#outline-free').setAttribute('aria-pressed',free);
 $('#outline-chapters').setAttribute('aria-pressed',!free);
 $('#outline-description').textContent=free?'Наметьте события или части истории в любом порядке. Главы для этого не нужны.':'Опишите, что должно произойти в каждой главе. Общий замысел и свободные пункты остаются сохранёнными.';
 $('#add-outline-item').textContent=free?'Добавить пункт плана':'Добавить главу';
 $('#add-outline-item').disabled=free && outline.items.length>=1000;
 if (free) {
  const items=outline.items.filter(i=>i.chapterId===null);
  $('#outline-items').innerHTML=items.length?items.map((item,index)=>`<article class="outline-item" data-outline-id="${esc(item.id)}"><div class="outline-item-heading"><span class="eyebrow">ПУНКТ ${index+1}</span><div><button class="icon-button" data-outline-action="up" ${index===0?'disabled':''} aria-label="Переместить пункт ${index+1} выше">↑</button><button class="icon-button" data-outline-action="down" ${index===items.length-1?'disabled':''} aria-label="Переместить пункт ${index+1} ниже">↓</button><button class="icon-button" data-outline-action="delete" aria-label="Удалить пункт ${index+1}">${icon('close')}</button></div></div><label for="outline-title-${index}">Название пункта</label><input id="outline-title-${index}" data-outline-field="title" maxlength="200" value="${esc(item.title)}" placeholder="Например, первая встреча"><label for="outline-body-${index}">Что произойдёт</label><textarea id="outline-body-${index}" data-outline-field="body" maxlength="100000" placeholder="События, конфликт, поворот сюжета…">${esc(item.body)}</textarea></article>`).join(''):'<div class="empty-state">Начните с первой идеи. Разбить историю на главы можно позже.</div>';
 } else {
  $('#outline-items').innerHTML=state.chapters.map((chapter,index)=>{
   const item=outline.items.find(i=>i.chapterId===chapter.id);
   return `<article class="outline-item" data-outline-chapter="${esc(chapter.id)}"><div class="outline-item-heading"><div><span class="eyebrow">ГЛАВА ${index+1}</span><h3>${esc(chapter.title||'Без названия')}</h3></div><button class="button quiet" data-outline-action="write">К тексту</button></div><label for="chapter-plan-${index}">План главы</label><textarea id="chapter-plan-${index}" ${!item && outline.items.length>=1000?'disabled title="Достигнут лимит 1000 пунктов плана"':''} data-outline-field="body" maxlength="100000" placeholder="Основные события, цель главы и чем она заканчивается…">${esc(item?.body||'')}</textarea></article>`;
  }).join('');
 }
}
$('#open-outline').onclick=$('#top-outline').onclick=showOutline;
$('#close-outline').onclick=()=>{persist();renderEditor();};
$('#outline-summary').oninput=e=>{state.outline.summary=e.target.value;persist();};
for (const mode of ['free','chapters']) $(`#outline-${mode}`).onclick=()=>{state.outline.mode=mode;persist();renderOutline();};
$('#add-outline-item').onclick=()=>{
 if(state.outline.mode==='chapters') {addChapter();return;}
 if(state.outline.items.length>=1000){toast('В плане может быть до 1000 пунктов');return;}
 state.outline.items.push({id:uid(),title:'',body:'',chapterId:null});persist();renderOutline();
 $('#outline-items').lastElementChild.querySelector('input').focus();
};
$('#outline-items').oninput=e=>{
 const field=e.target.dataset.outlineField;if(!field)return;
 const card=e.target.closest('.outline-item');
 let item;
 if(card.dataset.outlineChapter) {
  const chapterId=card.dataset.outlineChapter;
  item=state.outline.items.find(i=>i.chapterId===chapterId);
  if(!item) {
   if(state.outline.items.length>=1000){toast('Достигнут лимит 1000 пунктов. Скопируйте текст и освободите место в плане.');return;}
   item={id:uid(),title:state.chapters.find(c=>c.id===chapterId).title,body:'',chapterId};state.outline.items.push(item);
  }
 } else item=state.outline.items.find(i=>i.id===card.dataset.outlineId);
 item[field]=e.target.value;persist();
};
$('#outline-items').onclick=e=>{
 const button=e.target.closest('[data-outline-action]');if(!button)return;
 const card=button.closest('.outline-item'), action=button.dataset.outlineAction;
 if(action==='write'){state.activeId=card.dataset.outlineChapter;persist();renderEditor();return;}
 const id=card.dataset.outlineId;
 if(action==='delete'){
  const item=state.outline.items.find(i=>i.id===id);
  dialog('Удалить пункт плана?',`<p>Пункт «${esc(item.title||'Без названия')}» и его описание будут удалены. Текст рукописи останется без изменений.</p>`,()=>{state.outline.items=state.outline.items.filter(i=>i.id!==id);persist();renderOutline();},'Удалить пункт');return;
 }
 moveOutlineItem(state.outline,id,action==='up'?-1:1);persist();renderOutline();
 const moved=[...$('#outline-items').children].find(el=>el.dataset.outlineId===id);
 moved?.querySelector('input')?.focus();
};
