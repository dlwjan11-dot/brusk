"""Build a standalone gallery-dl program (with yt-dlp inside, for the few sites that need it)
from PyPI with PyInstaller. Used by the release workflow:  python scripts/build-gallery-dl.py vendor/win"""
import os, subprocess, sys, tempfile

GALLERY_DL = "1.32.18"
out = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "vendor/gallery-dl")
os.makedirs(out, exist_ok=True)
subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", f"gallery-dl=={GALLERY_DL}", "yt-dlp", "pyinstaller>=6.10,<7"])
work = tempfile.mkdtemp(prefix="gdl-")
entry = os.path.join(work, "gallery_dl_main.py")
with open(entry, "w") as f:
    f.write("import sys\nfrom gallery_dl import main\nsys.exit(main())\n")
subprocess.check_call([sys.executable, "-m", "PyInstaller", "--onefile", "--noconfirm", "--name", "gallery-dl",
                       "--distpath", out, "--workpath", os.path.join(work, "build"), "--specpath", work,
                       "--collect-submodules", "gallery_dl", "--collect-submodules", "yt_dlp", "--collect-data", "certifi", entry])
exe = os.path.join(out, "gallery-dl" + (".exe" if os.name == "nt" else ""))
print(subprocess.check_output([exe, "--version"]).decode().strip(), "->", exe)
