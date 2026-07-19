.PHONY: help deploy-prod deploy-dev teardown logs scale

help:
	@echo "=========================================================="
	@echo "Hybrid SIEM/SOAR Ops Makefile"
	@echo "=========================================================="
	@echo "Commands:"
	@echo "  deploy-prod    : Build and deploy the production cluster (scaled)"
	@echo "  deploy-dev     : Boot the local hot-reload environment"
	@echo "  teardown       : Destroy the cluster and retain volumes"
	@echo "  logs           : Follow cluster logs"
	@echo "  scale          : Scale FastAPI workers (e.g., make scale WORKERS=5)"

deploy-prod:
	cd ../deploy && docker compose up --build -d
	@echo "✅ Production cluster deployed."

deploy-dev:
	cd ../deploy && docker compose -f docker-compose.dev.yml up --build
	
teardown:
	cd ../deploy && docker compose down
	@echo "✅ Cluster destroyed."

logs:
	cd ../deploy && docker compose logs -f

scale:
	cd ../deploy && docker compose up -d --scale soc-backend=$(WORKERS)
	@echo "✅ Scaled soc-backend to $(WORKERS) replicas."
