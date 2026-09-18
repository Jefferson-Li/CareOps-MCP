"""CareOps OCR worker — FastAPI microservice called by the TypeScript MCP layer.

Uses Tesseract when available; otherwise falls back to demo mode (validates the
image with Pillow and reads a sidecar `.ocr.txt` next to the image). This keeps
the bilingual stack demo portable without requiring native OCR installs.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError as exc:  # pragma: no cover
    raise SystemExit("Install deps: pip install -r workers/ocr/requirements.txt") from exc

app = FastAPI(title="CareOps OCR Worker", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = ROOT / "samples"
HOST = os.environ.get("OCR_HOST", "127.0.0.1")
PORT = int(os.environ.get("OCR_PORT", "3850"))
RESTRICT_PATH = os.environ.get("OCR_RESTRICT_PATH", "0").lower() in {"1", "true", "yes"}
ADMIN_ENABLED = os.environ.get("OCR_ADMIN_ENABLED", "1").lower() in {"1", "true", "yes"}


class OcrPathRequest(BaseModel):
    path: str = Field(description="Absolute or project-relative path to an image")


class OcrResult(BaseModel):
    engine: str
    text: str
    fields: dict[str, str]
    image_size: list[int] | None = None
    notes: str | None = None


def extract_fields(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    addr = re.search(r"address to\s+(.+?)(?:\.|$)", text, re.I)
    if addr:
        out["proposed_address"] = addr.group(1).strip()
    phone = re.search(r"(?:\+?61|0)\s?\d[\d\s-]{7,}", text)
    if phone:
        out["phone"] = phone.group(0).strip()
    mrn_match = re.search(r"\b4\d{8}\b", text)
    if mrn_match:
        out["mrn"] = mrn_match.group(0)
    name = re.search(r"Re:\s*(.+)", text, re.I)
    if name:
        out["client_name"] = name.group(1).strip()
    return out


def resolve_path(raw: str) -> Path:
    p = Path(raw)
    if not p.is_absolute():
        p = ROOT / raw
    resolved = p.resolve()
    if RESTRICT_PATH:
        try:
            resolved.relative_to(SAMPLES.resolve())
        except ValueError as err:
            raise HTTPException(
                status_code=403,
                detail="path outside samples/ is not allowed",
            ) from err
    return resolved


def tesseract_available() -> bool:
    try:
        import pytesseract

        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def run_tesseract(image_path: Path) -> str:
    import pytesseract

    return pytesseract.image_to_string(Image.open(image_path))


def run_demo_ocr(image_path: Path) -> tuple[str, str]:
    """Validate image exists, then read sidecar `<name>.ocr.txt` if present."""
    with Image.open(image_path) as img:
        size = img.size
    sidecar = image_path.with_suffix(image_path.suffix + ".ocr.txt")
    if not sidecar.exists():
        sidecar = image_path.with_suffix(".ocr.txt")
    if sidecar.exists():
        return sidecar.read_text(encoding="utf-8"), f"demo-sidecar; image={size[0]}x{size[1]}"
    raise FileNotFoundError(
        f"No Tesseract and no sidecar OCR text at {sidecar}. "
        "Generate samples with: python workers/ocr/generate_sample.py"
    )


def ocr_file(image_path: Path) -> OcrResult:
    if not image_path.exists():
        raise FileNotFoundError(str(image_path))
    with Image.open(image_path) as img:
        size = list(img.size)

    mode = os.environ.get("OCR_MODE", "auto").lower()
    engine = "demo"
    notes = None
    text = ""

    use_tess = mode == "tesseract" or (mode == "auto" and tesseract_available())
    if use_tess:
        try:
            text = run_tesseract(image_path)
            engine = "tesseract"
        except Exception as err:
            if mode == "tesseract":
                raise
            text, notes = run_demo_ocr(image_path)
            engine = "demo"
            notes = f"tesseract_failed={err}; {notes}"
    else:
        text, notes = run_demo_ocr(image_path)
        engine = "demo"

    return OcrResult(
        engine=engine,
        text=text.strip(),
        fields=extract_fields(text),
        image_size=size,
        notes=notes,
    )


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "careops-ocr",
        "tesseract": tesseract_available(),
        "mode": os.environ.get("OCR_MODE", "auto"),
    }


@app.post("/ocr/path", response_model=OcrResult)
def ocr_path(body: OcrPathRequest) -> OcrResult:
    path = resolve_path(body.path)
    try:
        return ocr_file(path)
    except FileNotFoundError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.post("/ocr/upload", response_model=OcrResult)
async def ocr_upload(file: UploadFile = File(...)) -> OcrResult:
    SAMPLES.mkdir(parents=True, exist_ok=True)
    dest = SAMPLES / f"upload-{file.filename or 'doc.png'}"
    dest.write_bytes(await file.read())
    try:
        return ocr_file(dest)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


def ensure_sample_image() -> Path:
    """Create a simple GP-letter PNG + sidecar for portable demos."""
    SAMPLES.mkdir(parents=True, exist_ok=True)
    out = SAMPLES / "gp-letter-aisha.png"
    text = "\n".join(
        [
            "Eastwood Family Medical Centre",
            "Re: Aisha Rahman",
            "Please update residential address to 19 Herring Rd, Marsfield NSW 2122.",
            "Contact mobile remains 0433 222 111.",
            "Medical record number 430009876.",
        ]
    )
    img = Image.new("RGB", (900, 360), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 22)
    except OSError:
        font = ImageFont.load_default()
    y = 24
    for line in text.splitlines():
        draw.text((24, y), line, fill=(20, 20, 20), font=font)
        y += 36
    img.save(out)
    (SAMPLES / "gp-letter-aisha.ocr.txt").write_text(text + "\n", encoding="utf-8")
    return out


@app.post("/admin/ensure-sample")
def admin_ensure_sample() -> dict[str, str]:
    if not ADMIN_ENABLED:
        raise HTTPException(status_code=403, detail="admin endpoints disabled")
    path = ensure_sample_image()
    return {"path": str(path)}


if __name__ == "__main__":
    import uvicorn

    if ADMIN_ENABLED:
        ensure_sample_image()
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
