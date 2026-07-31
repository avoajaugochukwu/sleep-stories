"""CLI for script_context.

Read input JSON from stdin, build the context, write result JSON to stdout. ONLY
the result goes to stdout; logs go to stderr, so the TS bridge can parse stdout
directly.

    echo '{"script":"...","genre":"space"}' | python3 -m script_context
"""

from __future__ import annotations

import json
import sys


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"[context] invalid input JSON on stdin: {e}", file=sys.stderr)
        return 2

    from .client import build  # lazy: needs openai

    result = build(payload)
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
