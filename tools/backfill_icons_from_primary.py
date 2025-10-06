#!/usr/bin/env python3
"""
Backfill iOS AppIcon sizes from a given 1024px icon image or the existing marketing image.
Usage:
  python tools/backfill_icons_from_primary.py [path/to/icon1024.png]
Requires: Pillow
"""
import os, json, sys
from PIL import Image, ImageDraw, ImageFont, ImageStat

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ASSETS = os.path.join(ROOT, 'apps', 'mobile', 'ios', 'HomeRef', 'Images.xcassets')
PRIMARY = os.path.join(ASSETS, 'AppIcon.appiconset')
ALTS = [
    os.path.join(ASSETS, 'AppIconLight.appiconset'),
    os.path.join(ASSETS, 'AppIconDark.appiconset'),
    os.path.join(ASSETS, 'AppIconGray.appiconset'),
    os.path.join(ASSETS, 'AppIconMono.appiconset'),
]

# iPhone pt sizes with scales
IPHONE_SPECS = [
    (20, [2, 3]),
    (29, [2, 3]),
    (40, [2, 3]),
    (60, [2, 3]),
]

# iPad pt sizes with scales
IPAD_SPECS = [
    (20, [1, 2]),
    (29, [1, 2]),
    (40, [1, 2]),
    (76, [1, 2]),
    (83.5, [2]),
]

def is_blank(img: Image.Image) -> bool:
    try:
        stat = ImageStat.Stat(img)
        mean = stat.mean
        extrema = img.getextrema()
        # Consider blank if all channels are at max (white) or min (black) with near-zero variance
        if extrema and all(lo == hi for (lo, hi) in extrema[:3]):
            return True
        if mean and sum(mean[:3]) in (0.0, 765.0):
            return True
    except Exception:
        pass
    return False

def make_placeholder(size=1024) -> Image.Image:
    # Simple blue rounded-square with white "H" to avoid blank icons
    img = Image.new('RGBA', (size, size), (10, 132, 255, 255))
    draw = ImageDraw.Draw(img)
    # Rounded rectangle border radius ~ 20%
    r = int(size * 0.2)
    draw.rounded_rectangle([(0,0),(size-1,size-1)], radius=r, fill=(10,132,255,255))
    # Large letter
    txt = 'H'
    # Try to load a system font; fallback to default
    try:
        # Common macOS font
        font = ImageFont.truetype('/System/Library/Fonts/SFNS.ttf', int(size*0.6))
    except Exception:
        try:
            font = ImageFont.truetype('/Library/Fonts/Arial Bold.ttf', int(size*0.6))
        except Exception:
            font = ImageFont.load_default()
    try:
        # Pillow >=8: use textbbox for accurate size
        bbox = draw.textbbox((0,0), txt, font=font)
        tw, th = (bbox[2]-bbox[0], bbox[3]-bbox[1])
    except Exception:
        # Fallback approximate size
        tw, th = (int(size*0.6), int(size*0.6))
    draw.text(((size - tw)//2, (size - th)//2 - int(size*0.04)), txt, font=font, fill=(255,255,255,255))
    return img

def load_primary_1024():
    cj = os.path.join(PRIMARY, 'Contents.json')
    if not os.path.isfile(cj):
        print('AppIcon.appiconset/Contents.json not found', file=sys.stderr)
        sys.exit(1)
    with open(cj, 'r') as f:
        data = json.load(f)
    # find ios-marketing or 1024 entry
    fname = None
    for img in data.get('images', []):
        if img.get('size') == '1024x1024' and img.get('filename'):
            fname = img['filename']
            break
    if not fname:
        # fallback to any png in folder
        for f in os.listdir(PRIMARY):
            if f.lower().endswith('.png'):
                fname = f; break
    if not fname:
        print('No source 1024 icon found', file=sys.stderr)
        sys.exit(2)
    path = os.path.join(PRIMARY, fname)
    img = Image.open(path).convert('RGBA')
    if is_blank(img):
        # Build a non-empty placeholder so we don't ship an empty white icon
        img = make_placeholder(1024)
    return img

def load_primary_1024_from_path(src_path: str):
    img = Image.open(src_path).convert('RGBA')
    return img


def write_primary(ico: Image.Image):
    os.makedirs(PRIMARY, exist_ok=True)
    images = []
    # Remove all but keep a 1024 entry (we'll recreate)
    for f in os.listdir(PRIMARY):
        if f.lower().endswith('.png'):
            try: os.remove(os.path.join(PRIMARY, f))
            except: pass
    # generate sizes
    # iPhone icons
    for size_pt, scales in IPHONE_SPECS:
        for scale in scales:
            px = int(round(size_pt * scale))
            name = f'icon_{str(size_pt).replace(".", "-")}pt@{scale}x.png'
            ico.resize((px, px), Image.LANCZOS).save(os.path.join(PRIMARY, name), format='PNG')
            images.append({
                "idiom": "iphone",
                "size": f"{size_pt}x{size_pt}",
                "scale": f"{scale}x",
                "filename": name,
            })

    # iPad icons
    for size_pt, scales in IPAD_SPECS:
        for scale in scales:
            px = int(round(size_pt * scale))
            name = f'ipad_icon_{str(size_pt).replace(".", "-")}pt@{scale}x.png'
            ico.resize((px, px), Image.LANCZOS).save(os.path.join(PRIMARY, name), format='PNG')
            images.append({
                "idiom": "ipad",
                "size": f"{size_pt}x{size_pt}",
                "scale": f"{scale}x",
                "filename": name,
            })
    # marketing
    mk = 'icon-marketing-1024.png'
    ico.resize((1024,1024), Image.LANCZOS).save(os.path.join(PRIMARY, mk), format='PNG')
    images.append({
        "idiom": "ios-marketing",
        "size": "1024x1024",
        "scale": "1x",
        "filename": mk,
    })
    with open(os.path.join(PRIMARY, 'Contents.json'), 'w') as f:
        json.dump({"images": images, "info": {"version": 1, "author": "script"}}, f, indent=2)


def copy_to_alts(ico: Image.Image):
    for alt in ALTS:
        os.makedirs(alt, exist_ok=True)
        # if alt is empty or has no pngs, populate
        has_png = any(n.lower().endswith('.png') for n in os.listdir(alt)) if os.path.isdir(alt) else False
        if not has_png:
            images = []
            # iPhone
            for size_pt, scales in IPHONE_SPECS:
                for scale in scales:
                    px = int(round(size_pt * scale))
                    name = f'icon_{str(size_pt).replace(".", "-")}pt@{scale}x.png'
                    ico.resize((px, px), Image.LANCZOS).save(os.path.join(alt, name), format='PNG')
                    images.append({
                        "idiom": "iphone",
                        "size": f"{size_pt}x{size_pt}",
                        "scale": f"{scale}x",
                        "filename": name,
                    })
            # iPad
            for size_pt, scales in IPAD_SPECS:
                for scale in scales:
                    px = int(round(size_pt * scale))
                    name = f'ipad_icon_{str(size_pt).replace(".", "-")}pt@{scale}x.png'
                    ico.resize((px, px), Image.LANCZOS).save(os.path.join(alt, name), format='PNG')
                    images.append({
                        "idiom": "ipad",
                        "size": f"{size_pt}x{size_pt}",
                        "scale": f"{scale}x",
                        "filename": name,
                    })
            mk = 'icon-marketing-1024.png'
            ico.resize((1024,1024), Image.LANCZOS).save(os.path.join(alt, mk), format='PNG')
            images.append({
                "idiom": "ios-marketing",
                "size": "1024x1024",
                "scale": "1x",
                "filename": mk,
            })
            with open(os.path.join(alt, 'Contents.json'), 'w') as f:
                json.dump({"images": images, "info": {"version": 1, "author": "script"}}, f, indent=2)


def main():
    src_path = sys.argv[1] if len(sys.argv) > 1 else None
    if src_path and os.path.isfile(src_path):
        ico = load_primary_1024_from_path(src_path)
    else:
        ico = load_primary_1024()
    # Save a copy of the source as marketing image too
    os.makedirs(PRIMARY, exist_ok=True)
    ico.resize((1024,1024), Image.LANCZOS).save(os.path.join(PRIMARY, 'icon-marketing-1024.png'), format='PNG')
    write_primary(ico)
    copy_to_alts(ico)
    print('Backfilled icons for primary and alternates from source image.' if src_path else 'Backfilled icons for primary and alternates from existing 1024 image.')

if __name__ == '__main__':
    main()
