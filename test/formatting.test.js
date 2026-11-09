import test from 'node:test';
import assert from 'node:assert/strict';
import {safeHighlight, highlightColors, safeAlignment} from '../dist/formatting.js';
test('Accepts palette colors in CSS hex and browser RGB serialization',()=>{
 for(const color of Object.values(highlightColors)) {
  const rgb=color.slice(1).match(/../g).map(c=>parseInt(c,16)).join(', ');
  assert.equal(safeHighlight(color.toUpperCase()),color);
  assert.equal(safeHighlight(`rgb(${rgb})`),color);
 }
});
test('Clearing a highlight survives transparent color serialization',()=>{
 assert.equal(safeHighlight('transparent'),'transparent');
 assert.equal(safeHighlight('rgba(0, 0, 0, 0)'),'transparent');
});
test('Rejects arbitrary imported CSS colors and external resources',()=>{
 for(const value of ['url(https://example.test/x)','red','var(--injected)','expression(alert(1))',null,''])assert.equal(safeHighlight(value),null);
});

test('Allows only supported paragraph alignment values', () => {
 for (const value of ['left', 'center', 'right', 'justify']) assert.equal(safeAlignment(` ${value.toUpperCase()} `), value);
 for (const value of ['', null, 'inherit', 'var(--alignment)', 'center; color:red']) assert.equal(safeAlignment(value), null);
});
