"""Inspect FEBRL sources, split entities, block candidate pairs, and derive features."""

from __future__ import annotations

import json

from febrl_pipeline import save_prepared


def main() -> None:
    report = save_prepared()
    print(json.dumps(report["pair_preparation"], indent=2))
    print("\nPrepared feature files are in ./prepared/; raw record IDs are not model inputs.")


if __name__ == "__main__":
    main()
