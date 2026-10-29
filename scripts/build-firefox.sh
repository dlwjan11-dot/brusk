#!/bin/sh
# Builds out/Barq-Firefox.xpi from the extension folder with the Firefox manifest.
set -e
cd "$(dirname "$0")/.."
rm -rf build/firefox && mkdir -p build/firefox out
cp -r extension/* build/firefox/
cp scripts/manifest.firefox.json build/firefox/manifest.json
(cd build/firefox && rm -f ../../out/Barq-Firefox.xpi && zip -q -r ../../out/Barq-Firefox.xpi .)
echo out/Barq-Firefox.xpi
