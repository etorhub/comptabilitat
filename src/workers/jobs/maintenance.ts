/**
 * Maintenance.
 *
 * The three things that, if nobody does them, keep growing, stay stuck for
 * ever, or end up wrong: the Python application never deleted expired sessions
 * and the table grew without end; an import killed midway leaves the
 * connections page polling; and a few merchants end up badly normalised (an
 * accidental fee, an empty prefix).
 */

import { purgeExpiredSessions } from "../../lib/auth.ts";
import { closeStuckJobs } from "../../services/job-runs.ts";
import { reassignNormalization } from "../../services/merchants.ts";
import { closeStuckImports } from "../../services/sync.ts";

export async function maintenanceJob(): Promise<string> {
  // The Python application never deleted expired sessions and the table grew
  // without end.
  const deleted = await purgeExpiredSessions();

  // And an import that stopped halfway leaves the connections page polling
  // every two seconds for ever.
  const stuck = await closeStuckImports();
  const jobsStuck = await closeStuckJobs();
  const reassignment = await reassignNormalization();

  return (
    `${deleted} sessions caducades esborrades; ` +
    `${stuck} importacions penjades tancades; ` +
    `${jobsStuck} feines penjades tancades; ` +
    `normalitzacio: ${reassignment.changed} de ${reassignment.reviewed} moviments reassignats`
  );
}
