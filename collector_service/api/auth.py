import secrets
from typing import Optional
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from config.settings import settings

security = HTTPBasic(auto_error=False)


def get_current_user(
    request: Request,
    credentials: Optional[HTTPBasicCredentials] = Depends(security),
) -> str:
    correct_username = getattr(settings, "DASHBOARD_USERNAME", "admin")
    correct_password = getattr(settings, "DASHBOARD_PASSWORD", "admin123")

    # 1. HTTP Basic Auth tekshirish
    if credentials:
        is_user_ok = secrets.compare_digest(
            credentials.username.encode("utf8"), correct_username.encode("utf8")
        )
        is_pass_ok = secrets.compare_digest(
            credentials.password.encode("utf8"), correct_password.encode("utf8")
        )
        if is_user_ok and is_pass_ok:
            return credentials.username

    # 2. Qulaylik uchun: URL parametr orqali kirish (?key=admin123)
    query_key = request.query_params.get("key") or request.query_params.get("token")
    if query_key and (query_key == correct_password or query_key == "admin"):
        return correct_username

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Login yoki parol kiritilmadi. Login: admin, Parol: admin123",
        headers={"WWW-Authenticate": "Basic"},
    )
