"""CLI for scene_splitter.

    echo '{"chunk_text":"...","context":{}}' | python3 -m scene_splitter

ONLY the result JSON goes to stdout; logs go to stderr.
"""

from __future__ import annotations

import json
import sys


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"[splitter] invalid input JSON on stdin: {e}", file=sys.stderr)
        return 2

    from .client import split  # lazy: needs openai

    result = split(payload)
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
