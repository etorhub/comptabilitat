"""Contrasenyes i testimonis de sessio."""

from __future__ import annotations

import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

# Parametres moderats: el NAS es un N100 i el login ha de ser agil.
_hasher = PasswordHasher(time_cost=2, memory_cost=64 * 1024, parallelism=2)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError, ValueError):
        return False


def needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except (InvalidHashError, ValueError):
        return True


def generate_session_token() -> str:
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    """A la base de dades nomes hi desem el hash del testimoni."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
