import { validLibrary } from '../dist/model.js';
const string = (value, max) => typeof value === 'string' && value.length <= max;
const id = value => string(value, 128) && value.length > 0;
export function validateLibrary(value) {
  if (!validLibrary(value) || value.books.length > 100) return false;
  return value.books.every(book => id(book.id) && book.title.trim().length > 0 &&
    Number.isSafeInteger(book.goal) && book.chapters.length <= 500 &&
    book.chapters.some(c => c.id === book.activeId) && book.notes.length <= 2000 &&
    new Set(book.notes.map(n => n.id)).size === book.notes.length &&
    book.chapters.every(c => id(c.id) && string(c.title, 200) && string(c.html, 2_000_000) &&
      c.history.length <= 60 && new Set(c.history.map(h => h.id)).size === c.history.length &&
      c.history.every(h => id(h.id) && string(h.title, 200) && string(h.html, 2_000_000) && string(h.label, 200))) &&
    book.notes.every(n => id(n.id) && string(n.title, 160) && string(n.body, 100_000) && string(n.quote, 100_000) &&
      (n.chapterId === null || book.chapters.some(c => c.id === n.chapterId))));
}
export function normalizeLibrary(value) {
  return {version: 2, activeBookId: value.activeBookId, books: value.books.map(b => ({
    version: 1, id: b.id, archived: b.archived, title: b.title, subtitle: 'Роман', goal: b.goal, activeId: b.activeId,
    ...(b.outline ? {outline: {mode: b.outline.mode, summary: b.outline.summary, items: b.outline.items.map(i => ({id:i.id,title:i.title,body:i.body,chapterId:i.chapterId}))}} : {}),
    chapters: b.chapters.map(c => ({id: c.id, title: c.title, html: c.html,
      history: c.history.map(h => ({id: h.id, at: h.at, title: h.title, html: h.html, label: h.label}))})),
    notes: b.notes.map(n => ({id: n.id, kind: n.kind, title: n.title, body: n.body, quote: n.quote,
      chapterId: n.chapterId, ...(n.kind === 'location' ? {locationType: n.locationType} : {})}))
  }))};
}
