export const highlightColors = Object.freeze({
  yellow: '#f0e8ba', green: '#d5e8c9', blue: '#cfe3f5', pink: '#f2d3df'
});
export function safeHighlight(value) {
  const normalized = (value || '').toLowerCase().replace(/\s+/g, '');
  if (normalized === 'transparent' || normalized === 'rgba(0,0,0,0)') return 'transparent';
  for (const color of Object.values(highlightColors)) {
    const rgb = color.slice(1).match(/../g).map(part => parseInt(part, 16)).join(',');
    if (normalized === color || normalized === `rgb(${rgb})`) return color;
  }
  return null;
}
export function sanitize(html, parser = new DOMParser()) {
  const source = parser.parseFromString(html, 'text/html');
  const allowed = new Set(['P','BR','DIV','B','STRONG','I','EM','U','S','STRIKE','DEL','H2','H3','BLOCKQUOTE','SPAN','MARK']);
  const walk = node => {
    if (node.nodeType === 3) return source.createTextNode(node.textContent);
    const frag = source.createDocumentFragment();
    if (['SCRIPT','STYLE','IFRAME','OBJECT','SVG','MATH','IMG'].includes(node.nodeName)) return frag;
    const tag = node.nodeName === 'MARK' ? 'span' : ['STRIKE','DEL'].includes(node.nodeName) ? 's' : node.nodeName.toLowerCase();
    const out = allowed.has(node.nodeName) ? source.createElement(tag) : frag;
    if (out.nodeType === 1) {
      const color = safeHighlight(node.style?.backgroundColor) || (node.nodeName === 'MARK' ? highlightColors.yellow : null);
      if (color) out.style.backgroundColor = color;
      const decorations = `${node.style?.textDecoration || ''} ${node.style?.textDecorationLine || ''}`.split(/\s+/).filter(value => ['line-through','underline'].includes(value));
      if (decorations.length) out.style.textDecoration = [...new Set(decorations)].join(' ');
    }
    for (const child of node.childNodes) out.append(walk(child));
    return out;
  };
  const out = source.createElement('div');
  for (const child of source.body.childNodes) out.append(walk(child));
  return out.innerHTML;
}
