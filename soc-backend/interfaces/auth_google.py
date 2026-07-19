import os
import requests
import secrets
import jwt
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
import asyncpg
from infra.http.deps import get_db
from infra.db.repositories import UserRepository

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "your-google-client-id")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "your-google-client-secret")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "https://yourdomain.com/api/auth/google/callback")
AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USER_INFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

router = APIRouter()

def generate_secure_random_string():
    return secrets.token_urlsafe(32)

@router.get("/login")
async def login_google(redirect: str = "/", db: asyncpg.Connection = Depends(get_db)):
    raw_state = generate_secure_random_string()
    state_token = f"{raw_state}::{redirect}"
    
    repo = UserRepository(db)
    await repo.create_oauth_state(state_token)
    
    scope = "openid email profile"
    url = f"{AUTHORIZATION_URL}?response_type=code&client_id={GOOGLE_CLIENT_ID}&redirect_uri={GOOGLE_REDIRECT_URI}&scope={scope}&access_type=offline&state={state_token}"
    return RedirectResponse(url)

@router.get("/callback")
async def auth_google_callback(code: str, state: str, db: asyncpg.Connection = Depends(get_db)):
    repo = UserRepository(db)
    valid_state = await repo.verify_oauth_state(state)
    
    if not valid_state:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Anti-forgery token verification failed.")

    token_data = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": GOOGLE_REDIRECT_URI,
    }
    
    token_r = requests.post(TOKEN_URL, data=token_data)
    if token_r.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to retrieve token from Google.")
    
    tokens = token_r.json()
    access_token = tokens.get("access_token")
    
    headers = {"Authorization": f"Bearer {access_token}"}
    user_info_r = requests.get(USER_INFO_URL, headers=headers)
    if user_info_r.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to fetch user data.")
    
    user_info = user_info_r.json()
    
    analyst_email = user_info.get("email", "")
    analyst_name = user_info.get("name", "Unknown User")
    analyst_picture = user_info.get("picture", "")
    
    authorized_emails_env = os.environ.get("AUTHORIZED_EMAILS", "")
    authorized_emails = [e.strip().lower() for e in authorized_emails_env.split(",") if e.strip()]
    
    if authorized_emails and analyst_email.lower() not in authorized_emails:
        authorized_domains_env = os.environ.get("AUTHORIZED_DOMAINS", "yourcompany.com")
        authorized_domains = [d.strip().lower() for d in authorized_domains_env.split(",") if d.strip()]
        domain_match = any(analyst_email.lower().endswith(f"@{d}") for d in authorized_domains)
        if not domain_match:
            raise HTTPException(status_code=403, detail="Unauthorized: Email address is not in the platform allowlist.")
        
    rbac_role = "agent_orchestrator" if analyst_email.lower() in authorized_emails else "tier_1_analyst"
    
    private_key_str = os.environ.get("JWT_PRIVATE_KEY")
    if not private_key_str:
        raise HTTPException(status_code=500, detail="JWT_PRIVATE_KEY is not configured for signing.")
        
    private_key_str = private_key_str.strip("\"'").replace("\\n", "\n")
    
    jwt_payload = {
        "iss": "soc-backend-identity",
        "sub": analyst_email,
        "role": rbac_role,
        "name": analyst_name,
        "picture": analyst_picture,
        "exp": datetime.utcnow() + timedelta(hours=8)
    }
    
    try:
        internal_token = jwt.encode(jwt_payload, private_key_str, algorithm="RS256")
    except Exception as e:
        raise HTTPException(status_code=500, detail="Cryptographic signing of OAuth token failed.")
    
    redirect_url = "/"
    if "::" in state:
        _, redirect_url = state.split("::", 1)
        
    response = RedirectResponse(url=redirect_url)
    response.set_cookie(
        key="access_token",
        value=internal_token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=8 * 60 * 60
    )
    return response
