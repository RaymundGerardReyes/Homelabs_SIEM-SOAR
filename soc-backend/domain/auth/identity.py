from dataclasses import dataclass
from typing import Optional
from datetime import datetime

@dataclass
class User:
    id: str
    username: str
    password_hash: str
    role: str
    email: Optional[str] = None
    picture: Optional[str] = None

@dataclass
class SessionToken:
    sub: str
    role: str
    iss: str
    exp: datetime
    name: Optional[str] = None
    picture: Optional[str] = None
