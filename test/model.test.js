import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, words, snapshot, restore, validBackup } from '../dist/model.js';
test('Counts Russian, punctuation, whitespace and hyphenated words',()=>{assert.equal(words('  Дом у моря.\nКто-то ждал — 2026! '),6);assert.equal(words(' … — '),0);});
test('Initial manuscript can round-trip through a backup',()=>{assert.equal(validBackup(JSON.parse(JSON.stringify(initialState()))),true);});
test('Snapshots deduplicate and retain at most 60 versions',()=>{const c=initialState().chapters[0];assert.equal(snapshot(c),false);for(let i=0;i<70;i++){c.html=`<p>${i}</p>`;snapshot(c);}assert.equal(c.history.length,60);assert.equal(c.history.at(-1).html,'<p>69</p>');});
test('Restoring retains the unsnapshotted current draft',()=>{const c=initialState().chapters[0],old=c.history[0];c.html='<p>Новый текст</p>';restore(c,old);assert.equal(c.html,old.html);assert.ok(c.history.some(h=>h.html==='<p>Новый текст</p>'));assert.equal(c.history.at(-1).label,'Восстановленная версия');});
test('Rejects broken backups, duplicate chapter IDs and invalid goals',()=>{assert.equal(validBackup({version:1}),false);const s=initialState();s.chapters[1].id=s.chapters[0].id;assert.equal(validBackup(s),false);s.chapters[1].id='different';s.goal=-1;assert.equal(validBackup(s),false);});

import { createBook, toLibrary, validLibrary, archiveBook, deleteBook } from '../dist/model.js';
test('Migrates the existing manuscript without losing text, notes or versions', () => {
 const old = initialState(), original = structuredClone(old), library = toLibrary(old);
 assert.equal(validLibrary(library), true);
 assert.deepEqual(library.books[0].chapters, original.chapters);
 assert.deepEqual(library.books[0].notes, original.notes);
 assert.equal(library.activeBookId, library.books[0].id);
 assert.equal(library.books[0].archived, false);
 assert.equal(toLibrary(library), library);
});
test('New books start empty and do not share data', () => {
 const a = createBook('Первая'), b = createBook('Вторая');
 a.chapters[0].html = '<p>Черновик</p>'; a.notes.push({title:'Идея'});
 assert.equal(b.chapters[0].html, ''); assert.equal(b.notes.length,0);
 assert.notEqual(a.id,b.id); assert.notEqual(a.chapters[0].id,b.chapters[0].id);
 assert.equal(validBackup(b),true);
});
test('Archive and restore retain all content through a storage round-trip', () => {
 const library = toLibrary(initialState()), book = library.books[0], content = structuredClone(book);
 archiveBook(library, book.id, true);
 assert.equal(library.activeBookId,null);
 assert.equal(validLibrary(library),true);
 const reloaded = toLibrary(JSON.parse(JSON.stringify(library)));
 archiveBook(reloaded, book.id, false);
 assert.deepEqual(reloaded.books[0],content);
});
test('Deleting the last book leaves a valid empty library without recreating demo data', () => {
 const library = toLibrary(initialState());
 deleteBook(library,library.books[0].id);
 assert.equal(library.books.length,0); assert.equal(library.activeBookId,null);
 assert.deepEqual(toLibrary(JSON.parse(JSON.stringify(library))),library);
});
test('Deleting a book preserves other books and their current chapter', () => {
 const library = toLibrary(initialState()), second = createBook('Другая история');
 library.books.push(second); library.activeBookId = second.id;
 deleteBook(library, library.books[0].id);
 assert.deepEqual(library.books,[second]); assert.equal(library.activeBookId,second.id);
 assert.equal(validLibrary(library),true);
});
test('Rejects duplicate book IDs and corrupt libraries', () => {
 const library = toLibrary(initialState()); library.books.push(structuredClone(library.books[0]));
 assert.equal(validLibrary(library),false);
 assert.equal(validLibrary({version:2,books:[null],activeBookId:null}),false);
 assert.throws(()=>toLibrary({version:2,books:[],activeBookId:'missing'}));
});

test('Geography survives book backup, library reload and archiving', () => {
 const book = createBook('Мир истории');
 const location = {id:'location-1',kind:'location',title:'Северная гавань',body:'Город у холодного моря.',locationType:'Город',quote:'',chapterId:null};
 book.notes.push(location);
 const backup = JSON.parse(JSON.stringify(book));
 assert.equal(validBackup(backup),true);
 const library = toLibrary(backup);
 archiveBook(library,library.books[0].id,true);
 const reloaded = toLibrary(JSON.parse(JSON.stringify(library)));
 archiveBook(reloaded,reloaded.books[0].id,false);
 assert.deepEqual(reloaded.books[0].notes,[location]);
 assert.deepEqual(createBook('Другая книга').notes,[]);
});
test('Geography accepts custom object types and rejects missing or invalid types', () => {
 const book = createBook('Мир');
 const location = {id:'location-1',kind:'location',title:'Арка',body:'Переход между мирами.',locationType:'Межмировой портал',quote:'',chapterId:null};
 book.notes.push(location);
 assert.equal(validBackup(book),true);
 for (const value of [undefined,null,42,'  ','x'.repeat(81)]) {
  location.locationType = value;
  assert.equal(validBackup(book),false);
 }
});

import {emptyOutline, detachChapterOutline, moveOutlineItem} from '../dist/model.js';
test('Old backups without outline remain valid; new books have independent empty outlines',()=>{
 const old=initialState();assert.equal(validBackup(old),true);
 const a=createBook('A'),b=createBook('B');a.outline.summary='Замысел';
 assert.deepEqual(b.outline,emptyOutline());assert.equal(validBackup(a),true);
});
test('Switching outline modes and backup round-trip preserve both kinds of plans',()=>{
 const book=createBook('История');
 book.outline={mode:'free',summary:'Общий замысел',items:[{id:'free',title:'Встреча',body:'Начало истории',chapterId:null},{id:'linked',title:'Первая глава',body:'Герой прибывает',chapterId:book.activeId}]};
 for(const mode of ['chapters','free']){book.outline.mode=mode;assert.equal(validBackup(book),true);}
 assert.deepEqual(JSON.parse(JSON.stringify(book)).outline,book.outline);
});
test('Deleting a chapter preserves its outline as a free item with its current title',()=>{
 const book=initialState(),chapter=book.chapters[0];book.outline={mode:'chapters',summary:'',items:[{id:'plan',title:'Старое имя',body:'Важное событие',chapterId:chapter.id}]};
 chapter.title='Новое имя';detachChapterOutline(book,chapter.id);book.chapters.shift();book.activeId=book.chapters[0].id;
 assert.deepEqual(book.outline.items[0],{id:'plan',title:'Новое имя',body:'Важное событие',chapterId:null});assert.equal(validBackup(book),true);
});
test('Free outline reordering leaves chapter entries intact and respects boundaries',()=>{
 const outline={mode:'free',summary:'',items:[{id:'a',chapterId:null},{id:'chapter',chapterId:'c'},{id:'b',chapterId:null}]};
 moveOutlineItem(outline,'b',-1);assert.deepEqual(outline.items.map(i=>i.id),['b','chapter','a']);
 moveOutlineItem(outline,'b',-1);assert.deepEqual(outline.items.map(i=>i.id),['b','chapter','a']);
});
test('Outline validation rejects unknown chapters, duplicate links and invalid content',()=>{
 const book=createBook('История'),item={id:'a',title:'',body:'',chapterId:null};
 for(const outline of [null,{mode:'invalid',summary:'',items:[]},{mode:'free',summary:'',items:[{...item,chapterId:'missing'}]},{mode:'free',summary:'',items:[item,item]},{mode:'chapters',summary:'',items:[{...item,chapterId:book.activeId},{...item,id:'b',chapterId:book.activeId}]},{mode:'free',summary:'',items:[{...item,body:42}]}]){book.outline=outline;assert.equal(validBackup(book),false);}
});
