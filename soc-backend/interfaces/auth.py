from fastapi import APIRouter, Depends, HTTPException, status, Request, Response
import os
import logging
import jwt
from datetime import datetime, timedelta
import asyncpg
from Infrastructure.Http.DataTransferObject import LoginRequest, AuthResponse
from Infrastructure.Http.Deps import get_db
from Infrastructure.Database.repositories import UserRepository

logger = logging.getLogger(__name__)
router = APIRouter(tags=["auth"])

@router.post("/login", response_model=AuthResponse)
async def login(credentials: LoginRequest, response: Response, db: asyncpg.Connection = Depends(get_db)):
    repo = UserRepository(db)
    
    try:
        user_record = await repo.get_user_by_username(credentials.username)
    except Exception as e:
        logger.error(f"Postgres Query Error: {e}")
        raise HTTPException(status_code=500, detail="Internal State Error")
    
    if not user_record:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    if credentials.password != user_record.password_hash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    private_key_str = os.environ.get("JWT_PRIVATE_KEY")
    if not private_key_str:
        logger.error("JWT_PRIVATE_KEY environment variable is not set!")
        raise HTTPException(status_code=500, detail="Internal Server Error")
        
    private_key_str = private_key_str.strip("\"'").replace("\\n", "\n")
    
    expire_minutes = int(os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", 60))
    expiration = datetime.utcnow() + timedelta(minutes=expire_minutes)
    
    claims = {
        "sub": user_record.username,
        "iss": "soc-backend-identity",
        "role": user_record.role,
        "exp": expiration
    }
    
    try:
        token = jwt.encode(claims, private_key_str, algorithm="RS256")
    except Exception as e:
        logger.error(f"Failed to cryptographically sign JWT using RS256: {e}")
        raise HTTPException(status_code=500, detail="Internal State Error")
    
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=expire_minutes * 60
    )
    
    return AuthResponse(access_token=token, token_type="bearer")

@router.get("/session")
async def get_session(request: Request):
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
            
    if not token:
        raise HTTPException(status_code=401, detail="No active session")
        
    return {"user": {"email": "analyst@soc.internal", "role": "agent_orchestrator"}}

@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("access_token")
    return {"status": "success"}
