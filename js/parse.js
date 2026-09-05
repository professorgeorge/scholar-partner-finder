/*
 * parse.js — turn an uploaded file into plain text, with no third-party
 * libraries. Everything here runs on-device.
 *
 * Supported: .txt .md .csv .tsv .rtf .html .htm (trivial), .docx (via a
 * minimal ZIP reader + the platform DecompressionStream), and .pdf (via a
 * from-scratch content-stream text extractor). If SPF.pdfjs has been loaded
 * (optional, opt-in), it is used for PDFs instead, which is more accurate.
 *
 * The PDF extractor is best-effort: it recovers text from digitally created
 * PDFs but not from scanned images, and it can garble PDFs that use custom
 * font encodings. The UI exposes a "paste text" fallback and manual editing
 * for exactly these cases.
 */
(function (SPF) {
  'use strict';

  // ---- generic helpers ---------------------------------------------------

  function ab2u8(ab) { return ab instanceof Uint8Array ? ab : new Uint8Array(ab); }

  async function inflate(bytes, format) {
    // format: 'deflate' (zlib-wrapped, used by PDF FlateDecode) or
    // 'deflate-raw' (bare deflate, used by ZIP/DOCX entries).
    var ds = new DecompressionStream(format);
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    var buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  function decodeUtf8(bytes) {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  function decodeLatin1(bytes) {
    // Fast Latin1 decode; used for scanning PDF structure byte-for-byte.
    var out = '';
    var CH = 8192;
    for (var i = 0; i < bytes.length; i += CH) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)));
    }
    return out;
  }

  function decodeEntities(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); })
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&amp;/g, '&');
  }

  function cleanText(s) {
    return s
      .replace(/\r\n?/g, '\n')
      .replace(/ /g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .trim();
  }

  // ---- plain-ish formats -------------------------------------------------

  function fromText(bytes) { return cleanText(decodeUtf8(bytes)); }

  function fromHtml(bytes) {
    var s = decodeUtf8(bytes);
    s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    return cleanText(decodeEntities(s));
  }

  function fromRtf(bytes) {
    var s = decodeLatin1(bytes);
    // Strip RTF groups and control words; keep visible text.
    s = s.replace(/\\'([0-9a-fA-F]{2})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\line/g, '\n')
      .replace(/\\tab/g, ' ')
      .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
      .replace(/[{}]/g, '');
    return cleanText(s);
  }

  // ---- DOCX (minimal ZIP reader) ----------------------------------------

  function readUint32LE(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function readUint16LE(b, o) { return (b[o] | (b[o + 1] << 8)); }

  // Parse the ZIP central directory and return a map of name -> {method, start, size}.
  function readZipDirectory(bytes) {
    var EOCD = 0x06054b50;
    // Scan backwards for the End Of Central Directory record.
    var i = bytes.length - 22;
    var min = Math.max(0, bytes.length - 22 - 65536);
    var eocd = -1;
    for (; i >= min; i--) {
      if (readUint32LE(bytes, i) === EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a ZIP/DOCX file (no EOCD).');
    var count = readUint16LE(bytes, eocd + 10);
    var cdOffset = readUint32LE(bytes, eocd + 16);
    var entries = {};
    var p = cdOffset;
    for (var n = 0; n < count; n++) {
      if (readUint32LE(bytes, p) !== 0x02014b50) break;
      var method = readUint16LE(bytes, p + 10);
      var compSize = readUint32LE(bytes, p + 20);
      var nameLen = readUint16LE(bytes, p + 28);
      var extraLen = readUint16LE(bytes, p + 30);
      var commentLen = readUint16LE(bytes, p + 32);
      var localOffset = readUint32LE(bytes, p + 42);
      var name = decodeUtf8(bytes.subarray(p + 46, p + 46 + nameLen));
      entries[name] = { method: method, compSize: compSize, localOffset: localOffset };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function extractZipEntry(bytes, entry) {
    // The local header repeats name/extra lengths, which can differ from the
    // central directory, so re-read them here to find the data start.
    var lo = entry.localOffset;
    if (readUint32LE(bytes, lo) !== 0x04034b50) throw new Error('Bad local header.');
    var nameLen = readUint16LE(bytes, lo + 26);
    var extraLen = readUint16LE(bytes, lo + 28);
    var dataStart = lo + 30 + nameLen + extraLen;
    var comp = bytes.subarray(dataStart, dataStart + entry.compSize);
    if (entry.method === 0) return comp;            // stored
    if (entry.method === 8) return inflate(comp, 'deflate-raw'); // deflate
    throw new Error('Unsupported ZIP compression method ' + entry.method);
  }

  function docXmlToText(xml) {
    // Preserve paragraph, line-break, tab and table-row structure as whitespace.
    var s = xml
      .replace(/<w:tab\b[^>]*\/?>/g, ' ')
      .replace(/<w:br\b[^>]*\/?>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/w:tr>/g, '\n')
      .replace(/<[^>]+>/g, '');
    return cleanText(decodeEntities(s));
  }

  async function fromDocx(bytes) {
    var dir = readZipDirectory(bytes);
    var parts = [];
    // Main body first, then headers/footers, in a stable order.
    var order = Object.keys(dir).filter(function (k) {
      return k === 'word/document.xml' ||
        /^word\/(header|footer)\d*\.xml$/.test(k);
    }).sort(function (a, b) {
      if (a === 'word/document.xml') return -1;
      if (b === 'word/document.xml') return 1;
      return a.localeCompare(b);
    });
    if (order.indexOf('word/document.xml') === -1) {
      throw new Error('Not a Word .docx (no word/document.xml).');
    }
    for (var i = 0; i < order.length; i++) {
      var raw = await extractZipEntry(bytes, dir[order[i]]);
      parts.push(docXmlToText(decodeUtf8(raw)));
    }
    return cleanText(parts.join('\n'));
  }

  // ---- PDF (from-scratch content-stream extractor) ----------------------

  function decodePdfString(raw) {
    // raw is the bytes between ( and ) already unescaped of balanced parens by caller.
    var out = '';
    for (var i = 0; i < raw.length; i++) {
      var c = raw[i];
      if (c === '\\') {
        var n = raw[i + 1];
        if (n === 'n') { out += '\n'; i++; }
        else if (n === 'r') { out += '\r'; i++; }
        else if (n === 't') { out += '\t'; i++; }
        else if (n === 'b') { out += '\b'; i++; }
        else if (n === 'f') { out += '\f'; i++; }
        else if (n === '(' || n === ')' || n === '\\') { out += n; i++; }
        else if (n >= '0' && n <= '7') {
          var oct = n; i++;
          for (var k = 0; k < 2 && raw[i + 1] >= '0' && raw[i + 1] <= '7'; k++) { oct += raw[++i]; }
          out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        } else if (n === '\n') { i++; }
        else { out += n; i++; }
      } else {
        out += c;
      }
    }
    return out;
  }

  function decodeHexString(hex) {
    hex = hex.replace(/[^0-9a-fA-F]/g, '');
    if (hex.length % 2) hex += '0';
    var out = '';
    for (var i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    return out;
  }

  // Extract readable text from a single decoded content-stream string.
  function textFromContentStream(cs) {
    var out = '';
    var i = 0;
    var len = cs.length;
    function readParenString() {
      // Assumes cs[i] === '('. Returns raw inner (with escapes intact), advances i past ')'.
      var depth = 0, start = ++i, buf = '';
      for (; i < len; i++) {
        var c = cs[i];
        if (c === '\\') { buf += c + (cs[i + 1] || ''); i++; continue; }
        if (c === '(') { depth++; buf += c; continue; }
        if (c === ')') { if (depth === 0) { i++; return buf; } depth--; buf += c; continue; }
        buf += c;
      }
      return buf;
    }
    // Walk the stream looking for text-showing operators.
    while (i < len) {
      var c = cs[i];
      if (c === '(') {
        var raw = readParenString();
        // Determine operator following (allowing whitespace): Tj, ' or "
        var j = i; while (j < len && /\s/.test(cs[j])) j++;
        out += decodePdfString(raw);
        // ' and " imply a line break before the text.
        if (cs[j] === "'" || cs[j] === '"') out = out.slice(0, -decodePdfString(raw).length) + '\n' + decodePdfString(raw);
        continue;
      }
      if (c === '<' && cs[i + 1] !== '<') {
        var end = cs.indexOf('>', i);
        if (end > i) { out += decodeHexString(cs.slice(i + 1, end)); i = end + 1; continue; }
      }
      if (c === '[') {
        // TJ array: collect strings, treat large negative kerns as spaces.
        var arrEnd = cs.indexOf(']', i);
        if (arrEnd > i) {
          var arr = cs.slice(i + 1, arrEnd);
          var k = 0, piece = '';
          while (k < arr.length) {
            if (arr[k] === '(') {
              var d = 0, b = '';
              k++;
              for (; k < arr.length; k++) {
                var ch = arr[k];
                if (ch === '\\') { b += ch + (arr[k + 1] || ''); k++; continue; }
                if (ch === '(') { d++; b += ch; continue; }
                if (ch === ')') { if (d === 0) { k++; break; } d--; b += ch; continue; }
                b += ch;
              }
              piece += decodePdfString(b);
            } else if (arr[k] === '<') {
              var he = arr.indexOf('>', k);
              piece += decodeHexString(arr.slice(k + 1, he)); k = he + 1;
            } else if (/[-0-9.]/.test(arr[k])) {
              var numStart = k;
              while (k < arr.length && /[-0-9.]/.test(arr[k])) k++;
              var num = parseFloat(arr.slice(numStart, k));
              if (num <= -100) piece += ' ';
            } else { k++; }
          }
          out += piece;
          i = arrEnd + 1;
          continue;
        }
      }
      // Line/position operators -> whitespace so words do not run together.
      if (c === 'T') {
        var op2 = cs.substr(i, 2);
        if (op2 === 'Td' || op2 === 'TD' || op2 === 'T*') { out += '\n'; i += 2; continue; }
      }
      i++;
    }
    return out;
  }

  async function fromPdf(bytes) {
    if (SPF.pdfjs && typeof SPF.pdfjs.extract === 'function') {
      try { return cleanText(await SPF.pdfjs.extract(bytes)); } catch (e) { /* fall through */ }
    }
    var latin = decodeLatin1(bytes);
    var text = '';
    // Find every stream...endstream and try to decode content streams.
    var re = /stream\r?\n?/g, m;
    while ((m = re.exec(latin)) !== null) {
      var start = m.index + m[0].length;
      var end = latin.indexOf('endstream', start);
      if (end < 0) break;
      re.lastIndex = end + 9;
      // Header dictionary is the ~400 chars before "stream".
      var header = latin.slice(Math.max(0, m.index - 500), m.index);
      var isFlate = /\/FlateDecode/.test(header);
      var isImage = /\/Subtype\s*\/Image|\/Image\b/.test(header);
      if (isImage) continue;
      var chunk = bytes.subarray(start, end);
      // Trim a trailing EOL that belongs to the keyword, not the data.
      var decoded;
      if (isFlate) {
        try { decoded = decodeUtf8(await inflate(chunk, 'deflate')); }
        catch (e) { try { decoded = decodeUtf8(await inflate(chunk, 'deflate-raw')); } catch (e2) { continue; } }
      } else {
        decoded = decodeLatin1(chunk);
      }
      // Only content streams carry text-show operators.
      if (decoded.indexOf('Tj') === -1 && decoded.indexOf('TJ') === -1) continue;
      text += textFromContentStream(decoded) + '\n';
    }
    return cleanText(text);
  }

  // ---- dispatch ----------------------------------------------------------

  function extOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  // Parse an ArrayBuffer/Uint8Array into text. Returns {text, method, warning}.
  async function parseBuffer(buffer, filename) {
    var bytes = ab2u8(buffer);
    var ext = extOf(filename);
    try {
      if (ext === 'pdf') {
        var t = await fromPdf(bytes);
        return { text: t, method: 'pdf', warning: t.length < 40 ? 'Little or no text recovered from this PDF. It may be scanned or use custom fonts. Try pasting the text, or enable enhanced PDF parsing in Settings.' : '' };
      }
      if (ext === 'docx') return { text: await fromDocx(bytes), method: 'docx', warning: '' };
      if (ext === 'doc') return { text: '', method: 'doc', warning: 'Legacy .doc is not supported. Please save as .docx or paste the text.' };
      if (ext === 'rtf') return { text: fromRtf(bytes), method: 'rtf', warning: '' };
      if (ext === 'html' || ext === 'htm') return { text: fromHtml(bytes), method: 'html', warning: '' };
      // txt, md, csv, tsv, json, and unknown: treat as UTF-8 text.
      return { text: fromText(bytes), method: ext || 'text', warning: '' };
    } catch (e) {
      return { text: '', method: ext, warning: 'Could not parse ' + (filename || 'file') + ': ' + e.message };
    }
  }

  // Browser convenience: read a File object then parse.
  function parseFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read ' + file.name)); };
      reader.onload = function () { parseBuffer(reader.result, file.name).then(resolve, reject); };
      reader.readAsArrayBuffer(file);
    });
  }

  SPF.parse = {
    parseBuffer: parseBuffer,
    parseFile: parseFile,
    fromPdf: fromPdf,
    fromDocx: fromDocx,
    cleanText: cleanText,
    extOf: extOf
  };
})(typeof window !== 'undefined' ? (window.SPF = window.SPF || {}) : (globalThis.SPF = globalThis.SPF || {}));
