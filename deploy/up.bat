@echo off
REM ==============================================================================
REM ZERO-TRUST STACK BOOTSTRAPPER (DOTENVX WRAPPER)
REM Automatically injects decrypted credentials into docker compose commands.
REM Usage:
REM   .\up.bat
REM   .\up.bat --build
REM   .\up.bat --force-recreate
REM ==============================================================================
echo [SOC-ORCHESTRATOR] Decrypting environment and launching container stack...
dotenvx run -- docker compose up -d %*

