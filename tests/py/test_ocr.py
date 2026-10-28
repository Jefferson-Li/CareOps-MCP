import asyncio
import runpy
import sys
import types
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile
from fastapi.testclient import TestClient
from PIL import Image

import app
import generate_sample

ROOT = Path(__file__).resolve().parents[2]
APP_PATH = ROOT / "workers" / "ocr" / "app.py"
GEN_PATH = ROOT / "workers" / "ocr" / "generate_sample.py"
LETTER = "Re: Aisha Rahman\nPlease update residential address to 19 Herring Rd, Marsfield NSW 2122.\nContact 0433 222 111.\nMRN 430009876.\n"


def png_bytes() -> bytes:
    buf = BytesIO()
    Image.new("RGB", (8, 8), "white").save(buf, format="PNG")
    return buf.getvalue()


def write_png(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 8), "white").save(path)
    return path


def install_tesseract(monkeypatch, *, version_ok=True, text="Re: Pat\n"):
    mod = types.ModuleType("pytesseract")

    def get_tesseract_version():
        if not version_ok:
            raise RuntimeError("no binary")
        return "5.0"

    def image_to_string(_img):
        if isinstance(text, Exception):
            raise text
        return text

    mod.get_tesseract_version = get_tesseract_version
    mod.image_to_string = image_to_string
    monkeypatch.setitem(sys.modules, "pytesseract", mod)
    return mod


def test_extract_fields_all_and_none():
    fields = app.extract_fields(LETTER)
    assert fields["client_name"] == "Aisha Rahman"
    assert fields["proposed_address"] == "19 Herring Rd, Marsfield NSW 2122"
    assert "0433" in fields["phone"]
    assert fields["mrn"] == "430009876"
    assert app.extract_fields("no structured content") == {}
    assert app.extract_fields("phone only 0412 000 111")["phone"].startswith("0412")
    assert "mrn" in app.extract_fields("record 430001111")
    assert app.extract_fields("address to 1 St, Place NSW 2000")["proposed_address"].startswith("1 St")


def test_samples_dir(tmp_path, monkeypatch):
    monkeypatch.delenv("OCR_SAMPLES_DIR", raising=False)
    assert app.samples_dir() == app.ROOT / "samples"
    monkeypatch.setenv("OCR_SAMPLES_DIR", str(tmp_path))
    assert app.samples_dir() == tmp_path
    monkeypatch.setenv("OCR_SAMPLES_DIR", "")
    assert app.samples_dir() == app.ROOT / "samples"


def test_resolve_path_relative_absolute_and_restricted(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "ROOT", tmp_path)
    monkeypatch.setattr(app, "RESTRICT_PATH", False)
    img = write_png(tmp_path / "nested" / "a.png")
    assert app.resolve_path("nested/a.png") == img.resolve()
    assert app.resolve_path(str(img)) == img.resolve()

    samples = tmp_path / "samples"
    inside = write_png(samples / "ok.png")
    outside = write_png(tmp_path / "secret.png")
    monkeypatch.setattr(app, "samples_dir", lambda: samples)
    monkeypatch.setattr(app, "RESTRICT_PATH", True)
    assert app.resolve_path("samples/ok.png") == inside.resolve()
    with pytest.raises(HTTPException) as exc:
        app.resolve_path(str(outside))
    assert exc.value.status_code == 403


def test_tesseract_availability_and_runner(tmp_path, monkeypatch):
    img = write_png(tmp_path / "a.png")
    install_tesseract(monkeypatch, text="hello ocr")
    assert app.tesseract_available() is True
    assert app.run_tesseract(img) == "hello ocr"

    install_tesseract(monkeypatch, version_ok=False)
    assert app.tesseract_available() is False
    monkeypatch.setitem(sys.modules, "pytesseract", None)
    assert app.tesseract_available() is False


def test_demo_sidecar_variants(tmp_path):
    img = write_png(tmp_path / "letter.png")
    (tmp_path / "letter.png.ocr.txt").write_text("first sidecar\n", encoding="utf-8")
    text, notes = app.run_demo_ocr(img)
    assert text == "first sidecar\n"
    assert "demo-sidecar" in notes

    (tmp_path / "letter.png.ocr.txt").unlink()
    (tmp_path / "letter.ocr.txt").write_text("second sidecar\n", encoding="utf-8")
    text, _notes = app.run_demo_ocr(img)
    assert "second sidecar" in text

    (tmp_path / "letter.ocr.txt").unlink()
    with pytest.raises(FileNotFoundError):
        app.run_demo_ocr(img)


def test_ocr_file_modes(tmp_path, monkeypatch):
    missing = tmp_path / "missing.png"
    with pytest.raises(FileNotFoundError):
        app.ocr_file(missing)

    img = write_png(tmp_path / "a.png")
    (tmp_path / "a.png.ocr.txt").write_text(LETTER, encoding="utf-8")

    install_tesseract(monkeypatch, text="Re: Tess Person\n")
    monkeypatch.setenv("OCR_MODE", "tesseract")
    tess = app.ocr_file(img)
    assert tess.engine == "tesseract"
    assert tess.notes is None
    assert tess.image_size == [8, 8]
    assert tess.fields["client_name"] == "Tess Person"

    install_tesseract(monkeypatch, text=RuntimeError("tess broke"))
    with pytest.raises(RuntimeError):
        app.ocr_file(img)

    monkeypatch.setenv("OCR_MODE", "auto")
    fallback = app.ocr_file(img)
    assert fallback.engine == "demo"
    assert fallback.notes.startswith("tesseract_failed=")
    assert "Aisha" in fallback.text

    install_tesseract(monkeypatch, text="Re: Auto\n")
    auto = app.ocr_file(img)
    assert auto.engine == "tesseract"
    assert auto.fields["client_name"] == "Auto"

    monkeypatch.setitem(sys.modules, "pytesseract", None)
    monkeypatch.setenv("OCR_MODE", "auto")
    demo = app.ocr_file(img)
    assert demo.engine == "demo"

    install_tesseract(monkeypatch, text=RuntimeError("should not run"))
    monkeypatch.setenv("OCR_MODE", "demo")
    forced = app.ocr_file(img)
    assert forced.engine == "demo"
    assert "Aisha" in forced.text


def test_ensure_sample_fonts(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "samples_dir", lambda: tmp_path)
    real_truetype = app.ImageFont.truetype
    real_default = app.ImageFont.load_default

    def missing(font, *args, **kwargs):
        if isinstance(font, str):
            raise OSError("missing font")
        return real_truetype(font, *args, **kwargs)

    monkeypatch.setattr(app.ImageFont, "truetype", missing)
    fallback = app.ensure_sample_image()
    assert fallback.exists()
    assert (tmp_path / "gp-letter-aisha.ocr.txt").read_text(encoding="utf-8").startswith("Eastwood")

    def present(font, *args, **kwargs):
        if isinstance(font, str):
            return real_default()
        return real_truetype(font, *args, **kwargs)

    monkeypatch.setattr(app.ImageFont, "truetype", present)
    assert app.ensure_sample_image().exists()


def test_http_endpoints(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "samples_dir", lambda: tmp_path)
    monkeypatch.setattr(app, "RESTRICT_PATH", False)
    monkeypatch.setenv("OCR_MODE", "demo")
    img = write_png(tmp_path / "letter.png")
    (tmp_path / "letter.png.ocr.txt").write_text(LETTER, encoding="utf-8")

    with TestClient(app.app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["ok"] is True
        assert health.json()["service"] == "careops-ocr"

        ok = client.post("/ocr/path", json={"path": str(img)})
        assert ok.status_code == 200
        assert ok.json()["fields"]["mrn"] == "430009876"

        missing = client.post("/ocr/path", json={"path": str(tmp_path / "nope.png")})
        assert missing.status_code == 404

        bad = tmp_path / "bad.png"
        bad.write_text("not an image", encoding="utf-8")
        failed = client.post("/ocr/path", json={"path": str(bad)})
        assert failed.status_code == 500

        install_tesseract(monkeypatch, text=LETTER)
        monkeypatch.setenv("OCR_MODE", "tesseract")
        upload = client.post(
            "/ocr/upload",
            files={"file": ("letter.png", png_bytes(), "image/png")},
        )
        assert upload.status_code == 200
        assert (tmp_path / "upload-letter.png").exists()

        bad_upload = client.post(
            "/ocr/upload",
            files={"file": ("bad.png", b"not-png", "image/png")},
        )
        assert bad_upload.status_code == 500

        samples = tmp_path / "only-samples"
        samples.mkdir()
        monkeypatch.setattr(app, "samples_dir", lambda: samples)
        monkeypatch.setattr(app, "RESTRICT_PATH", True)
        forbidden = client.post("/ocr/path", json={"path": str(img)})
        assert forbidden.status_code == 403

        monkeypatch.setattr(app, "samples_dir", lambda: tmp_path)
        monkeypatch.setattr(app, "ADMIN_ENABLED", False)
        assert client.post("/admin/ensure-sample").status_code == 403
        monkeypatch.setattr(app, "ADMIN_ENABLED", True)
        created = client.post("/admin/ensure-sample")
        assert created.status_code == 200
        assert created.json()["path"].endswith("gp-letter-aisha.png")


def test_upload_without_filename(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "samples_dir", lambda: tmp_path)
    monkeypatch.setenv("OCR_MODE", "tesseract")
    install_tesseract(monkeypatch, text="Re: Upload\n")
    upload = UploadFile(filename=None, file=BytesIO(png_bytes()))
    result = asyncio.run(app.ocr_upload(upload))
    assert result.fields["client_name"] == "Upload"
    assert (tmp_path / "upload-doc.png").exists()

    named = UploadFile(filename="named.png", file=BytesIO(png_bytes()))
    asyncio.run(app.ocr_upload(named))
    assert (tmp_path / "upload-named.png").exists()


def test_process_entrypoints(tmp_path, monkeypatch, capsys):
    calls = []

    def run(*args, **kwargs):
        calls.append((args, kwargs))

    fake = types.ModuleType("uvicorn")
    fake.run = run
    monkeypatch.setitem(sys.modules, "uvicorn", fake)
    monkeypatch.setenv("OCR_SAMPLES_DIR", str(tmp_path))
    monkeypatch.setenv("OCR_HOST", "0.0.0.0")
    monkeypatch.setenv("OCR_PORT", "3999")
    monkeypatch.setenv("OCR_ADMIN_ENABLED", "0")
    runpy.run_path(str(APP_PATH), run_name="__main__")
    assert calls[-1][1]["host"] == "0.0.0.0"
    assert calls[-1][1]["port"] == 3999
    assert calls[-1][1]["log_level"] == "info"
    assert not (tmp_path / "gp-letter-aisha.png").exists()

    monkeypatch.setenv("OCR_ADMIN_ENABLED", "1")
    runpy.run_path(str(APP_PATH), run_name="__main__")
    assert (tmp_path / "gp-letter-aisha.png").exists()
    assert len(calls) == 2

    monkeypatch.setattr(app, "samples_dir", lambda: tmp_path / "generated")
    runpy.run_path(str(GEN_PATH), run_name="__main__")
    assert "Wrote" in capsys.readouterr().out
    assert (tmp_path / "generated" / "gp-letter-aisha.png").exists()
