# Harborlight — developer and packaging entry points.
#
# Every target is safe to run more than once. Nothing here touches Docker
# resources, and no target ever stops processes it did not start.

SHELL := /bin/bash
.SHELLFLAGS := -Eeuo pipefail -c
.DEFAULT_GOAL := help

NPM ?= npm
NODE_VERSION := $(shell cat .nvmrc 2>/dev/null || echo 20)

RUN_DIR := .harborlight
DEV_LOG := $(RUN_DIR)/dev.log

# `make install` knobs, so callers do not have to spell out INSTALL_ARGS.
INSTALL_ARGS ?=
AUTOSTART ?= 0
START_MINIMIZED ?= 0
LAUNCH ?= 0
YES ?= 0

install_flags := --source local
ifeq ($(AUTOSTART),1)
install_flags += --autostart
endif
ifeq ($(START_MINIMIZED),1)
install_flags += --start-minimized
endif
ifeq ($(LAUNCH),1)
install_flags += --launch
endif
ifeq ($(YES),1)
install_flags += --yes
endif

# `make dev MOCK=1` runs against the in-memory engine instead of Docker.
MOCK ?= 0

# `make publish VERSION=… CHANNEL=…`
VERSION ?=
CHANNEL ?= stable

.PHONY: help bootstrap dev stop logs doctor lint typecheck test test-watch test-e2e \
        build package package-dir icons install uninstall publish clean distclean check

help: ## Show this help
	@printf '\033[1mHarborlight\033[0m — container workflows, reimagined for Ubuntu\n\n'
	@printf '\033[1mUsage:\033[0m make <target> [VAR=value]\n\n'
	@printf '\033[1mTargets:\033[0m\n'
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@printf '\n\033[1mCommon variables:\033[0m\n'
	@printf '  MOCK=1                 Run the dev session against the mock engine\n'
	@printf '  AUTOSTART=1            Enable autostart during make install\n'
	@printf '  START_MINIMIZED=1      With AUTOSTART, start hidden in the tray\n'
	@printf '  LAUNCH=1               Launch Harborlight after installing\n'
	@printf '  YES=1                  Do not prompt during make install\n'
	@printf '  INSTALL_ARGS="…"       Extra flags passed straight to install.sh\n'
	@printf '  VERSION=0.1.0          Version for make publish\n'
	@printf '  CHANNEL=stable|beta    Channel for make publish\n'
	@printf '  PUBLISH_DRY_RUN=1      Assemble a release without uploading it\n\n'
	@printf '\033[1mExamples:\033[0m\n'
	@printf '  make dev MOCK=1\n'
	@printf '  make install INSTALL_ARGS="--autostart --start-minimized --launch"\n'
	@printf '  make publish VERSION=0.1.0 CHANNEL=stable PUBLISH_DRY_RUN=1\n\n'

bootstrap: ## Install Node dependencies and Playwright browsers
	@printf 'Node: %s (project pins %s)\n' "$$(node --version 2>/dev/null || echo 'not found')" "$(NODE_VERSION)"
	$(NPM) install
	@printf '\nReady. Start developing with: make dev\n'

dev: ## Start the development session (Vite + Electron)
	@scripts/dev.sh

stop: ## Stop the development session started by make dev
	@scripts/stop.sh

logs: ## Follow the development log
	@if [[ -f "$(DEV_LOG)" ]]; then \
		tail -n 200 -f "$(DEV_LOG)"; \
	else \
		printf 'No development log yet. Start one with: make dev\n'; \
	fi

doctor: ## Check the local environment (Docker, session, install)
	@./install.sh doctor

lint: ## Run ESLint
	$(NPM) run lint

typecheck: ## Type-check the main, renderer and e2e projects
	$(NPM) run typecheck

test: ## Run the unit and renderer test suites
	$(NPM) run test

test-watch: ## Run the test suites in watch mode
	$(NPM) run test:watch

test-e2e: build ## Run the Playwright Electron end-to-end suite
	$(NPM) run test:e2e

check: lint typecheck test ## Lint, type-check and test

build: ## Build the main, preload and renderer bundles
	$(NPM) run build

package: build ## Build the .deb and AppImage into dist/
	$(NPM) run package

package-dir: build ## Build an unpacked application directory (fast smoke test)
	$(NPM) run package:dir

icons: ## Regenerate the application and tray icons
	python3 scripts/generate-icons.py

install: package ## Install this checkout onto the system
	@./install.sh install $(install_flags) $(INSTALL_ARGS)

uninstall: ## Remove Harborlight, keeping user settings
	@./install.sh uninstall $(INSTALL_ARGS)

publish: ## Build, verify and publish a release (VERSION=… CHANNEL=…)
	@VERSION="$(VERSION)" CHANNEL="$(CHANNEL)" scripts/publish.sh

clean: ## Remove build output and test artifacts
	rm -rf out dist coverage playwright-report test-results $(RUN_DIR)
	rm -f tsconfig.*.tsbuildinfo

distclean: clean ## Also remove node_modules and the release directory
	rm -rf node_modules release .cache
