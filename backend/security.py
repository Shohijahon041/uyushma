"""
=============================================================================
UYUSHMA GPS & FLEET SAAS - AES-256 SECURITY & CREDENTIALS ENCRYPTOR
=============================================================================
Tashqi davlat portallari (ijara.soliq.uz, transport.uz, etender.uz, E-OSAGO)
va to'lov shlyuzlari maxfiy kalitlarini (login, parol, tokenlar) bazada
ochiq saqlamaslik uchun AES-256-GCM (Authenticated Encryption) moduli.
=============================================================================
"""

import base64
import hashlib
import json
import logging
import os
from typing import Any, Dict, List, Optional, Union
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger("security")

# Asosiy shifrlash kaliti (32 bayt = 256 bit)
# Agar muhitda ENCRYPTION_SECRET_KEY yoki APP_ENCRYPTION_KEY berilmagan bo'lsa,
# standart xavfsizlik ogohlantirishi bilan fallback kalit ishlatiladi.
RAW_SECRET = (
    os.getenv("ENCRYPTION_SECRET_KEY")
    or os.getenv("APP_ENCRYPTION_KEY")
    or "uyushma-fleet-aes-256-gcm-master-key-prod-2026-secure"
)


def _derive_256bit_key(secret: str) -> bytes:
    """Ixtiyoriy uzunlikdagi maxfiy satrdan SHA-256 orqali aniq 32 bayt (256-bit) kalit hosil qilish."""
    return hashlib.sha256(secret.encode("utf-8")).digest()


class AES256Encryptor:
    """
    AES-256-GCM (Galois/Counter Mode) simmetrik shifrlash klassi.
    - 256-bitli xavfsiz kalit
    - Har bir shifrlash uchun 96-bit (12 bayt) yangi tasodifiy Nonce (IV)
    - Soxtalashtirishdan himoya qiluvchi 128-bit (16 bayt) Authentication Tag
    - URL-safe Base64 formatida qaytarish
    """

    def __init__(self, secret_key: Optional[str] = None):
        key_str = secret_key or RAW_SECRET
        self.key: bytes = _derive_256bit_key(key_str)
        self.aesgcm = AESGCM(self.key)

    def encrypt(self, plain_text: Optional[str], associated_data: Optional[str] = None) -> Optional[str]:
        """
        Matnni AES-256-GCM yordamida shifrlaydi.
        Qaytaradi: 'enc:v1:<base64(nonce + ciphertext + tag)>' yoki None.
        """
        if plain_text is None:
            return None
        if not plain_text:
            return ""

        nonce = os.urandom(12)  # 96-bit IV
        aad_bytes = associated_data.encode("utf-8") if associated_data else None
        ciphertext_with_tag = self.aesgcm.encrypt(nonce, plain_text.encode("utf-8"), aad_bytes)

        # Nonce va ciphertextni birlashtirib base64 qilish
        payload = nonce + ciphertext_with_tag
        b64_str = base64.urlsafe_b64encode(payload).decode("ascii")
        return f"enc:v1:{b64_str}"

    def decrypt(self, cipher_text: Optional[str], associated_data: Optional[str] = None) -> Optional[str]:
        """
        Shifrlangan 'enc:v1:<base64>' matnni deshifrlaydi va haqiqiy matnni qaytaradi.
        Agar matn shifrlanmagan (ochiq) bo'lsa, xatoliksiz asl holida qaytaradi (backward compatibility).
        """
        if cipher_text is None:
            return None
        if not cipher_text:
            return ""

        # Agar prefiks bo'lmasa, demak ochiq matn
        if not cipher_text.startswith("enc:v1:"):
            return cipher_text

        try:
            b64_str = cipher_text[len("enc:v1:") :]
            payload = base64.urlsafe_b64decode(b64_str.encode("ascii"))
            if len(payload) < 28:  # 12 nonce + 16 tag minimum
                raise ValueError("Shifrlangan paket uzunligi yetarli emas")

            nonce = payload[:12]
            ciphertext_with_tag = payload[12:]
            aad_bytes = associated_data.encode("utf-8") if associated_data else None

            decrypted_bytes = self.aesgcm.decrypt(nonce, ciphertext_with_tag, aad_bytes)
            return decrypted_bytes.decode("utf-8")
        except Exception as e:
            logger.error("Deshifrlashda xatolik: %s", e)
            raise ValueError(f"Maxfiy ma'lumotni deshifrlab bo'lmadi: {e}")

    def encrypt_dict(
        self, data: Dict[str, Any], sensitive_keys: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Lug'at ichidagi ko'rsatilgan (yoki barcha maxfiy) maydonlarni shifrlash."""
        target_keys = sensitive_keys or [
            "password",
            "token",
            "api_key",
            "secret",
            "pinfl",
            "passport_number",
            "login",
            "session_id",
            "certificate_key",
        ]
        result = {}
        for k, v in data.items():
            if k in target_keys and isinstance(v, str):
                result[k] = self.encrypt(v, associated_data=k)
            elif isinstance(v, dict):
                result[k] = self.encrypt_dict(v, target_keys)
            else:
                result[k] = v
        return result

    def decrypt_dict(
        self, data: Dict[str, Any], sensitive_keys: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Lug'at ichidagi shifrlangan maydonlarni o'z holiga qaytarish."""
        target_keys = sensitive_keys or [
            "password",
            "token",
            "api_key",
            "secret",
            "pinfl",
            "passport_number",
            "login",
            "session_id",
            "certificate_key",
        ]
        result = {}
        for k, v in data.items():
            if k in target_keys and isinstance(v, str):
                try:
                    result[k] = self.decrypt(v, associated_data=k)
                except Exception:
                    result[k] = v
            elif isinstance(v, dict):
                result[k] = self.decrypt_dict(v, target_keys)
            else:
                result[k] = v
        return result


# Standart global shifrlagich instansiyasi
default_encryptor = AES256Encryptor()


def encrypt_credential(plain_text: Optional[str], associated_data: Optional[str] = None) -> Optional[str]:
    """Davlat portallari (ijara.soliq.uz, transport.uz) parollari uchun tezkor shifrlash funksiyasi."""
    return default_encryptor.encrypt(plain_text, associated_data)


def decrypt_credential(cipher_text: Optional[str], associated_data: Optional[str] = None) -> Optional[str]:
    """Shifrlangan parollarni deshifrlash funksiyasi."""
    return default_encryptor.decrypt(cipher_text, associated_data)


def mask_sensitive(text: Optional[str], visible_chars: int = 4) -> str:
    """Xavfsiz log chiqarish uchun parollarni yashirish (masalan: *******1234)."""
    if not text:
        return ""
    if len(text) <= visible_chars:
        return "*" * len(text)
    return "*" * (len(text) - visible_chars) + text[-visible_chars:]
