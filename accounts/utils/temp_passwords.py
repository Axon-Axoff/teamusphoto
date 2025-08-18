import secrets
import string
from django.utils import timezone
from django.contrib.auth.hashers import make_password

_ALPHABET = string.ascii_letters + string.digits


def generate_temp_password(length: int = 10) -> str:
    return ''.join(secrets.choice(_ALPHABET) for _ in range(length))


def set_temp_password_for_user(user, temp_plaintext: str | None = None) -> str:
    """
    Sets a new temporary password for the user:
      - hashes it into user.tmp_pwd
      - sets created_at to now
      - resets attempts to 0
    Returns the plaintext so the caller (admin) can communicate it to the user.
    """
    temp_plaintext = temp_plaintext or generate_temp_password()
    user.tmp_pwd = make_password(temp_plaintext)
    user.tmp_pwd_created_at = timezone.now()
    user.tmp_pwd_attempts = 0
    user.save(update_fields=["tmp_pwd", "tmp_pwd_created_at", "tmp_pwd_attempts"])
    return temp_plaintext
