import { strToU8, zipSync } from 'fflate';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const r = (text: string, rPr = '') => `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (runs: string, pPr = '') => `<w:p><w:pPr>${pPr}</w:pPr>${runs}</w:p>`;
const tab = '<w:r><w:tab/></w:r>';
const cell = (w: number, content: string, tcPr = '') => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${tcPr}</w:tcPr>${content}</w:tc>`;

export function sampleDocx(png?: Uint8Array): Uint8Array {
  const body = [
    p(r('Jordan Reyes', '<w:sz w:val="40"/><w:color w:val="1F3864"/>'), '<w:pStyle w:val="Title"/><w:jc w:val="center"/>'),
    p(r('Makati City · jordan@example.com · 0917 555 0101', '<w:color w:val="595959"/>'), '<w:jc w:val="center"/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="4" w:color="1F3864"/></w:pBdr>'),
    p(r('Experience'), '<w:pStyle w:val="Heading1"/>'),
    p(r('Finance Analyst, Acme Holdings', '<w:b/>') + tab + r('Jan 2023 – Present', '<w:i/>'), '<w:tabs><w:tab w:val="right" w:pos="9026"/></w:tabs>'),
    p(r('Built the monthly close pack and cut reconciliation time from five days to two by automating bank matching. ') + r('Owner of the billing tranche reports.', '<w:highlight w:val="yellow"/>') + r(' secret note', '<w:vanish/>'), '<w:jc w:val="both"/>'),
    p(r('Prepared tranche billing for three clients'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
    p(r('Trained two junior analysts'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
    p(r('Skills'), '<w:pStyle w:val="Heading1"/>'),
    '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="4513"/><w:gridCol w:w="4513"/></w:tblGrid>' +
      `<w:tr>${cell(4513, p(r('Excel, Power Query, SQL')))}${cell(4513, p(r('SAP FI, QuickBooks')))}</w:tr></w:tbl>`,
    p(r('Billing summary'), '<w:pStyle w:val="Heading1"/>'),
    '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3026"/></w:tblGrid>' +
      `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell(3000, p(r('Tranche', '<w:b/><w:color w:val="FFFFFF"/>')), '<w:shd w:val="clear" w:color="auto" w:fill="1F3864"/>')}${cell(3000, p(r('Amount', '<w:b/><w:color w:val="FFFFFF"/>'), '<w:jc w:val="right"/>'), '<w:shd w:val="clear" w:color="auto" w:fill="1F3864"/>')}${cell(3026, p(r('Status', '<w:b/><w:color w:val="FFFFFF"/>')), '<w:shd w:val="clear" w:color="auto" w:fill="1F3864"/>')}</w:tr>` +
      `<w:tr>${cell(3000, p(r('T1')))}${cell(3000, p(r('120,000.00'), '<w:jc w:val="right"/>'))}${cell(3026, p(r('Paid')), '<w:vMerge w:val="restart"/>')}</w:tr>` +
      `<w:tr>${cell(3000, p(r('T2')))}${cell(3000, p(r('80,500.00'), '<w:jc w:val="right"/>'))}${cell(3026, p(''), '<w:vMerge/>')}</w:tr>` +
      `<w:tr>${cell(6000, p(r('Total', '<w:b/>'), '<w:jc w:val="right"/>'), '<w:gridSpan w:val="2"/>')}${cell(3026, p(r('200,500.00', '<w:b/>')))}</w:tr></w:tbl>`,
    p(r('Water is H') + r('2', '<w:vertAlign w:val="subscript"/>') + r('O and E = mc') + r('2', '<w:vertAlign w:val="superscript"/>') + r(' old price', '<w:strike/>') + r(' in Times New Roman', '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>') + r(' and Consolas', '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>')),
    p(r('Contents')),
    p(r('Introduction') + tab + r('3'), '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9026"/></w:tabs>'),
    png ? `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="952500"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>` : '',
    p(r('Long section. '.repeat(400))),
  ].join('');
  const sect = '<w:sectPr><w:headerReference w:type="default" r:id="rHdr"/><w:footerReference w:type="default" r:id="rFtr"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
  const styles = `<w:styles ${NS}>
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:color w:val="2F5496"/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:contextualSpacing/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:sz w:val="56"/></w:rPr></w:style>
  <w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
  <w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;
  const theme = '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>';
  const numbering = `<w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#xF0B7;"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const header = `<w:hdr ${NS}>${p(r('Acme Holdings · Confidential', '<w:color w:val="808080"/><w:sz w:val="18"/>'), '<w:jc w:val="right"/>')}</w:hdr>`;
  const footer = `<w:ftr ${NS}><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${r('Page ')}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>${r(' of ')}<w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>9</w:t></w:r></w:fldSimple></w:p></w:ftr>`;
  return zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`),
    'word/styles.xml': strToU8(styles),
    'word/theme/theme1.xml': strToU8(theme),
    'word/numbering.xml': strToU8(numbering),
    'word/header1.xml': strToU8(header),
    'word/footer1.xml': strToU8(footer),
    'word/_rels/document.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rHdr" Type="x/header" Target="header1.xml"/><Relationship Id="rFtr" Type="x/footer" Target="footer1.xml"/><Relationship Id="rImg" Type="x/image" Target="media/image1.png"/></Relationships>'),
    ...(png ? { 'word/media/image1.png': png } : {}),
  });
}
