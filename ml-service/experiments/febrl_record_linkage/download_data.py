"""Download the versioned FEBRL 4A/4B files from the toolkit source release."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

from febrl_pipeline import DATA_DIR, SOURCE_URLS, sha256_file

SOURCE_REVISION = "J535D165/recordlinkage v0.16 (commit b93d976)"


def download(force: bool = False) -> dict[str, object]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, object] = {
        "dataset": "FEBRL 4A/4B",
        "source_revision": SOURCE_REVISION,
        "downloaded_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_documentation": "https://recordlinkage.readthedocs.io/en/stable/guides/link_two_dataframes.html",
        "dataset_api_documentation": "https://recordlinkage.readthedocs.io/en/stable/ref-datasets.html",
        "files": {},
    }
    for filename, url in SOURCE_URLS.items():
        destination = DATA_DIR / filename
        if force or not destination.is_file():
            with urlopen(url, timeout=60) as response, destination.open("wb") as output:
                output.write(response.read())
        manifest["files"][filename] = {
            "url": url,
            "bytes": destination.stat().st_size,
            "sha256": sha256_file(destination),
        }
    manifest_path = DATA_DIR / "dataset_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="Redownload and replace existing local files.")
    args = parser.parse_args()
    print(json.dumps(download(force=args.force), indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Download failed: {error}", file=sys.stderr)
        raise
