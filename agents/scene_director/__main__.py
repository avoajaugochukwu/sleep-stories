"""CLI for scene_director.

    echo '{"context":{},"genre":"space","scenes":[{"id":1,"snippet":"..."}]}' \
      | python3 -m scene_director

ONLY the result JSON goes to stdout; logs go to stderr.
"""

from __future__ import annotations

import json
import sys


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"[director] invalid input JSON on stdin: {e}", file=sys.stderr)
        return 2

    from .client import direct  # lazy: needs openai

    result = direct(payload)
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
