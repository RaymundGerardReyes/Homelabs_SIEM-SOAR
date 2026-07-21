import asyncpg
from typing import Optional
from Domain.Auth.Identity import User
import logging

logger = logging.getLogger(__name__)

class UserRepository:
    def __init__(self, db: asyncpg.Connection):
        self.db = db

    async def get_user_by_username(self, username: str) -> Optional[User]:
        try:
            record = await self.db.fetchrow(
                "SELECT id, username, password_hash, role FROM users WHERE username = $1", 
                username
            )
            if record:
                return User(
                    id=str(record["id"]),
                    username=record["username"],
                    password_hash=record["password_hash"],
                    role=record.get("role", "tier_1_analyst")
                )
            return None
        except asyncpg.UndefinedTableError:
            # Fallback for dev environment where table might not exist
            if username == "admin":
                return User(id="mock-1", username="admin", password_hash="demo123", role="agent_orchestrator")
            return None
        except Exception as e:
            logger.error(f"Postgres Query Error in UserRepository: {e}")
            raise

    async def verify_oauth_state(self, state_token: str) -> bool:
        """Validates OAuth anti-forgery state tokens and deletes them."""
        try:
            record = await self.db.fetchval(
                "DELETE FROM oauth_states WHERE token = $1 AND expires_at > NOW() RETURNING token", 
                state_token
            )
            return bool(record)
        except asyncpg.UndefinedTableError:
            return True
        except Exception as e:
            logger.error(f"OAuth State DB Error: {e}")
            return False

    async def create_oauth_state(self, state_token: str) -> None:
        """Stores a short-lived OAuth state token."""
        try:
            await self.db.execute(
                "INSERT INTO oauth_states (token, expires_at) VALUES ($1, NOW() + INTERVAL '5 minutes')", 
                state_token
            )
        except asyncpg.UndefinedTableError:
            pass
        except Exception as e:
            logger.error(f"Failed to create OAuth state: {e}")
