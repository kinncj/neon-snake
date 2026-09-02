LOG := docs/build-log.tsv

bootstrap: ; npm ci
lint:      ; npx eslint .
typecheck: ; npx tsc --noEmit
test:      ; npx vitest run
test-e2e:  ; npx playwright test
bench:     ; npx vitest run tests/perf
# NODE_ENV=production is explicit so a vitest-launched build (NODE_ENV=test)
# cannot fold import.meta.env.DEV into the production bundle.
build:     ; SNAKE_BUILD=$(shell git rev-parse --short HEAD 2>/dev/null || echo nogit)-$(shell date -u +%H%M) NODE_ENV=production npx vite build
preview:   ; npx vite preview --host 0.0.0.0 --port 4173
ci: bootstrap lint typecheck test build test-e2e

# Build log: the shell stamps the clock, never a human.
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

.PHONY: bootstrap lint typecheck test test-e2e bench build preview ci log-start log-end timeline
