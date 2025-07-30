export default /*sql*/ `
---
ALTER TABLE session ADD COLUMN has_been_coached TEXT NOT NULL DEFAULT 'false';
---
`;
