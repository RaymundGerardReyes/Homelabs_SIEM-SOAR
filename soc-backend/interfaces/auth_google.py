import os
import logging
import socket
import requests
import secrets
import jwt
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import RedirectResponse
import asyncpg
from Infrastructure.Http.Deps import get_db
from Infrastructure.Database.repositories import UserRepository

logger = logging.getLogger(__name__)

# Force IPv4 socket resolution globally for outbound requests in this module.
# This prevents Docker DNS IPv6 dropouts and "RemoteDisconnected" connection resets.
try:
    import urllib3.util.connection as urllib3_cn
    urllib3_cn.allowed_gai_family = lambda: socket.AF_INET
except Exception:
    pass

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "")
AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USER_INFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

router = APIRouter()

def get_oauth_credentials(request: Request = None):
    """
    Dynamically resolve Google OAuth credentials from environment variables.
    Provides automated fallback for local / proxy redirect URIs and guards
    against un-decrypted dotenvx tokens or missing configurations.
    """
    client_id = os.environ.get("GOOGLE_CLIENT_ID") or GOOGLE_CLIENT_ID
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET") or GOOGLE_CLIENT_SECRET
    redirect_uri = os.environ.get("GOOGLE_REDIRECT_URI") or GOOGLE_REDIRECT_URI

    client_id = client_id.strip("\"' ") if client_id else ""
    client_secret = client_secret.strip("\"' ") if client_secret else ""
    redirect_uri = redirect_uri.strip("\"' ") if redirect_uri else ""

    if not redirect_uri:
        if request:
            proto = request.headers.get("x-forwarded-proto") or request.url.scheme
            host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
            redirect_uri = f"{proto}://{host}/api/auth/google/callback"
        else:
            redirect_uri = "http://localhost:81/api/auth/google/callback"

    return client_id, client_secret, redirect_uri

def generate_secure_random_string():
    return secrets.token_urlsafe(32)

@router.get("/login")
async def login_google(request: Request, redirect: str = "/", db: asyncpg.Connection = Depends(get_db)):
    client_id, _, redirect_uri = get_oauth_credentials(request)

    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google OAuth Client ID is not configured. Please set GOOGLE_CLIENT_ID in deploy/.env."
        )
    if client_id.startswith("encrypted:"):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google OAuth Client ID is encrypted. Please launch containers with 'dotenvx run --' to decrypt."
        )

    raw_state = generate_secure_random_string()
    state_token = f"{raw_state}::{redirect}"
    
    repo = UserRepository(db)
    await repo.create_oauth_state(state_token)
    
    scope = "openid email profile"
    url = f"{AUTHORIZATION_URL}?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}&scope={scope}&access_type=offline&state={state_token}"
    return RedirectResponse(url)

@router.get("/callback")
async def auth_google_callback(request: Request, code: str, state: str, db: asyncpg.Connection = Depends(get_db)):
    repo = UserRepository(db)
    valid_state = await repo.verify_oauth_state(state)
    
    if not valid_state:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Anti-forgery token verification failed.")

    client_id, client_secret, redirect_uri = get_oauth_credentials(request)

    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google OAuth Client ID is not configured. Please set GOOGLE_CLIENT_ID in deploy/.env."
        )
    if not client_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google OAuth Client Secret is not configured. Please set GOOGLE_CLIENT_SECRET in deploy/.env."
        )

    token_data = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
    }
    
    post_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 SOC-Orchestrator/1.0",
        "Accept": "application/json",
        "Connection": "close"
    }
    try:
        token_r = requests.post(TOKEN_URL, data=token_data, headers=post_headers, timeout=15)
    except Exception as e:
        logger.error(f"Failed to communicate with Google Token API: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve token from Google: {e}")

    if token_r.status_code != 200:
        logger.error(f"Google Token API returned {token_r.status_code}: {token_r.text}")
        raise HTTPException(status_code=400, detail="Failed to retrieve token from Google.")
    
    tokens = token_r.json()
    access_token = tokens.get("access_token")
    
    try:
        get_headers = {
            "Authorization": f"Bearer {access_token}",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 SOC-Orchestrator/1.0",
            "Accept": "application/json",
            "Connection": "close"
        }
        user_info_r = requests.get(USER_INFO_URL, headers=get_headers, timeout=15)
    except Exception as e:
        logger.error(f"Failed to communicate with Google UserInfo API: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch user data: {e}")

    if user_info_r.status_code != 200:
        logger.error(f"Google UserInfo API returned {user_info_r.status_code}: {user_info_r.text}")
        raise HTTPException(status_code=400, detail="Failed to fetch user data.")
    
    user_info = user_info_r.json()
    
    analyst_email = user_info.get("email", "")
    analyst_name = user_info.get("name", "Unknown User")
    analyst_picture = user_info.get("picture", "")
    
    authorized_emails_env = os.environ.get("AUTHORIZED_EMAILS", "")
    authorized_emails = [e.strip().lower() for e in authorized_emails_env.split(",") if e.strip()]
    
    if authorized_emails and analyst_email.lower() not in authorized_emails:
        authorized_domains_env = os.environ.get("AUTHORIZED_DOMAINS", "")
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
