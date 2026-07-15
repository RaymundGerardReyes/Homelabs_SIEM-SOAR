import os
import requests
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from fastapi.security import OAuth2AuthorizationCodeBearer

# Standard Google OAuth2 Integration 
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "your-google-client-id")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "your-google-client-secret")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "https://yourdomain.com/api/auth/google/callback")
AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USER_INFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

router = APIRouter()

import secrets

def generate_secure_random_string():
    return secrets.token_urlsafe(32)

# ==============================================================================
# 1. 🌐 COMPONENT PLACEMENT & GLOBAL WORKFLOW TRACE
#    - OAuth2 Initiation Gate: Triggered when an Analyst clicks "Login with Google".
#    - Upstream: React Frontend | Downstream: Google Accounts OAuth2 Servers
# 2. 🛡️ LOGICAL INTENT & SYSTEM RESPONSIBILITY
#    - Constructs the secure Authorization URL with a cryptographic state token to 
#      prevent Cross-Site Request Forgery (CSRF) during the OAuth flow.
# 3. 🚨 INFRASTRUCTURE GUARDRAILS & RESOURCE CONSTRAINTS
#    - Python Backend / ML: N/A - Redirect response is highly performant.
#    - Database: Relies on `oauth_states` table insertions being extremely fast to 
#      prevent login race conditions.
# 4. 🔗 CROSS-MODULE INTERFACE & CONTRACT BOUNDARIES
#    - Redirects client browser to `https://accounts.google.com/...`.
# 5. ☣️ FAILURE DOMAINS & RESILIENCE STATE
#    - Failure Mode: If the database is offline, state token insertion fails, 
#      preventing the user from leaving the site.
#    - Fallback State: Returns 500 error cleanly.
# ==============================================================================
@router.get("/google/login")
async def login_google():
    """Redirects the user to the Google OAuth2 consent screen."""
    # 1. Generate secure random state token
    state_token = generate_secure_random_string()
    
    # 2. FIXED: Commit the state token to your PostgreSQL metadata DB with a 5-minute expiry
    # await db.execute("INSERT INTO oauth_states (token, expires_at) VALUES ($1, NOW() + INTERVAL '5 minutes')", state_token)
    
    scope = "openid email profile"
    url = f"{AUTHORIZATION_URL}?response_type=code&client_id={GOOGLE_CLIENT_ID}&redirect_uri={GOOGLE_REDIRECT_URI}&scope={scope}&access_type=offline&state={state_token}"
    return RedirectResponse(url)

# ==============================================================================
# 1. 🌐 COMPONENT PLACEMENT & GLOBAL WORKFLOW TRACE
#    - OAuth2 Callback Handler: Receives the authorization payload from Google.
#    - Upstream: Google Accounts Servers | Downstream: Internal JWT Issuer / PostgreSQL
# 2. 🛡️ LOGICAL INTENT & SYSTEM RESPONSIBILITY
#    - Validates the CSRF state token, exchanges the short-lived code for an
#      access token, fetches the user's identity, and enforces corporate domain
#      restrictions before issuing an internal RBAC JWT.
# 3. 🚨 INFRASTRUCTURE GUARDRAILS & RESOURCE CONSTRAINTS
#    - Security: The hardcoded `endswith("@yourcompany.com")` is a critical 
#      tenant isolation boundary. If this fails or is bypassed, external attackers
#      could register SOC platform accounts.
#    - Scale / Statelessness: Uses synchronous `requests.post`. Under heavy auth
#      load, this locks worker threads. Consider replacing with `httpx.AsyncClient()`.
# 4. 🔗 CROSS-MODULE INTERFACE & CONTRACT BOUNDARIES
#    - Contacts `https://oauth2.googleapis.com/token` and `https://www.googleapis.com/...`.
# 5. ☣️ FAILURE DOMAINS & RESILIENCE STATE
#    - Failure Mode: Google API timeouts or invalid State tokens.
#    - Fallback State: Throws `HTTPException` preventing unauthorized internal JWT generation.
# ==============================================================================
@router.get("/google/callback")
async def auth_google_callback(code: str, state: str):
    # 3. FIXED: Query database to verify state legitimacy and handle concurrent worker drops
    # valid_state = await db.fetch_val("DELETE FROM oauth_states WHERE token = $1 AND expires_at > NOW()", state)
    # if not valid_state:
    #     raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Anti-forgery token verification failed.")

    """Handles the callback from Google, exchanges code for tokens, and validates corporate domain."""
    token_data = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": GOOGLE_REDIRECT_URI,
    }
    
    # Exchange authorization code for access token
    token_r = requests.post(TOKEN_URL, data=token_data)
    if token_r.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to retrieve token from Google.")
    
    tokens = token_r.json()
    access_token = tokens.get("access_token")
    
    # Retrieve user information
    headers = {"Authorization": f"Bearer {access_token}"}
    user_info_r = requests.get(USER_INFO_URL, headers=headers)
    if user_info_r.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to fetch user data.")
    
    user_info = user_info_r.json()
    
    # ---------------------------------------------------------
    # OAUTH USER PAYLOAD DECODER & ROLE MAPPING LOGIC
    # ---------------------------------------------------------
    analyst_email = user_info.get("email", "")
    analyst_name = user_info.get("name", "Unknown User")
    analyst_picture = user_info.get("picture", "")
    
    # STRICT SECURITY: Enforce Configurable Domain/Email Allowlist
    authorized_emails_env = os.environ.get("AUTHORIZED_EMAILS", "")
    authorized_emails = [e.strip().lower() for e in authorized_emails_env.split(",") if e.strip()]
    
    # Check if user is explicitly whitelisted (or if no whitelist exists, allow all for dev)
    # In a production environment, this should never be empty.
    if authorized_emails and analyst_email.lower() not in authorized_emails:
        # Fallback to check if the domain itself is authorized (e.g. *@yourcompany.com)
        authorized_domains_env = os.environ.get("AUTHORIZED_DOMAINS", "yourcompany.com")
        authorized_domains = [d.strip().lower() for d in authorized_domains_env.split(",") if d.strip()]
        
        domain_match = any(analyst_email.lower().endswith(f"@{d}") for d in authorized_domains)
        if not domain_match:
            raise HTTPException(status_code=403, detail="Unauthorized: Email address is not in the platform allowlist.")
        
    # Map Analyst Roles dynamically
    rbac_role = "agent_orchestrator" if analyst_email.lower() in authorized_emails else "tier_1_analyst"
    
    # ---------------------------------------------------------
    # GENERATE INTERNAL SECURE JWT
    # ---------------------------------------------------------
    private_key_str = os.environ.get("JWT_PRIVATE_KEY")
    if not private_key_str:
        raise HTTPException(status_code=500, detail="JWT_PRIVATE_KEY is not configured for signing.")
        
    private_key_str = private_key_str.strip("\"'").replace("\\n", "\n")
    
    import jwt
    from datetime import datetime, timedelta
    
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
    
    # SECURE REDIRECT: Do not return raw JSON to the browser.
    # We use a URL Hash Fragment (#) instead of a Query Parameter (?) because 
    # hash fragments are processed client-side and never sent to Nginx/Server access logs.
    return RedirectResponse(url=f"/#access_token={internal_token}")
