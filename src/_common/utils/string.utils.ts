const removeAccents = (str: string) => {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

export const simplifyString = (str: string) => {
  return removeAccents(str).toLowerCase().trim();
};

export const areStringSimilar = (str1: string, str2: string) => {
  const s1 = simplifyString(str1);
  const s2 = simplifyString(str2);
  return s1.includes(s2) || s2.includes(s1);
};

export const replaceLastOccurrence = (
  str: string,
  search: string,
  replace: string
) => {
  const index = str.lastIndexOf(search);
  return str.slice(0, index) + replace + str.slice(index + search.length);
};

export const isStringEquivalentOfUndefined = (str: string | undefined) => {
  if (str === undefined) {
    return true;
  }

  return str.trim() === "";
};

export const uppercaseFirstLetter = (str: string) => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};
