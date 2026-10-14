CREATE TABLE "eval_case_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"case_revision_id" uuid NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"expected" integer NOT NULL,
	"got" integer,
	"error" text,
	"cost_usd" double precision,
	"findings_returned" integer,
	"findings_grounded" integer,
	"findings_matching" integer
);
--> statement-breakpoint
CREATE TABLE "skill_eval_agents" (
	"skill_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid,
	"agent_name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_suite_runs" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_case_revisions" ADD COLUMN "expected_output" jsonb;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "skill_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_suite_runs" ADD COLUMN "skill_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_suite_runs" ADD COLUMN "skill_version" integer;--> statement-breakpoint
ALTER TABLE "eval_suite_runs" ADD COLUMN "via_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_suite_runs" ADD COLUMN "agent_name" text;--> statement-breakpoint
ALTER TABLE "eval_case_checks" ADD CONSTRAINT "eval_case_checks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_case_checks" ADD CONSTRAINT "eval_case_checks_case_id_eval_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eval_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_case_checks" ADD CONSTRAINT "eval_case_checks_case_revision_id_eval_case_revisions_id_fk" FOREIGN KEY ("case_revision_id") REFERENCES "public"."eval_case_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_eval_agents" ADD CONSTRAINT "skill_eval_agents_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_eval_agents" ADD CONSTRAINT "skill_eval_agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_eval_agents" ADD CONSTRAINT "skill_eval_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_case_checks_revision_uq" ON "eval_case_checks" USING btree ("case_revision_id");--> statement-breakpoint
CREATE INDEX "eval_case_checks_case_idx" ON "eval_case_checks" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_case_checks_one_running_uq" ON "eval_case_checks" USING btree ("case_id") WHERE status = 'running';--> statement-breakpoint
CREATE INDEX "eval_case_checks_ws_idx" ON "eval_case_checks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "skill_eval_agents_agent_idx" ON "skill_eval_agents" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "skill_eval_agents_ws_idx" ON "skill_eval_agents" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suite_runs" ADD CONSTRAINT "eval_suite_runs_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suite_runs" ADD CONSTRAINT "eval_suite_runs_via_agent_id_agents_id_fk" FOREIGN KEY ("via_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_cases_ws_skill_idx" ON "eval_cases" USING btree ("workspace_id","skill_id");--> statement-breakpoint
CREATE INDEX "eval_suite_runs_skill_started_idx" ON "eval_suite_runs" USING btree ("skill_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_suite_runs_one_running_skill_uq" ON "eval_suite_runs" USING btree ("skill_id") WHERE status = 'running';--> statement-breakpoint
CREATE INDEX "eval_suite_runs_via_agent_idx" ON "eval_suite_runs" USING btree ("via_agent_id");