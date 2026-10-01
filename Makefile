help:
	@echo "ℹ️  Usage: make <target>"

	@echo ""
	@echo "Commands:"
	@echo ""
	@echo "  - init-docker-dev: Initialize the development environment in a docker container"
	@echo "  - clean-docker-dev: Clean the development environment in a docker container"
	@echo "  - init-k8s-dev: Initialize the development environment in a k8s kind cluster"
	@echo "  - k8s-dev: Run the development environment in a k8s cluster pod"
	@echo "  - clean-k8s-dev: Clean the development environment in a k8s cluster"
	@echo ""

	@echo ""
	@echo "The following targets are meant to be run inside the docker container or kubernetes pod:"
	@echo ""
	@echo "  - unit-test: Run the unit tests"
	@echo "  - run: Run the cli"
	@echo "  - clean: Clean the project"
	@echo "  - build: Build the project"
	@echo ""

	@echo ""
	@echo "Develop in the docker-compose container:"
	@echo ""
	@echo "  - cli"
	@echo "  - catalog_common"
	@echo "  - cdk8s_renderer"
	@echo "  - features_preparer"
	@echo "  - terraform_provioner"
	@echo "  - importer"
	@echo ""

	@echo ""
	@echo "Develop in the k8s kind cluster:"
	@echo "  - operator"
	@echo "  - crs_analyzer"
	@echo ""

	@echo ""
	@echo "Operator PRE testing:"
	@echo "  - deploy-snapshot: Build+deploy an operator snapshot to a firestartr-pre org (wizard)"
	@echo ""

init-docker-dev:
	docker compose build 
	docker compose run --rm -ti firestartr scripts/docker-dev.sh

clean-docker-dev:
	docker compose down

init-k8s-dev:
	./scripts/kind.sh create

k8s-dev: 
	./scripts/k8s-dev.sh

clean-k8s-dev:
	./scripts/kind.sh delete-cluster

unit-test:
	 lerna run test --concurrency 1

clean:
	rm -rf packages/*/dist
	rm -rf packages/*/build
	rm -rf packages/*/dist_external
	find packages -name 'node_modules' -prune -o -type f -name '*.tsbuildinfo' -delete
	find packages -name 'node_modules' -prune -o -type f -name '*.tgz' -delete

clean-modules:
	find . -maxdepth 3 -type d -name 'node_modules' -prune -exec rm -rf {} +

lint-fix:
	npm run lint-fix --workspaces
lint:
	npm run lint --workspaces
launch-operator:
	tsx packages/operator/launch_local.ts
launch-crs-analyzer:
	tsx packages/crs_analyzer/launch_local.ts

launch-local-operator:
	bash scripts/local-operator.sh create

deploy-snapshot:
	bash packages/operator/tools/deploy-snapshot-on-pre.sh

build:
	npm run build --workspace packages/cli
export-claim-schemas:
	npm run export-schemas --workspace packages/cdk8s_renderer

