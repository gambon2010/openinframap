"""Fork: `python -m src.fork.indoor` (scripts/import-indoor.sh and the build run it)."""

import asyncio

from .link import main

asyncio.run(main())
