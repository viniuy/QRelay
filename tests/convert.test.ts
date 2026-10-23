import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { docxToPdf, DocxUnreadable } from '../src/features/edit/docxToPdf';
import { pngFromScanlines } from '../src/features/edit/imageBytes';
import { parseCMap, PdfHasNoText, pdfToDocx } from '../src/features/edit/pdfToDocx';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';

function docx(body: string, media: Record<string, Uint8Array> = {}): Uint8Array {
  const rels = Object.keys(media)
    .map((name, i) => `<Relationship Id="rImg${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`)
    .join('');
  return zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`),
    'word/styles.xml': strToU8(`<w:styles ${W}><w:style w:type="paragraph" w:styleId="Kop1"><w:name w:val="heading 1"/></w:style></w:styles>`),
    'word/numbering.xml': strToU8(`<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`),
    'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`),
    ...Object.fromEntries(Object.entries(media).map(([name, bytes]) => [`word/media/${name}`, bytes])),
  });
}

const p = (text: string, pPr = '', rPr = '') => `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

function documentText(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)['word/document.xml']);
}

describe('Word to PDF', () => {
  it('lays out headings, lists, tables, images and page breaks', async () => {
    const scanlines = new Uint8Array(4 * (1 + 4 * 3)).fill(200);
    for (let row = 0; row < 4; row++) scanlines[row * 13] = 0;
    const png = pngFromScanlines(scanlines, 4, 4, 3);
    const long = 'The quick brown fox jumps over the lazy dog. '.repeat(40);
    const body = [
      p('Quarterly report', '<w:pStyle w:val="Kop1"/>'),
      p('Revenue &amp; costs', '', '<w:b/>'),
      p(long),
      p('First point', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
      p('Second point', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
      '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1270000" cy="1270000"/><a:graphic><a:graphicData><pic:pic xmlns:pic="x"><pic:blipFill><a:blip r:embed="rImg0"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>',
      '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>' + p('Region') + '</w:tc><w:tc>' + p('Total') + '</w:tc></w:tr><w:tr><w:tc>' + p('North') + '</w:tc><w:tc>' + p('1,200') + '</w:tc></w:tr></w:tbl>',
      '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
      p('Appendix after the break'),
      '<w:p><w:del><w:r><w:delText>deleted words</w:delText></w:r></w:del></w:p>',
    ].join('');
    const report = await docxToPdf(docx(body, { 'image1.png': png }), 'report');
    expect(report.images).toBe(1);
    expect(report.skippedImages).toBe(0);
    expect(report.replacedChars).toBe(0);
    expect(report.pages).toBeGreaterThanOrEqual(2);
    const pdf = await PDFDocument.load(report.bytes);
    expect(pdf.getPageCount()).toBe(report.pages);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(595.3, 0);

    const back = await pdfToDocx(report.bytes);
    const xml = documentText(back.bytes);
    for (const s of ['Quarterly report', 'Revenue &amp; costs', 'First point', 'Second point', 'Region', 'North', '1,200', 'Appendix after the break']) expect(xml).toContain(s);
    expect(xml).toContain('The quick brown fox jumps over the lazy dog. The quick brown fox');
    expect(xml).not.toContain('deleted words');
    expect(xml).toMatch(/<w:pStyle w:val="Heading1"\/><\/w:pPr>(<w:r><w:br w:type="page"\/><\/w:r>)?<w:r><w:rPr><\/w:rPr><w:t xml:space="preserve">Quarterly report/);
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(back.headings).toBeGreaterThanOrEqual(1);
  });

  it('counts characters the PDF font cannot draw', async () => {
    const report = await docxToPdf(docx(p('Hello Привет — “quotes”')));
    expect(report.replacedChars).toBe(6);
  });

  it('rejects files that are not .docx', async () => {
    await expect(docxToPdf(strToU8('not a zip at all'))).rejects.toBeInstanceOf(DocxUnreadable);
    await expect(docxToPdf(zipSync({ 'a.txt': strToU8('x') }))).rejects.toBeInstanceOf(DocxUnreadable);
  });
});

describe('PDF to Word', () => {
  it('splits paragraphs on vertical gaps and keeps reading order', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    page.drawText('Line one of the first paragraph', { x: 72, y: 760, size: 11, font });
    page.drawText('continues here.', { x: 72, y: 746, size: 11, font });
    page.drawText('Second paragraph.', { x: 72, y: 700, size: 11, font });
    const report = await pdfToDocx(await doc.save());
    const xml = documentText(report.bytes);
    expect(report.paragraphs).toBe(2);
    expect(xml).toContain('Line one of the first paragraph continues here.');
    expect(xml.indexOf('Line one')).toBeLessThan(xml.indexOf('Second paragraph.'));
  });

  it('decodes subset Type0 fonts the way Word and Chrome export them', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const ctx = doc.context;
    const cmap = ctx.stream(`/CIDInit /ProcSet findresource begin 12 dict begin begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
2 beginbfchar <0003> <0020> <0010> <00660069> endbfchar
1 beginbfrange <0024> <003D> <0041> endbfrange
1 beginbfrange <0044> <005D> <0061> endbfrange
endcmap CMapName currentdict /CMap defineresource pop end end`);
    const cid = (bold: boolean) =>
      ctx.register(ctx.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: bold ? 'ABCDEF+Calibri-Bold' : 'ABCDEF+Calibri', DW: 500, W: [3, [226]] }));
    const type0 = (bold: boolean) =>
      ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: bold ? 'ABCDEF+Calibri-Bold' : 'ABCDEF+Calibri', Encoding: 'Identity-H', DescendantFonts: [cid(bold)], ToUnicode: ctx.register(cmap) }));
    page.node.setFontDictionary(PDFName.of('F1'), type0(true));
    page.node.setFontDictionary(PDFName.of('F2'), type0(false));
    const hex = (s: string) => s.replace(/fi|./g, (ch) => (ch === 'fi' ? '0010' : ch === ' ' ? '0003' : ch <= 'Z' ? (ch.charCodeAt(0) - 0x41 + 0x24).toString(16).padStart(4, '0') : (ch.charCodeAt(0) - 0x61 + 0x44).toString(16).padStart(4, '0')));
    const content = [
      'BT /F1 24 Tf 1 0 0 1 72 760 Tm',
      `<${hex('Heading')}> Tj ET`,
      'BT /F2 11 Tf 1 0 0 1 72 720 Tm',
      `[<${hex('The')}> -230 <${hex('fi')}> 40 <${hex('rst')}> -250 <${hex('line')}>] TJ`,
      `0 -13.4 Td <${hex('goes on')}> Tj ET`,
    ].join('\n');
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(content)));
    const report = await pdfToDocx(await doc.save());
    const xml = documentText(report.bytes);
    expect(xml).toContain('<w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr></w:rPr><w:t xml:space="preserve">Heading</w:t>');
    expect(xml).toContain('The first line goes on');
    expect(report.paragraphs).toBe(2);
  });

  it('says so when a PDF has no text layer', async () => {
    const doc = await PDFDocument.create();
    doc.addPage().drawRectangle({ x: 10, y: 10, width: 100, height: 100 });
    await expect(pdfToDocx(await doc.save())).rejects.toBeInstanceOf(PdfHasNoText);
  });

  it('reads ToUnicode CMaps with bfchar and bfrange entries', () => {
    const cmap = parseCMap(`1 begincodespacerange <0000> <FFFF> endcodespacerange
2 beginbfchar <0003> <0020> <0011> <00660069> endbfchar
2 beginbfrange <0024> <0026> <0041> <0030> <0031> [<00E9> <2014>] endbfrange`);
    expect(cmap.codeBytes).toBe(2);
    expect(cmap.map.get(0x03)).toBe(' ');
    expect(cmap.map.get(0x11)).toBe('fi');
    expect(cmap.map.get(0x24)).toBe('A');
    expect(cmap.map.get(0x26)).toBe('C');
    expect(cmap.map.get(0x30)).toBe('é');
    expect(cmap.map.get(0x31)).toBe('—');
  });
});
