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
import { config } from "../../lib/config.ts";
import { failStuckReports, pruneDailyReports } from "../../services/ai-reports.ts";
import { failStuckMessages } from "../../services/chat.ts";
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
  // A chat answer is at most one model call: twice its timeout is long past lost.
  const answersStuck = await failStuckMessages(config.ollamaChatTimeoutSeconds * 2);
  const reportsStuck = await failStuckReports();
  const briefsDeleted = await pruneDailyReports();
  const reassignment = await reassignNormalization();

  return (
    `${deleted} sessions caducades esborrades; ` +
    `${stuck} importacions penjades tancades; ` +
    `${jobsStuck} feines penjades tancades; ` +
    `${answersStuck} respostes del xat penjades tancades; ` +
    `${reportsStuck} informes penjats tancats; ` +
    `${briefsDeleted} resums diaris antics esborrats; ` +
    `normalitzacio: ${reassignment.changed} de ${reassignment.reviewed} moviments reassignats`
  );
}
