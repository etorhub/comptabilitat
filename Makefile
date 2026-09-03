COMPOSE_LOCAL := docker compose -f deploy/docker-compose.local.yml

.DEFAULT_GOAL := help

.PHONY: help
help: ## Mostra aquesta ajuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# --- Provar-ho en local amb Docker -----------------------------------------

.PHONY: up
up: ## Arrenca l'aplicacio a http://localhost:8080
	$(COMPOSE_LOCAL) up -d --build
	@echo "Esperant que l'aplicacio estigui a punt…"
	@until curl -fsS http://localhost:8080/salut >/dev/null 2>&1; do sleep 2; done
	@echo "Llest: http://localhost:8080"

.PHONY: demo
demo: ## Omple la base de dades amb moviments d'exemple
	$(COMPOSE_LOCAL) exec app bun run cli demo

.PHONY: usuari
usuari: ## Crea un usuari administrador (EMAIL=... PASSWORD=...)
	$(COMPOSE_LOCAL) exec app bun run cli crea-usuari \
		--email "$(EMAIL)" --password "$(PASSWORD)" --admin

.PHONY: logs
logs: ## Segueix els registres de l'aplicacio
	$(COMPOSE_LOCAL) logs -f app

.PHONY: shell
shell: ## Obre una consola de PostgreSQL
	$(COMPOSE_LOCAL) exec db psql -U comptabilitat -d comptabilitat

.PHONY: down
down: ## Atura l'aplicacio i conserva les dades
	$(COMPOSE_LOCAL) down

.PHONY: clean
clean: ## Atura l'aplicacio i ESBORRA les dades
	$(COMPOSE_LOCAL) down -v

# --- Desenvolupament --------------------------------------------------------

.PHONY: install
install: ## Instal·la les dependencies
	bun install

.PHONY: dev
dev: ## Servidor de desenvolupament amb recarrega (cal un PostgreSQL accessible)
	bun run dev

.PHONY: test
test: ## Passa les proves (cal un PostgreSQL accessible)
	bun test

.PHONY: typecheck
typecheck: ## Comprova els tipus, en mode estricte
	bun run typecheck

.PHONY: css
css: ## Compila el full d'estil a public/app.css
	bun run css

# --- Base de dades ----------------------------------------------------------

.PHONY: migracions
migracions: ## Genera una migracio a partir dels canvis a src/db/schema/
	bun run db:generate

.PHONY: migra
migra: ## Aplica les migracions pendents
	bun run db:migrate

.PHONY: comprova-esquema
comprova-esquema: ## Compara src/db/schema/ amb la base de dades viva
	bun run db:pull
