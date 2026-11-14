export const uid = () => globalThis.crypto.randomUUID();
export const words = text => (text.trim().match(/[\p{L}\p{N}]+(?:[’'\-][\p{L}\p{N}]+)*/gu) || []).length;
export function snapshot(chapter, label = 'Автоматическое сохранение') {
  const last = chapter.history.at(-1);
  if (last?.html === chapter.html && last?.title === chapter.title) return false;
  chapter.history.push({id: uid(), at: new Date().toISOString(), title: chapter.title, html: chapter.html, label});
  if (chapter.history.length > 60) chapter.history.splice(0, chapter.history.length - 60);
  return true;
}
export function restore(chapter, version) {
  snapshot(chapter, 'Перед восстановлением');
  chapter.html = version.html;
  chapter.title = version.title;
  snapshot(chapter, 'Восстановленная версия');
}
export function validBackup(data) {
  return data?.version === 1 && typeof data.title === 'string' && data.title.length <= 200 &&
    Number.isFinite(data.goal) && data.goal > 0 && data.goal <= 10000000 &&
    Array.isArray(data.chapters) && data.chapters.length > 0 && data.chapters.length <= 500 &&
    new Set(data.chapters.map(c => c.id)).size === data.chapters.length &&
    data.chapters.every(c => typeof c.id === 'string' && typeof c.title === 'string' && typeof c.html === 'string' && Array.isArray(c.history) && c.history.every(h => typeof h.id === 'string' && typeof h.title === 'string' && typeof h.html === 'string' && typeof h.label === 'string' && !Number.isNaN(Date.parse(h.at)))) &&
    validSections(data.sections, data.chapters) && validOutline(data.outline, data.chapters) && Array.isArray(data.notes) && data.notes.every(n => typeof n.id === 'string' && ['note','character','annotation','location'].includes(n.kind) && (n.kind !== 'location' || (typeof n.locationType === 'string' && n.locationType.trim().length > 0 && n.locationType.length <= 80)) && validTags(n.tags) && typeof n.title === 'string' && typeof n.body === 'string' && (n.html === undefined || (typeof n.html === 'string' && n.html.length <= 2_000_000)) && typeof n.quote === 'string' && (n.chapterId === null || typeof n.chapterId === 'string'));
}
export function initialState() {
  const chapters = [
    {id: uid(), title: 'Дом у моря', html: '<p>В то утро море было почти неподвижным. Оно лежало за окном, как большое письмо, которое никто ещё не решился прочитать.</p><p>Анна поставила чашку на подоконник и открыла тетрадь. На первой странице чужим, немного торопливым почерком было написано: «Некоторые дороги начинаются с возвращения».</p><p>Дом достался ей вместе с тетрадью, связкой ключей и привычкой просыпаться раньше солнца. Всё остальное предстояло узнать самой.</p><p>Она провела ладонью по деревянной раме. За столько лет краска выцвела, но в углу всё ещё виднелась синяя полоска — именно тот цвет, который она помнила с детства.</p><p>Где-то внизу хлопнула дверь.</p><p>— Ты всё-таки приехала, — сказал знакомый голос.</p><p>Анна не обернулась сразу. Иногда человеку нужно несколько лишних секунд, чтобы снова стать собой.</p>', history: []},
    {id: uid(), title: 'Письма без адреса', html: '', history: []},
    {id: uid(), title: 'То, что остаётся', html: '', history: []}
  ];
  chapters.forEach(c => snapshot(c, 'Начальная версия'));
  return {version: 1, title: 'Там, где начинается море', subtitle: 'Роман', goal: 50000, activeId: chapters[0].id, chapters,
    notes: [{id:uid(),kind:'note',title:'Атмосфера первой главы',body:'Тишина, запах соли, утренний свет. Дом должен ощущаться как ещё один персонаж.',quote:'',chapterId:null}, {id:uid(),kind:'character',title:'Анна',body:'32 года. Возвращается в дом детства. Боится обнаружить, что воспоминания были красивее реальности.',quote:'',chapterId:null}]};
}

export function createBook(title) {
  const chapter = {id: uid(), title: 'Первая глава', html: '', history: []};
  snapshot(chapter, 'Начальная версия');
  return {version: 1, id: uid(), archived: false, title: title.trim(), subtitle: 'Роман', goal: 50000, activeId: chapter.id, chapters: [chapter], notes: [], outline: emptyOutline()};
}
export function toLibrary(data) {
  if (data?.version === 1 && validBackup(data)) {
    const book = {...data, id: uid(), archived: false};
    return {version: 2, activeBookId: book.id, books: [book]};
  }
  if (!validLibrary(data)) throw new Error('Invalid library');
  return data;
}
export function validLibrary(data) {
  try {
    return data?.version === 2 && Array.isArray(data.books) &&
      new Set(data.books.map(b => b.id)).size === data.books.length &&
      data.books.every(b => typeof b.id === 'string' && b.id.length > 0 && typeof b.archived === 'boolean' && validBackup(b)) &&
      (data.activeBookId === null || data.books.some(b => b.id === data.activeBookId && !b.archived));
  } catch { return false; }
}
export function archiveBook(library, id, archived) {
  const book = library.books.find(b => b.id === id);
  if (!book) throw new Error('Book not found');
  book.archived = archived;
  if (archived && library.activeBookId === id) library.activeBookId = null;
}
export function deleteBook(library, id) {
  library.books = library.books.filter(b => b.id !== id);
  if (library.activeBookId === id) library.activeBookId = null;
}

export const emptyOutline = () => ({mode: 'free', summary: '', items: []});
export function validOutline(outline, chapters) {
  if (outline === undefined) return true;
  if (!outline || !['free','chapters'].includes(outline.mode) || typeof outline.summary !== 'string' || outline.summary.length > 100000 || !Array.isArray(outline.items) || outline.items.length > 1000) return false;
  const ids = new Set(), linked = new Set();
  return outline.items.every(item => {
    if (!item || typeof item.id !== 'string' || !item.id.length || item.id.length > 128 || ids.has(item.id) || typeof item.title !== 'string' || item.title.length > 200 || typeof item.body !== 'string' || item.body.length > 100000) return false;
    ids.add(item.id);
    if (item.chapterId === null) return true;
    if (!chapters.some(c => c.id === item.chapterId) || linked.has(item.chapterId)) return false;
    linked.add(item.chapterId); return true;
  });
}
export function detachChapterOutline(book, chapterId) {
  const chapter = book.chapters.find(c => c.id === chapterId);
  for (const item of book.outline?.items || []) if (item.chapterId === chapterId) {
    item.chapterId = null; item.title = chapter?.title || item.title;
  }
}
export function moveOutlineItem(outline, id, direction) {
  const free = outline.items.filter(item => item.chapterId === null);
  const index = free.findIndex(item => item.id === id), target = index + direction;
  if (index < 0 || target < 0 || target >= free.length) return;
  const a = outline.items.indexOf(free[index]), b = outline.items.indexOf(free[target]);
  [outline.items[a], outline.items[b]] = [outline.items[b], outline.items[a]];
}

export function normalizeTags(tags) {
  return [...new Set(tags.map(tag => tag.trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean))];
}
export function validTags(tags) {
  return tags === undefined || (Array.isArray(tags) && tags.length <= 20 && tags.every(tag => typeof tag === 'string' && tag.trim().length > 0 && tag.length <= 40 && !tag.includes(',')));
}
export function tagCounts(notes) {
  const counts = new Map();
  for (const note of notes) for (const tag of normalizeTags(note.tags || [])) counts.set(tag, (counts.get(tag) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
}
export function filterNotesByTag(notes, tag) {
  return tag ? notes.filter(note => normalizeTags(note.tags || []).includes(tag)) : notes;
}

export function validSections(sections, chapters) {
  if (sections !== undefined && (!Array.isArray(sections) || sections.length > 100)) return false;
  const ids = new Set();
  for (const section of sections || []) {
    if (!section || typeof section.id !== 'string' || !section.id || section.id.length > 128 || ids.has(section.id) || typeof section.title !== 'string' || !section.title.trim() || section.title.length > 200) return false;
    ids.add(section.id);
  }
  return chapters.every(chapter => chapter.sectionId == null || ids.has(chapter.sectionId));
}
export function chapterGroups(book) {
  return [{id:null,title:'Без части'}, ...(book.sections || [])].map(section => ({...section, chapters:book.chapters.filter(chapter => (chapter.sectionId ?? null) === section.id)}));
}
export function orderChapters(book) {
  book.chapters = chapterGroups(book).flatMap(group => group.chapters);
}
export function assignChapterSection(book, chapterId, sectionId) {
  if (sectionId !== null && !(book.sections || []).some(section => section.id === sectionId)) throw new Error('Section not found');
  const chapter = book.chapters.find(chapter => chapter.id === chapterId);
  if (!chapter) throw new Error('Chapter not found');
  chapter.sectionId = sectionId; orderChapters(book);
}
export function removeSection(book, sectionId) {
  book.sections = (book.sections || []).filter(section => section.id !== sectionId);
  for (const chapter of book.chapters) if (chapter.sectionId === sectionId) chapter.sectionId = null;
  orderChapters(book);
}
export function moveSection(book, sectionId, direction) {
  const sections = book.sections || [], index = sections.findIndex(section => section.id === sectionId), target = index + direction;
  if (index < 0 || target < 0 || target >= sections.length) return;
  [sections[index], sections[target]] = [sections[target], sections[index]];
  orderChapters(book);
}
