"""Package the tested folder build without development data or credentials."""
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

project = Path(__file__).resolve().parent.parent
folder = project / "dist" / "win-unpacked"
assert (folder / "QQ AI 小屋.exe").is_file()
shutil.copyfile(project / "docs" / "使用说明.md", folder / "使用说明.md")
shutil.copyfile(project / "docs" / "VALIDATION.md", folder / "验收记录.md")
shutil.copyfile(project / "LICENSE", folder / "LICENSE")
shutil.copyfile(project / "NOTICE.md", folder / "NOTICE.md")
version = json.loads((project / "package.json").read_text(encoding="utf-8"))["version"]
target = project / "dist" / f"QQ-AI-Launcher-{version}-windows-x64.zip"
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
    for file in sorted(folder.rglob("*")):
        if file.is_file():
            bundle.write(file, Path("QQ-AI-Launcher") / file.relative_to(folder))
with target.open("rb") as stream:
    digest = hashlib.file_digest(stream, "sha256").hexdigest()
target.with_suffix(".zip.sha256").write_text(
    f"{digest}  {target.name}\n", encoding="utf-8"
)
with zipfile.ZipFile(target) as bundle:
    assert bundle.testzip() is None
    assert "QQ-AI-Launcher/QQ AI 小屋.exe" in bundle.namelist()
    assert not any(
        "secrets" in name or ".test-artifacts" in name for name in bundle.namelist()
    )
print(json.dumps({"archive": str(target), "sizeMB": round(target.stat().st_size / 1024**2, 1), "sha256": digest}, ensure_ascii=False))
