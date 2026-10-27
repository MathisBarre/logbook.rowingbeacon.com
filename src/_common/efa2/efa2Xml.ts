/**
 * Reader and writer for efa2 data files (ADR 0004): a header followed by
 * flat records, each field being a child element holding text.
 *
 *   <efa><header><type>efa2boats</type>…</header>
 *   <data><record><Id>…</Id><Name>…</Name></record>…</data></efa>
 *
 * Field values are kept as raw text; efa2Values.ts converts them.
 */

export type Efa2Fields = Record<string, string>;

export interface Efa2File {
  header: Efa2Fields;
  records: Efa2Fields[];
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** A character reference out of Unicode's range is kept as written. */
const fromCodePoint = (code: number, match: string) => {
  try {
    return String.fromCodePoint(code);
  } catch {
    return match;
  }
};

export const unescapeXml = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return fromCodePoint(parseInt(entity.slice(2), 16), match);
    }
    if (entity.startsWith("#")) {
      return fromCodePoint(parseInt(entity.slice(1), 10), match);
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });

export const escapeXml = (text: string) =>
  text
    // Control characters XML 1.0 forbids (a pasted comment): efa would
    // refuse the whole file.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Fields of a flat element body: `<A>x</A><B/>…`. */
const parseFields = (body: string): Efa2Fields => {
  const fields: Efa2Fields = {};
  const pattern = /<([A-Za-z_][\w.-]*)\s*(\/>|>([\s\S]*?)<\/\1\s*>)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    fields[match[1]] = match[3] === undefined ? "" : unescapeXml(match[3]);
  }
  return fields;
};

export class Efa2FormatError extends Error {}

export const parseEfa2File = (xml: string): Efa2File => {
  const text = xml.replace(/^\uFEFF/, "").replace(/<!--[\s\S]*?-->/g, "");
  if (!/<efa[\s>]/.test(text)) {
    throw new Efa2FormatError("Not an efa2 data file");
  }

  const headerMatch = /<header>([\s\S]*?)<\/header>/.exec(text);
  const header = headerMatch ? parseFields(headerMatch[1]) : {};

  const records: Efa2Fields[] = [];
  const dataMatch = /<data>([\s\S]*?)<\/data>/.exec(text);
  if (dataMatch) {
    const recordPattern = /<record>([\s\S]*?)<\/record>/g;
    let match: RegExpExecArray | null;
    while ((match = recordPattern.exec(dataMatch[1])) !== null) {
      records.push(parseFields(match[1]));
    }
  } else if (!/<data\s*\/>/.test(text) && !/<\/efa>/.test(text)) {
    throw new Efa2FormatError("Truncated efa2 data file");
  }

  return { header, records };
};

const fieldLines = (fields: Efa2Fields, indent: string) =>
  Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${indent}<${key}>${escapeXml(value)}</${key}>`)
    .join("\n");

/**
 * Write a data file the way efa2 lays it out. `LastModified` and
 * `ChangeCount` are moved last, where efa2 expects them.
 */
export const serializeEfa2File = (file: Efa2File): string => {
  const records = file.records.map((record) => {
    const { ChangeCount, LastModified, ...rest } = record;
    const ordered: Efa2Fields = { ...rest };
    if (ChangeCount !== undefined) ordered.ChangeCount = ChangeCount;
    if (LastModified !== undefined) ordered.LastModified = LastModified;
    return `    <record>\n${fieldLines(ordered, "      ")}\n    </record>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<efa>",
    "  <header>",
    fieldLines(file.header, "    "),
    "  </header>",
    "  <data>",
    ...records,
    "  </data>",
    "</efa>",
    "",
  ].join("\n");
};
