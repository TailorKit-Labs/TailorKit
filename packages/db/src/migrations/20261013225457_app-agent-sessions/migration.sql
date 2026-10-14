CREATE TABLE "app_agent_session" (
	"active_run_id" text,
	"app_id" uuid PRIMARY KEY,
	"lease_expires_at" timestamp,
	"resume_state" text,
	"sandbox_name" text
);
--> statement-breakpoint
ALTER TABLE "app_agent_session" ADD CONSTRAINT "app_agent_session_app_id_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "app"("id") ON DELETE CASCADE;