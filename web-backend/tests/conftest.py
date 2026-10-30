# Tests import the app's modules; their config wants a database URL, but the fork's
# unit tests don't connect to it.
import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test@localhost/test")
