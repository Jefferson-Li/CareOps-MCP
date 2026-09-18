#!/usr/bin/env python3
"""Generate the sample GP letter PNG + OCR sidecar used by demos."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app import ensure_sample_image

if __name__ == "__main__":
    path = ensure_sample_image()
    print(f"Wrote {path}")
