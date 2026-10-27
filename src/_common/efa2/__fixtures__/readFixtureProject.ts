import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readEfa2ProjectFromZip } from "../efa2Project";

/**
 * Test project written by efa 2.5.3 itself through its own API (boats with
 * variants and versions, free names, open outings, damages…). Generator and
 * format notes: project files, rb-desktop-v2/efa-sample.
 */
export const readFixtureProject = () =>
  readEfa2ProjectFromZip(
    new Uint8Array(readFileSync(join(__dirname, "TestClub.efa2backup.zip")))
  );
