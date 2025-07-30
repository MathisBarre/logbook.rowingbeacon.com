export default /*sql*/ `
---
ALTER TABLE session DROP COLUMN has_been_coached;
ALTER TABLE session ADD COLUMN has_been_coached TEXT DEFAULT null;
---
`;
