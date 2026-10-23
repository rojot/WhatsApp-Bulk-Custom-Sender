/**
 * Zero-dependency CSV & Excel (.xlsx) Parser for Chrome Extension (Manifest V3)
 * Parses .csv, .tsv, and .xlsx files natively in the browser without external CDN scripts.
 */

const FileParser = (() => {
  function parseCSV(text) {
    const cleanText = text.replace(/^\uFEFF/, '');
    const lines = [];
    let currentRow = [];
    let currentVal = '';
    let inQuotes = false;

    const firstLineEnd = cleanText.indexOf('\n');
    const firstLine = firstLineEnd !== -1 ? cleanText.slice(0, firstLineEnd) : cleanText;
    let delimiter = ',';
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semiCount = (firstLine.match(/;/g) || []).length;
    const tabCount = (firstLine.match(/\t/g) || []).length;
    if (tabCount > commaCount && tabCount >= semiCount) delimiter = '\t';
    else if (semiCount > commaCount) delimiter = ';';

    for (let i = 0; i < cleanText.length; i++) {
      const ch = cleanText[i];
      const next = cleanText[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          currentVal += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          currentVal += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === delimiter) {
          currentRow.push(currentVal.trim());
          currentVal = '';
        } else if (ch === '\r' && next === '\n') {
          currentRow.push(currentVal.trim());
          lines.push(currentRow);
          currentRow = [];
          currentVal = '';
          i++;
        } else if (ch === '\n' || ch === '\r') {
          currentRow.push(currentVal.trim());
          lines.push(currentRow);
          currentRow = [];
          currentVal = '';
        } else {
          currentVal += ch;
        }
      }
    }
    if (currentVal.length > 0 || currentRow.length > 0) {
      currentRow.push(currentVal.trim());
      lines.push(currentRow);
    }

    return buildTableObject(lines);
  }

  function buildTableObject(rawRows) {
    const nonEmpty = rawRows.filter(r => r.some(cell => String(cell || '').trim() !== ''));
    if (nonEmpty.length === 0) {
      return { headers: [], rows: [] };
    }
    const headers = nonEmpty[0].map((h, idx) => {
      const cleaned = String(h || '').trim();
      return cleaned || `column_${idx + 1}`;
    });

    const rows = [];
    for (let i = 1; i < nonEmpty.length; i++) {
      const rowArr = nonEmpty[i];
      const obj = {};
      let hasData = false;
      headers.forEach((h, colIdx) => {
        const val = rowArr[colIdx] !== undefined && rowArr[colIdx] !== null
          ? String(rowArr[colIdx]).trim()
          : '';
        obj[h] = val;
        if (val !== '') hasData = true;
      });
      if (hasData) rows.push(obj);
    }
    return { headers, rows };
  }

  async function unzipXlsxEntries(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);
    const decoder = new TextDecoder('utf-8');

    let eocdOffset = -1;
    const minOffset = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= minOffset; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) {
      throw new Error('Invalid .xlsx file (ZIP End of Central Directory not found).');
    }

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);

    const entries = {};
    let ptr = cdOffset;
    for (let e = 0; e < totalEntries; e++) {
      if (view.getUint32(ptr, true) !== 0x02014b50) break;
      const compressionMethod = view.getUint16(ptr + 10, true);
      const compressedSize = view.getUint32(ptr + 20, true);
      const fileNameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localHeaderOffset = view.getUint32(ptr + 42, true);

      const fileName = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + fileNameLen));
      ptr += 46 + fileNameLen + extraLen + commentLen;

      if (
        fileName === 'xl/sharedStrings.xml' ||
        fileName.startsWith('xl/worksheets/sheet')
      ) {
        const localFileNameLen = view.getUint16(localHeaderOffset + 26, true);
        const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
        const dataStart = localHeaderOffset + 30 + localFileNameLen + localExtraLen;
        const compressedSlice = bytes.subarray(dataStart, dataStart + compressedSize);

        let xmlText = '';
        if (compressionMethod === 0) {
          xmlText = decoder.decode(compressedSlice);
        } else if (compressionMethod === 8) {
          const ds = new DecompressionStream('deflate-raw');
          const writer = ds.writable.getWriter();
          writer.write(compressedSlice);
          writer.close();
          const decompressedBuf = await new Response(ds.readable).arrayBuffer();
          xmlText = decoder.decode(new Uint8Array(decompressedBuf));
        }
        entries[fileName] = xmlText;
      }
    }
    return entries;
  }

  function colLettersToIndex(cellRef) {
    const match = /^([A-Z]+)/i.exec(cellRef || '');
    if (!match) return -1;
    const letters = match[1].toUpperCase();
    let idx = 0;
    for (let i = 0; i < letters.length; i++) {
      idx = idx * 26 + (letters.charCodeAt(i) - 64);
    }
    return idx - 1;
  }

  async function parseXLSX(arrayBuffer) {
    const entries = await unzipXlsxEntries(arrayBuffer);
    const domParser = new DOMParser();

    const sharedStrings = [];
    if (entries['xl/sharedStrings.xml']) {
      const ssDoc = domParser.parseFromString(entries['xl/sharedStrings.xml'], 'application/xml');
      const siNodes = ssDoc.getElementsByTagNameNS('*', 'si');
      for (let i = 0; i < siNodes.length; i++) {
        const tNodes = siNodes[i].getElementsByTagNameNS('*', 't');
        let combined = '';
        for (let j = 0; j < tNodes.length; j++) {
          combined += tNodes[j].textContent || '';
        }
        sharedStrings.push(combined);
      }
    }

    const sheetKeys = Object.keys(entries)
      .filter(k => k.startsWith('xl/worksheets/sheet'))
      .sort();
    if (sheetKeys.length === 0) {
      throw new Error('No worksheet found inside .xlsx file.');
    }

    const sheetXml = entries[sheetKeys[0]];
    const sheetDoc = domParser.parseFromString(sheetXml, 'application/xml');
    const rowNodes = sheetDoc.getElementsByTagNameNS('*', 'row');
    const matrix = [];

    for (let r = 0; r < rowNodes.length; r++) {
      const rowEl = rowNodes[r];
      const cellNodes = rowEl.getElementsByTagNameNS('*', 'c');
      const rowValues = [];
      let nextFallbackCol = 0;

      for (let c = 0; c < cellNodes.length; c++) {
        const cellEl = cellNodes[c];
        const cellRef = cellEl.getAttribute('r') || '';
        const cellType = cellEl.getAttribute('t') || '';
        const colIdx = colLettersToIndex(cellRef);
        const targetCol = colIdx >= 0 ? colIdx : nextFallbackCol;
        nextFallbackCol = targetCol + 1;

        let value = '';
        if (cellType === 's') {
          const vNode = cellEl.getElementsByTagNameNS('*', 'v')[0];
          const ssIdx = vNode ? parseInt(vNode.textContent || '0', 10) : -1;
          value = ssIdx >= 0 && ssIdx < sharedStrings.length ? sharedStrings[ssIdx] : '';
        } else if (cellType === 'inlineStr') {
          const tNodes = cellEl.getElementsByTagNameNS('*', 't');
          let parts = '';
          for (let k = 0; k < tNodes.length; k++) {
            parts += tNodes[k].textContent || '';
          }
          value = parts;
        } else {
          const vNode = cellEl.getElementsByTagNameNS('*', 'v')[0];
          value = vNode ? (vNode.textContent || '') : '';
        }

        while (rowValues.length <= targetCol) {
          rowValues.push('');
        }
        rowValues[targetCol] = String(value).trim();
      }
      matrix.push(rowValues);
    }

    return buildTableObject(matrix);
  }

  async function parseFile(file) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.xlsx')) {
      const buf = await file.arrayBuffer();
      return await parseXLSX(buf);
    } else {
      const text = await file.text();
      return parseCSV(text);
    }
  }

  return { parseFile, parseCSV, parseXLSX };
})();
