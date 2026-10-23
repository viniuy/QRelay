export interface XmlTag {
  kind: 'open' | 'close' | 'empty';
  name: string;
  attrs: Record<string, string>;
}

export type XmlToken = XmlTag | { kind: 'text'; text: string };

const TAG = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>/g;
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function* tokenizeXml(xml: string): Generator<XmlToken> {
  let last = 0;
  TAG.lastIndex = 0;
  for (let m = TAG.exec(xml); m !== null; m = TAG.exec(xml)) {
    if (m.index > last) yield { kind: 'text', text: decodeEntities(xml.slice(last, m.index)) };
    last = TAG.lastIndex;
    if (m[5] !== undefined) {
      yield { kind: 'text', text: m[5] };
      continue;
    }
    if (m[2] === undefined) continue;
    const attrs: Record<string, string> = {};
    if (m[3]) {
      ATTR.lastIndex = 0;
      for (let a = ATTR.exec(m[3]); a !== null; a = ATTR.exec(m[3])) attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? '');
    }
    yield { kind: m[1] ? 'close' : m[4] ? 'empty' : 'open', name: m[2], attrs };
  }
  if (last < xml.length) yield { kind: 'text', text: decodeEntities(xml.slice(last)) };
}

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    switch (e) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    }
  });
}

export function escapeXml(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
