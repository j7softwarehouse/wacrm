// Gera contacts-pt-header.xlsx: mesmo cabecalho real da lista da escola
// (lista_emanuel.xlsx) que motivou o bug de sinonimos de coluna --
// ["Nome Salvo", "Telefone", "email", "empresa"]. Reusa o mesmo
// boilerplate OOXML minimo dos outros fixtures deste diretorio (so
// [Content_Types].xml, _rels/.rels, xl/workbook.xml,
// xl/_rels/workbook.xml.rels, xl/styles.xml, xl/worksheets/sheet1.xml).
//
// Rodar com: node src/lib/contacts/__fixtures__/generate-pt-header-fixture.mjs
import { zipSync, strToU8 } from 'fflate';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`;

// Linha 1: cabeçalho real da escola. Linha 2: reproduz o padrão real —
// telefone gravado como número, sem nome (contato ainda não
// identificado). Linha 3: com "Nome Salvo" e "empresa" preenchidos,
// pra exercitar os dois aliases na mesma planilha.
const inlineStr = (text) =>
  `<is><t xml:space="preserve">${text}</t></is>`;

const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr">${inlineStr('Nome Salvo')}</c><c r="B1" t="inlineStr">${inlineStr('Telefone')}</c><c r="C1" t="inlineStr">${inlineStr('email')}</c><c r="D1" t="inlineStr">${inlineStr('empresa')}</c></row><row r="2"><c r="B2"><v>553189891123</v></c></row><row r="3"><c r="A3" t="inlineStr">${inlineStr('Família Silva')}</c><c r="B3"><v>553183886076</v></c><c r="D3" t="inlineStr">${inlineStr('Instituto Emanuel')}</c></row></sheetData></worksheet>`;

const zip = zipSync({
  '[Content_Types].xml': strToU8(contentTypes),
  '_rels/.rels': strToU8(rootRels),
  'xl/workbook.xml': strToU8(workbook),
  'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
  'xl/styles.xml': strToU8(styles),
  'xl/worksheets/sheet1.xml': strToU8(sheet1),
});

writeFileSync(join(__dirname, 'contacts-pt-header.xlsx'), zip);
console.log('gerado: contacts-pt-header.xlsx');

// Segundo fixture: cabeçalho sem nenhuma coluna de telefone
// reconhecível (nem "phone" nem "telefone") -- exercita
// `missingPhoneColumnHeaders` no caminho .xlsx de verdade, não só via
// CSV.
const sheet1NoPhone = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr">${inlineStr('Nome Salvo')}</c><c r="B1" t="inlineStr">${inlineStr('email')}</c><c r="C1" t="inlineStr">${inlineStr('empresa')}</c></row><row r="2"><c r="A2" t="inlineStr">${inlineStr('Ramon')}</c><c r="B2" t="inlineStr">${inlineStr('ramon@escola.com')}</c><c r="C2" t="inlineStr">${inlineStr('Instituto')}</c></row></sheetData></worksheet>`;

const zipNoPhone = zipSync({
  '[Content_Types].xml': strToU8(contentTypes),
  '_rels/.rels': strToU8(rootRels),
  'xl/workbook.xml': strToU8(workbook),
  'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
  'xl/styles.xml': strToU8(styles),
  'xl/worksheets/sheet1.xml': strToU8(sheet1NoPhone),
});

writeFileSync(join(__dirname, 'contacts-no-phone-column.xlsx'), zipNoPhone);
console.log('gerado: contacts-no-phone-column.xlsx');
