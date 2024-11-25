import jsSHA from "jssha";

export function hashPassword(password: string): string {
  const shaObj = new jsSHA("SHA-256", "TEXT", { encoding: "UTF8" });
  shaObj.update(password);
  return shaObj.getHash("HEX");
}

export function verifyPassword(password: string, hash: string): boolean {
  const newHash = hashPassword(password);
  return newHash === hash;
}
