"""Download FEBRL 4A/4B from the source used by the Record Linkage Toolkit."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
SOURCES = {
    "dataset4a.csv": "https://raw.githubusercontent.com/J535D165/recordlinkage/master/recordlinkage/datasets/febrl/dataset4a.csv",
    "dataset4b.csv": "https://raw.githubusercontent.com/J535D165/recordlinkage/master/recordlinkage/datasets/febrl/dataset4b.csv",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force-download", action="store_true", help="replace existing raw files")
    args = parser.parse_args()
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    for filename, url in SOURCES.items():
        destination = DATA_DIR / filename
        if args.force_download or not destination.exists():
            with urlopen(url, timeout=60) as response, destination.open("wb") as output:
                output.write(response.read())
        if destination.stat().st_size == 0:
            raise RuntimeError(f"Empty dataset download: {destination}")

    metadata = {
        "dataset": "FEBRL 4A/4B",
        "retrieved_at_utc": datetime.now(timezone.utc).isoformat(),
        "documentation_url": "https://recordlinkage.readthedocs.io/en/stable/guides/link_two_dataframes.html",
        "source_repository": "https://github.com/J535D165/recordlinkage",
        "source_files": {
            name: {"url": url, "sha256": sha256(DATA_DIR / name), "bytes": (DATA_DIR / name).stat().st_size}
            for name, url in SOURCES.items()
        },
        "structure_note": "4A contains originals and 4B contains one corrupted copy per original; the numeric component of rec_id identifies the shared entity, as documented by load_febrl4(return_links=True).",
    }
    (ROOT / "dataset_metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
