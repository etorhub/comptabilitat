CREATE TABLE "chat_action_items" (
	"id" serial NOT NULL,
	"action_id" integer NOT NULL,
	"transaction_id" integer,
	"merchant_id" integer,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	CONSTRAINT "pk_chat_action_items" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "chat_actions" (
	"id" serial NOT NULL,
	"ledger_id" integer NOT NULL,
	"message_id" integer NOT NULL,
	"user_id" integer,
	"kind" varchar(32) NOT NULL,
	"params" jsonb NOT NULL,
	"status" varchar(32) NOT NULL,
	"applied_at" timestamp with time zone,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_chat_actions" PRIMARY KEY("id"),
	CONSTRAINT "uq_chat_actions_message_id" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "chat_conversations" (
	"id" serial NOT NULL,
	"ledger_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_chat_conversations" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" varchar(32) NOT NULL,
	"text" text NOT NULL,
	"status" varchar(32) NOT NULL,
	"intent" jsonb,
	"payload" jsonb,
	"model" varchar(80) NOT NULL,
	"prompt_version" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "pk_chat_messages" PRIMARY KEY("id")
);
--> statement-breakpoint
ALTER TABLE "chat_action_items" ADD CONSTRAINT "fk_chat_action_items_action_id_chat_actions" FOREIGN KEY ("action_id") REFERENCES "public"."chat_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_action_items" ADD CONSTRAINT "fk_chat_action_items_transaction_id_transactions" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_action_items" ADD CONSTRAINT "fk_chat_action_items_merchant_id_merchants" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_actions" ADD CONSTRAINT "fk_chat_actions_ledger_id_ledgers" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_actions" ADD CONSTRAINT "fk_chat_actions_message_id_chat_messages" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_actions" ADD CONSTRAINT "fk_chat_actions_user_id_users" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "fk_chat_conversations_ledger_id_ledgers" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "fk_chat_conversations_user_id_users" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "fk_chat_messages_conversation_id_chat_conversations" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_chat_action_items_action_id" ON "chat_action_items" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "ix_chat_actions_ledger_id" ON "chat_actions" USING btree ("ledger_id");--> statement-breakpoint
CREATE INDEX "ix_chat_conversations_ledger_user" ON "chat_conversations" USING btree ("ledger_id","user_id");--> statement-breakpoint
CREATE INDEX "ix_chat_messages_conversation_id" ON "chat_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "ix_chat_messages_status" ON "chat_messages" USING btree ("status");