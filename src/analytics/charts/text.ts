/**
 * Text measuring for SVG layout without a DOM: an estimate per character
 * class, slightly generous so that labels never overflow their mark.
 */

const NARROW = new Set("il.,;:'|!()[]ìíjtfI ".split(""));
const WIDE = new Set("mwMW@%".split(""));

export const textWidth = (text: string, fontSize: number): number => {
  let units = 0;
  for (const char of text) {
    if (NARROW.has(char)) units += 0.3;
    else if (WIDE.has(char)) units += 0.86;
    else if (char >= "A" && char <= "Z") units += 0.66;
    else if (char >= "0" && char <= "9") units += 0.56;
    else units += 0.54;
  }
  return Math.ceil(units * fontSize * 1.08);
};

/** `text` cut with "…" to fit `maxWidth`. */
export const truncateText = (
  text: string,
  maxWidth: number,
  fontSize: number
): string => {
  if (textWidth(text, fontSize) <= maxWidth) return text;
  const chars = [...text];
  while (chars.length > 1) {
    chars.pop();
    const candidate = `${chars.join("").trimEnd()}…`;
    if (textWidth(candidate, fontSize) <= maxWidth) return candidate;
  }
  return "…";
};

/**
 * `text` on at most `maxLines` lines of `maxWidth`, broken at spaces (or
 * hyphens); the last line ends with "…" when the rest does not fit.
 */
export const wrapText = (
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines = 2
): string[] => {
  if (textWidth(text, fontSize) <= maxWidth || maxLines <= 1) {
    return [truncateText(text, maxWidth, fontSize)];
  }
  const words = text.split(/(?<=[\s-])/);
  const fit = (line: string) => truncateText(line.trim(), maxWidth, fontSize);
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const candidate = line + words[i];
    if (line && textWidth(candidate.trimEnd(), fontSize) > maxWidth) {
      if (lines.length === maxLines - 1) {
        lines.push(fit(line + words.slice(i).join("")));
        return lines;
      }
      lines.push(fit(line));
      line = words[i];
    } else {
      line = candidate;
    }
  }
  lines.push(fit(line));
  return lines;
};
