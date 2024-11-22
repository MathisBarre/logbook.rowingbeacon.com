export default /*sql*/ `
---
CREATE TABLE IF NOT EXISTS migration (
  timestamp INTEGER PRIMARY KEY,
  appliedAt TEXT DEFAULT CURRENT_TIMESTAMP
);
---
`;
