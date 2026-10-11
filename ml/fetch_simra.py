"""
Downloads real-world Berlin SimRa ride CSVs from the official TU Berlin GitHub repository:
https://github.com/simra-project/dataset
"""

import os
import sys
import urllib.request
from pathlib import Path

BASE_URL = "https://raw.githubusercontent.com/simra-project/dataset/master/Berlin_2023_05/"

# Curated list of Berlin ride files from the official dataset
SAMPLE_FILES = [
    "VM2_-1005692448",
    "VM2_-1013385951",
    "VM2_-1026352461",
    "VM2_-1026999453",
    "VM2_-103664647",
    "VM2_-1040609918",
    "VM2_-1047013278",
    "VM2_-104749000",
    "VM2_-1057674883",
    "VM2_-1075983448",
    "VM2_-1081021177",
    "VM2_-108183767",
    "VM2_-1084791062",
    "VM2_-1093010961",
    "VM2_-1099746684",
    "VM2_-1113067424",
    "VM2_-111685206",
    "VM2_-1119520324",
    "VM2_-112856690",
    "VM2_-1130666090",
    "VM2_-1135925269",
    "VM2_-1136177977",
    "VM2_-1148002908",
    "VM2_-1148286485",
    "VM2_-114862485",
    "VM2_-1152810880",
    "VM2_-1153528813",
    "VM2_-1158531346",
    "VM2_-1162140542",
    "VM2_-1166985642",
]


def download_simra_rides(output_dir: Path, max_files: int = 15):
    output_dir.mkdir(parents=True, exist_ok=True)
    downloaded = 0

    print(f"Fetching SimRa Berlin ride data to {output_dir}...")
    for filename in SAMPLE_FILES[:max_files]:
        dest = output_dir / f"{filename}.csv"
        if dest.exists() and dest.stat().st_size > 1000:
            print(f" [cached] {filename}.csv ({dest.stat().st_size // 1024} KB)")
            downloaded += 1
            continue

        url = f"{BASE_URL}{filename}"
        print(f" [downloading] {url} -> {dest.name}...", end="", flush=True)
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "CycleSafe-SimRa-Downloader/1.0"}
            )
            with urllib.request.urlopen(req, timeout=15) as resp, open(dest, "wb") as f:
                f.write(resp.read())
            size_kb = dest.stat().st_size // 1024
            print(f" done ({size_kb} KB)")
            downloaded += 1
        except Exception as e:
            print(f" failed: {e}")
            if dest.exists():
                dest.unlink()

    print(f"\nSimRa download completed: {downloaded} ride files in {output_dir}")
    return downloaded


if __name__ == "__main__":
    target_dir = Path(__file__).resolve().parent.parent / "simra_data"
    download_simra_rides(target_dir, max_files=15)
