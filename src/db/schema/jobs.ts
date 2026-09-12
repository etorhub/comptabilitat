/**
 * The run history of the scheduler's jobs.
 *
 * One row per invocation (cron, UI or CLI). Composite passes
 * (`passada-diaria`, and so on) create a parent row plus one per child step.
 */

import {
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  varchar,
} from "drizzle-orm/pg-core";

import { domainEnum, tz } from "./columns.ts";
import type { JobStatus, JobTrigger } from "./enums.ts";

/** No TimestampMixin: each attempt carries its own `started_at`, like `sync_runs`. */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: serial().notNull(),
    jobName: varchar("job_name", { length: 32 }).notNull(),
    trigger: domainEnum<JobTrigger>().notNull(),
    status: domainEnum<JobStatus>().notNull(),
    /** Null = a top-level run; otherwise, a step of a pass. */
    parentId: integer("parent_id"),
    startedAt: tz("started_at").notNull(),
    finishedAt: tz("finished_at"),
    summary: text().notNull(),
    error: text().notNull(),
  },
  (t) => [
    primaryKey({ name: "pk_job_runs", columns: [t.id] }),
    index("ix_job_runs_started_at").on(t.startedAt),
    index("ix_job_runs_job_name").on(t.jobName),
    index("ix_job_runs_status").on(t.status),
    index("ix_job_runs_parent_id").on(t.parentId),
    foreignKey({
      name: "fk_job_runs_parent_id_job_runs",
      columns: [t.parentId],
      foreignColumns: [t.id],
    }).onDelete("cascade"),
  ],
);

export type JobRun = typeof jobRuns.$inferSelect;
export type NewJobRun = typeof jobRuns.$inferInsert;
