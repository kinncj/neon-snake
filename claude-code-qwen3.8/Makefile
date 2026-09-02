# Neo-Retro Snake — build & gate targets.
# ci = lint + typecheck + unit + build + e2e. The build log lives at docs/build-log.tsv.
SHELL := /bin/bash
.DEFAULT_GOAL := help
NODE  ?= node
NPM   ?= npm
NPX   ?= npx

.PHONY: help bootstrap install lint typecheck test test-e2e bench build preview ci log-start log-end timeline clean

help:
	@echo "snake-app targets:"
	@echo "  bootstrap   npm ci (clean install from lockfile)"
	@echo "  install     npm install"
	@echo "  lint        eslint + domain boundary check"
	@echo "  typecheck   tsc --noEmit"
	@echo "  test        vitest (unit)"
	@echo "  test-e2e    playwright (chromium + firefox)"
	@echo "  bench       perf budget benchmark"
	@echo "  build       vite build -> dist/"
	@echo "  preview     vite preview (serve dist/)"
	@echo "  ci          lint + typecheck + test + build + test-e2e"
	@echo "  log-start   make log-start STEP=nn"
	@echo "  log-end     make log-end STEP=nn"
	@echo "  timeline    docs/build-log.tsv -> docs/build-log.md"
	@echo "  clean       rm -rf dist test-results coverage"

bootstrap:
	$(NPM) ci

install:
	$(NPM) install

lint:
	$(NPX) eslint .
	$(NODE) scripts/domain-boundary.mjs

typecheck:
	$(NPX) tsc --noEmit

test:
	$(NPX) vitest run

test-e2e:
	$(NPX) playwright test

bench:
	$(NODE) scripts/bench.mjs

build:
	$(NPX) vite build

preview:
	$(NPX) vite preview

ci: lint typecheck test build test-e2e
	@echo "CI GREEN"

log-start:
	@test -n "$(STEP)" || (echo "usage: make log-start STEP=nn" && exit 1)
	$(NODE) scripts/buildlog.mjs start "$(STEP)"

log-end:
	@test -n "$(STEP)" || (echo "usage: make log-end STEP=nn" && exit 1)
	$(NODE) scripts/buildlog.mjs end "$(STEP)"

timeline:
	$(NODE) scripts/buildlog.mjs timeline

clean:
	rm -rf dist test-results coverage
