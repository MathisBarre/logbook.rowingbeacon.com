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
