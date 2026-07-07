import * as zlib from 'zlib';

// Test-only helper (not a `.spec.ts`, so Jest does not treat it as a suite).
//
// Extracts the visible text of a PDFKit-rendered PDF so tests can assert on the actual document
// content, not merely that a PDF was produced. PDFKit emits each text run as WinAnsi hex bytes inside
// a `[...] TJ` array; we inflate the FlateDecode content streams and decode those bytes. Characters
// outside Latin-1 (e.g. the em dash) are irrelevant to anything asserted by the callers.
export function extractPdfText(base64: string): string {
  const buf = Buffer.from(base64, 'base64');
  const runs: string[] = [];
  let idx = 0;
  while (true) {
    const start = buf.indexOf('stream', idx, 'latin1');
    if (start === -1) break;
    if (buf.toString('latin1', start - 3, start) === 'end') {
      idx = start + 6;
      continue;
    }
    let dataStart = start + 6;
    if (buf[dataStart] === 0x0d && buf[dataStart + 1] === 0x0a) dataStart += 2;
    else if (buf[dataStart] === 0x0a) dataStart += 1;
    const end = buf.indexOf('endstream', dataStart, 'latin1');
    if (end === -1) break;
    idx = end + 9;

    let content: string;
    try {
      content = zlib.inflateSync(buf.subarray(dataStart, end)).toString('latin1');
    } catch {
      continue; // not a FlateDecode stream (e.g. the embedded logo image)
    }
    if (!content.includes('BT')) continue;

    const tjArray = /\[([^\]]*)\]\s*TJ/g;
    let match: RegExpExecArray | null;
    while ((match = tjArray.exec(content))) {
      const hexParts = match[1].match(/<([0-9A-Fa-f]*)>/g) ?? [];
      runs.push(hexParts.map((part) => Buffer.from(part.slice(1, -1), 'hex').toString('latin1')).join(''));
    }
  }
  return runs.join('\n');
}
