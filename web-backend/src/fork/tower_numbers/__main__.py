"""Fork: `python -m src.fork.tower_numbers` (the build runs it)."""

import asyncio

from . import main

asyncio.run(main())
