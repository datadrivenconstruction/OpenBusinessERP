"""``python -m openbusinesserp`` entry point.

Delegates to the same ``main`` the ``openbusinesserp`` console script uses,
so this module form is a drop-in, PATH-independent way to launch the app.
"""

from __future__ import annotations

from openbusinesserp import main

if __name__ == "__main__":
    main()
