import os
import time
import asyncpg
import logging
import urllib.parse
from typing import Optional
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

_db_pool: Optional[asyncpg.Pool] = None

def get_database_password() -> str:
    secret_path = "/run/secrets/pg_db_password"
    if os.path.exists(secret_path):
        with open(secret_path, "r") as secret_file:
            return secret_file.read().strip()
    return os.environ.get("DB_PASSWORD", "postgres")

def get_db_url() -> str:
    db_url = os.environ.get("DATABASE_URL")
    if db_url and not db_url.startswith("encrypted:"):
        return db_url

    db_user = os.environ.get("DB_USER", "postgres")
    db_name = os.environ.get("DB_NAME", "soc")
    db_host = os.environ.get("DB_HOST", "postgres")
    db_port = os.environ.get("DB_PORT", "5432")
    db_pass = get_database_password()
    
    # Defensive fallbacks if environment holds un-decrypted dotenvx tokens
    if db_user.startswith("encrypted:"):
        db_user = "postgres"
    if db_name.startswith("encrypted:"):
        db_name = "soc"
    if db_host.startswith("encrypted:"):
        db_host = "postgres"
    if db_port.startswith("encrypted:") or not db_port.isdigit():
        db_port = "5432"
    if db_pass.startswith("encrypted:"):
        db_pass = "postgres"

    encoded_pass = urllib.parse.quote_plus(db_pass)
    return f"postgresql://{db_user}:{encoded_pass}@{db_host}:{db_port}/{db_name}"

async def init_db_pool() -> asyncpg.Pool:
    global _db_pool
    if _db_pool is None:
        conn_url = get_db_url()
        try:
            _db_pool = await asyncpg.create_pool(
                conn_url,
                min_size=5,
                max_size=30,
                command_timeout=15.0,
                max_inactive_connection_lifetime=300.0
            )
            logger.info("✅ [PostgreSQL] Connection pool initialized (min_size=5, max_size=30).")
        except Exception as e:
            logger.error(f"❌ [PostgreSQL] Failed to initialize connection pool: {e}")
            raise
    return _db_pool

async def close_db_pool():
    global _db_pool
    if _db_pool is not None:
        await _db_pool.close()
        _db_pool = None
        logger.info("🛑 [PostgreSQL] Connection pool closed.")

async def get_db():
    global _db_pool
    if _db_pool is None:
        try:
            await init_db_pool()
        except Exception:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database pool unavailable")

    start_time = time.time()
    try:
        conn = await _db_pool.acquire()
    except Exception as e:
        logger.error(f"Failed to acquire DB connection from pool: {e}")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database unavailable")
        
    acquire_duration = (time.time() - start_time) * 1000
    if acquire_duration > 500:
        logger.warning(f"⚠️ [DB Pool Warning] Connection acquisition took {acquire_duration:.2f}ms (>500ms threshold!)")
        
    try:
        yield conn
    finally:
        await _db_pool.release(conn)
