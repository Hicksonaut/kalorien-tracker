"""Einmaliger Garmin-Login fuer den Dashboard-Server.

Fragt E-Mail, Passwort und ggf. MFA-Code interaktiv ab und legt die Tokens
im Tokenstore ab. Danach laeuft der Sync ohne Passwort.

    docker compose run --rm garmin-dashboard python -m app.login
"""

from getpass import getpass
from pathlib import Path

from garminconnect import Garmin

from .sync import TOKENSTORE


def main() -> None:
    email = input("Garmin E-Mail: ").strip()
    password = getpass("Garmin Passwort: ")
    api = Garmin(email=email, password=password, prompt_mfa=lambda: input("MFA-Code: ").strip())
    Path(TOKENSTORE).mkdir(parents=True, exist_ok=True)
    api.login(tokenstore=TOKENSTORE)
    print(f"Angemeldet als {api.get_full_name()} - Tokens liegen in {TOKENSTORE}")


if __name__ == "__main__":
    main()
