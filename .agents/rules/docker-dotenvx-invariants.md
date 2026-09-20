# Docker & Dotenvx Runtime Invariants

## 1. Always Use `dotenvx run` for Docker Operations
- Never run raw `docker compose up` when `.env` contains `encrypted:...` secrets.
- Always execute with `dotenvx run -- docker compose up -d` or `dotenvx run -f <file> -- docker compose ...` so container healthchecks and application runtimes receive plaintext secrets.

## 2. Never Export `DOCKER_HOST` in Root `.env`
- Keep `DOCKER_HOST` commented out in local `.env` and `.env.dev` files to prevent overriding the host Docker Desktop named pipe connection (`//./pipe/docker_engine`).

## 3. Explicit Environment Mappings & Healthcheck Escaping in `docker-compose.yml`
- Always map sensitive variables explicitly in `environment:` blocks (e.g., `POSTGRES_USER: ${DB_USER}`, `CLICKHOUSE_USER: ${CLICKHOUSE_USER}`) rather than relying on raw `env_file: .env` passing, ensuring Docker Compose substitutes the runtime decrypted values into containers.
## 4. Windows PowerShell CLI Argument Passing
- PowerShell interprets `--` differently than Unix shells. When passing flags to `docker compose` through `dotenvx run` on Windows, wrap the command in `cmd /c "dotenvx run -- docker compose ..."` or use Git Bash to prevent PowerShell from consuming the separator.

## 5. Force Recreate Containers After Secret Decryption Fixes
- Services like ClickHouse generate XML configuration files (`/etc/clickhouse-server/users.d/default-user.xml`) on first boot based on container environment variables. If initial creation occurred with encrypted tokens (e.g. `encrypted:...`), the invalid XML syntax persists inside the container layer and causes `SAXParseException` loops upon restart.
- Always use `--force-recreate` when transitioning an existing stack to decrypted secrets so fresh container layers are initialized with valid syntax.


