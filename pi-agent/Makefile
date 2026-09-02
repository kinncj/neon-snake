LOG := docs/build-log.tsv

bootstrap: ; npm ci
lint:      ; npx eslint .
typecheck: ; npx tsc --noEmit
test:      ; npx vitest run
test-e2e:  ; npx playwright test
bench:     ; npx vitest run tests/perf
# NODE_ENV=production is explicit: Vite folds import.meta.env.DEV from the
# parent env, and the test toolchain (vitest) sets NODE_ENV=test, which
# would otherwise leak the dev-only stats.js chunk into the production
# bundle. See tests/unit/budget.test.ts for the guard that catches this.
build:     ; SNAKE_BUILD=$(shell git rev-parse --short HEAD 2>/dev/null || echo nogit)-$(shell date -u +%H%M) NODE_ENV=production npx vite build
preview:   ; npx vite preview --host 0.0.0.0 --port 4174
ci: bootstrap lint typecheck test build test-e2e

log-start:
	@mkdir -p docs
	@printf '%s\tSTART\t%s\n' "$$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(STEP)" >> $(LOG)
	@printf 'step %s started at %s\n' "$(STEP)" "$$(date -Is)"

log-end:
	@printf '%s\tEND\t%s\n' "$$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(STEP)" >> $(LOG)
	@printf 'step %s ended at %s\n' "$(STEP)" "$$(date -Is)"

timeline:
	@node scripts/timeline.mjs $(LOG) > docs/build-log.md
	@cat docs/build-log.md
