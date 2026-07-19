import os
import asyncpg
import logging
import urllib.parse
import logging
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

def get_database_password() -> str:
    secret_path = "/run/secrets/pg_db_password"
    if os.path.exists(secret_path):
        with open(secret_path, "r") as secret_file:
            return secret_file.read().strip()
    return os.environ.get("DB_PASSWORD", "postgres")

async def get_db():
    db_user = os.environ.get("DB_USER", "postgres")
    db_name = os.environ.get("DB_NAME", "soc")
    db_host = os.environ.get("DB_HOST", "postgres")
    db_port = os.environ.get("DB_PORT", "5432")
    db_pass = get_database_password()
    
    encoded_pass = urllib.parse.quote_plus(db_pass)
    conn_url = f"postgresql://{db_user}:{encoded_pass}@{db_host}:{db_port}/{db_name}"
    try:
        conn = await asyncpg.connect(conn_url)
    except Exception as e:
        logger.error(f"Failed to connect to SOAR PostgreSQL state: {e}")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database unavailable")
        
    try:
        yield conn
    finally:
        await conn.close()
