import test from 'node:test';
import assert from 'node:assert/strict';
import {createBook,validBackup,chapterGroups,assignChapterSection,removeSection,moveSection,toLibrary} from '../dist/model.js';
function bookWithParts() {
 const book=createBook('Роман');
 book.sections=[{id:'a',title:'Начало'},{id:'b',title:'Финал'}];
 book.chapters.push({...structuredClone(book.chapters[0]),id:'second',html:'<p>Вторая глава</p>'});
 book.outline.items.push({id:'plan',title:'План',body:'Развязка',chapterId:'second'});
 return book;
}
test('Legacy books without parts remain valid; empty parts are visible',()=>{
 const book=createBook('Книга');assert.equal(validBackup(book),true);
 book.sections=[{id:'part',title:'Часть I'}];
 assert.equal(chapterGroups(book)[1].chapters.length,0);
 assert.equal(validBackup(book),true);
});
test('Moving chapters and parts preserves manuscripts, history, active chapter and outline links',()=>{
 const book=bookWithParts(), original=structuredClone(book);
 assignChapterSection(book,book.chapters[0].id,'a');assignChapterSection(book,'second','b');
 moveSection(book,'b',-1);
 assert.equal(book.chapters[0].id,'second');assert.equal(book.activeId,original.activeId);
 for(const chapter of book.chapters) {const old=original.chapters.find(c=>c.id===chapter.id);assert.equal(chapter.html,old.html);assert.deepEqual(chapter.history,old.history);}
 assert.deepEqual(book.outline,original.outline);
 assert.deepEqual(toLibrary(JSON.parse(JSON.stringify(book))).books[0].sections,book.sections);
 removeSection(book,'b');assert.equal(book.chapters.find(c=>c.id==='second').sectionId,null);
 assert.equal(book.chapters.length,2);assert.equal(validBackup(book),true);
 assert.throws(()=>assignChapterSection(book,'second','missing'));
});
test('Rejects dangling chapter links, duplicate section IDs and invalid parts',()=>{
 const book=bookWithParts();book.chapters[0].sectionId='missing';assert.equal(validBackup(book),false);
 delete book.chapters[0].sectionId;
 for(const sections of [null,[{id:'a',title:''}],[{id:'a',title:'One'},{id:'a',title:'Two'}],Array(101).fill({id:'a',title:'A'})]) {
  assert.equal(validBackup({...book,sections}),false);
 }
});
