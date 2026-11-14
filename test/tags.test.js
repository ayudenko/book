import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTags, validTags, tagCounts, filterNotesByTag, createBook, toLibrary} from '../dist/model.js';
test('Tags normalize case, repeated whitespace and duplicates without losing Russian text', () => {
 assert.deepEqual(normalizeTags([' Диалог ', 'ДИАЛОГ', '', ' сюжет  книги ']), ['диалог','сюжет книги']);
});
test('Cloud counts notes once per tag and filters legacy and tagged notes', () => {
 const notes=[{id:'old'},{id:'one',tags:['Диалог','диалог','сюжет']},{id:'two',tags:['Сюжет']}];
 assert.deepEqual(tagCounts(notes),[['сюжет',2],['диалог',1]]);
 assert.deepEqual(filterNotesByTag(notes,'диалог').map(n=>n.id),['one']);
 assert.deepEqual(filterNotesByTag(notes,'сюжет').map(n=>n.id),['one','two']);
 assert.deepEqual(filterNotesByTag(notes,''),notes);
 assert.deepEqual(filterNotesByTag(notes,'нет'),[]);
});
test('Tag validation accepts old backups and rejects malformed or excessive tags', () => {
 for(const value of [undefined,[],['тег']]) assert.equal(validTags(value),true);
 for(const value of [null,'тег',[3],[' '],['a,b'],['x'.repeat(41)],Array(21).fill('тег')]) assert.equal(validTags(value),false);
 const book=createBook('Книга');
 book.notes.push({id:'note',kind:'note',title:'Заметка',body:'Текст',quote:'',chapterId:null,tags:['сюжет']});
 assert.deepEqual(toLibrary(JSON.parse(JSON.stringify(book))).books[0].notes[0].tags,['сюжет']);
});
