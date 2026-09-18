# Root conftest puts the repo root on sys.path so `import api.signaling` works
# when pytest is invoked from anywhere.
import os
import secrets

if not os.getenv("SECRET_KEY") and not os.getenv("SECRET_FILE"):
    os.environ["SECRET_KEY"] = secrets.token_hex(32)
