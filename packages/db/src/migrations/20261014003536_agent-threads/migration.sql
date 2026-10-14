CREATE TABLE "app_agent_thread" (
	"app_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"invalidated_at" timestamp,
	"resume_state" text,
	"sandbox_name" text
);
--> statement-breakpoint
ALTER TABLE "app_agent_session" RENAME TO "app_agent_lease";--> statement-breakpoint
ALTER TABLE "app_agent_lease" RENAME COLUMN "sandbox_name" TO "cleanup_sandbox_name";--> statement-breakpoint
ALTER TABLE "app_agent_lease" ADD COLUMN "active_thread_id" uuid;--> statement-breakpoint
ALTER TABLE "app_agent_lease" DROP COLUMN "resume_state";--> statement-breakpoint
CREATE INDEX "app_agent_thread_app_id_idx" ON "app_agent_thread" ("app_id");--> statement-breakpoint
ALTER TABLE "app_agent_lease" ADD CONSTRAINT "app_agent_lease_active_thread_id_app_agent_thread_id_fkey" FOREIGN KEY ("active_thread_id") REFERENCES "app_agent_thread"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "app_agent_thread" ADD CONSTRAINT "app_agent_thread_app_id_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "app"("id") ON DELETE CASCADE;