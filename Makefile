COMPOSE_LOCAL := docker compose -f deploy/docker-compose.local.yml

# Fa servir l'entorn virtual del projecte si existeix, i si no el python del sistema.
PY := $(if $(wildcard .venv/bin/python),$(CURDIR)/.venv/bin/python,python3)

.DEFAULT_GOAL := help

.PHONY: help
help: ## Mostra aquesta ajuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# --- Provar-ho en local amb Docker -----------------------------------------

.PHONY: up
up: ## Arrenca l'aplicacio a http://localhost:8080
	$(COMPOSE_LOCAL) up -d --build
	@echo "Esperant que l'API estigui a punt…"
	@until curl -fsS http://localhost:8000/api/health >/dev/null 2>&1; do sleep 2; done
	@echo "Llest: http://localhost:8080"

.PHONY: demo
demo: ## Omple la base de dades amb moviments d'exemple
	$(COMPOSE_LOCAL) exec api python -m app.cli demo

.PHONY: usuari
usuari: ## Crea un usuari administrador (EMAIL=... PASSWORD=...)
	$(COMPOSE_LOCAL) exec api python -m app.cli create-user \
		--email "$(EMAIL)" --password "$(PASSWORD)" --admin

.PHONY: logs
logs: ## Segueix els registres de l'API
	$(COMPOSE_LOCAL) logs -f api

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

.PHONY: test
test: ## Passa les proves del backend (cal un PostgreSQL accessible)
	cd backend && $(PY) -m pytest

.PHONY: lint
lint: ## Comprova l'estil del backend
	cd backend && $(PY) -m ruff check . && $(PY) -m ruff format --check .

.PHONY: build-frontend
build-frontend: ## Compila la interficie
	cd frontend && npm run build
