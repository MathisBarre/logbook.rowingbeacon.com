export default /*sql*/ `
---
CREATE TABLE IF NOT EXISTS session_rowers (
  session_id TEXT NOT NULL, -- UUID of the session
  rower_id TEXT NOT NULL,  -- UUID of the rower
  PRIMARY KEY (session_id, rower_id), -- Composite primary key
  FOREIGN KEY (session_id) REFERENCES session (id) ON DELETE CASCADE
);
---
`;
