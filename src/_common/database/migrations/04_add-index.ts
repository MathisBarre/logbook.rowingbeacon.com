export default /*sql*/ `
---
CREATE INDEX IF NOT EXISTS idx_session_rowers_rower_id ON session_rowers (rower_id);
CREATE INDEX IF NOT EXISTS idx_session_rowers_session_id ON session_rowers (session_id);
---
`;
