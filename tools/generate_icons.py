#!/usr/bin/env python3
"""
Generate iOS App Icon sets (light/dark/gray/mono) from a single 2x2 grid image.

Input image layout (quadrants):
  ┌───────────────┬───────────────┐
  │   Light       │    Dark       │
  ├───────────────┼───────────────┤
  │   Gray        │    Mono       │
  └───────────────┴───────────────┘

This script will:
  - Slice the input into four variants
  - Generate all required iPhone icon sizes for each variant
  - Populate the following asset catalogs under ios/HomeRef/Images.xcassets:
      AppIconLight.appiconset
      AppIconDark.appiconset
      AppIconGray.appiconset
      AppIconMono.appiconset
  - Also update the primary AppIcon.appiconset with the Light variant

Usage:
  python tools/generate_icons.py path/to/4up.png

Requires: Pillow
  python -m pip install Pillow
"""

import sys
import os
from PIL import Image
import json

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ASSETS = os.path.join(ROOT, 'apps', 'mobile', 'ios', 'HomeRef', 'Images.xcassets')

SETS = {
    'AppIconLight.appiconset': 'light',
    'AppIconDark.appiconset': 'dark',
    'AppIconGray.appiconset': 'gray',
    'AppIconMono.appiconset': 'mono',
}

# iPhone icon sizes (pt) and scales
SPECS = [
    (20, [2, 3]),
    (29, [2, 3]),
    (40, [2, 3]),
    (60, [2, 3]),
]

def make_contents_json(entries):
    return {
        "images": entries,
        "info": {"version": 1, "author": "script"}
    }

def write_appiconset(path, variant_img):
    os.makedirs(path, exist_ok=True)
    images = []
    # Remove old pngs
    for f in os.listdir(path):
        if f.lower().endswith('.png'):
            try: os.remove(os.path.join(path, f))
            except: pass
    # Generate iPhone sizes
    for size_pt, scales in SPECS:
        for scale in scales:
            px = size_pt * scale
            out_name = f"icon_{size_pt}pt@{scale}x.png"
            out_path = os.path.join(path, out_name)
            variant_img.resize((px, px), Image.LANCZOS).save(out_path, format='PNG')
            images.append({
                "idiom": "iphone",
                "size": f"{size_pt}x{size_pt}",
                "scale": f"{scale}x",
                "filename": out_name,
            })
    # ios-marketing 1024
    mk_name = "icon-marketing-1024.png"
    mk_path = os.path.join(path, mk_name)
    variant_img.resize((1024, 1024), Image.LANCZOS).save(mk_path, format='PNG')
    images.append({
        "idiom": "ios-marketing",
        "size": "1024x1024",
        "scale": "1x",
        "filename": mk_name,
    })
    with open(os.path.join(path, 'Contents.json'), 'w') as f:
        json.dump(make_contents_json(images), f, indent=2)

def main():
    if len(sys.argv) < 2:
        print("Usage: python tools/generate_icons.py path/to/4up.png")
        sys.exit(1)
    src = sys.argv[1]
    if not os.path.isfile(src):
        print(f"Input not found: {src}")
        sys.exit(2)

    img = Image.open(src).convert('RGBA')
    w, h = img.size
    cw, ch = w // 2, h // 2
    quads = {
        'light': img.crop((0, 0, cw, ch)),
        'dark':  img.crop((cw, 0, w, ch)),
        'gray':  img.crop((0, ch, cw, h)),
        'mono':  img.crop((cw, ch, w, h)),
    }

    # Write alternate sets
    for set_name, key in SETS.items():
        path = os.path.join(ASSETS, set_name)
        write_appiconset(path, quads[key])

    # Update primary AppIcon with the light variant
    write_appiconset(os.path.join(ASSETS, 'AppIcon.appiconset'), quads['light'])

    print("Done. App icon sets updated in:")
    for name in ['AppIcon.appiconset'] + list(SETS.keys()):
        print(" -", os.path.join(ASSETS, name))

if __name__ == '__main__':
    main()
