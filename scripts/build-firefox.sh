#!/bin/sh
# Builds out/Brusk-Firefox.xpi from the extension folder with the Firefox manifest.
set -e
cd "$(dirname "$0")/.."
rm -rf build/firefox && mkdir -p build/firefox out
cp -r extension/* build/firefox/
cp scripts/manifest.firefox.json build/firefox/manifest.json
(cd build/firefox && rm -f ../../out/Brusk-Firefox.xpi && zip -q -r ../../out/Brusk-Firefox.xpi .)
echo out/Brusk-Firefox.xpi
