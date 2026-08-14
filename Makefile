.PHONY: install setup lint format format-check typecheck test test-live bootstrap check smoke dev deploy

install:
	npm install

bootstrap:
	bash scripts/bootstrap_env.sh

setup: install bootstrap
	@echo ""
	@echo "Next:"
	@echo "  1. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in .env"
	@echo "  2. make dev               NestJS on :8081"
	@echo "  3. In deal-truth/.env set ML_SERVICE_BASE_URL=http://localhost:8081"
	@echo "  4. Restart deal-truth api + worker"

lint:
	npm run lint

format:
	npm run format

format-check:
	npm run format:check

typecheck:
	npm run typecheck

test:
	npm test

test-live:
	npm run test:live

check:
	bash scripts/check_ready.sh http://127.0.0.1:8081 5

smoke: check
	curl -fsS -X POST http://127.0.0.1:8081/classify \
	  -H "Content-Type: application/json" \
	  -d '{"texts":["We cannot buy until security approves it."]}'
	@echo

dev: bootstrap
	npm run dev

deploy:
	@echo "Build: npm ci && npm run build"
	@echo "Start: npm run start:prod"
	@echo "Set CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, INTERNAL_API_TOKEN on the host."
