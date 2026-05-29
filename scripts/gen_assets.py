"""
Generate TapClash branded icon and splash assets.

Run with PIL installed:  pip3 install Pillow && python3 scripts/gen_assets.py

Assets produced:
  assets/icon.png                     1024x1024  App store icon (no transparency)
  assets/splash-icon.png              1024x1024  Splash logo (transparent bg)
  assets/android-icon-foreground.png   512x512   Adaptive icon foreground (transparent)
  assets/android-icon-background.png   512x512   Adaptive icon background (solid)
  assets/android-icon-monochrome.png   432x432   Monochrome icon (white on transparent)
  assets/favicon.png                    48x48    Web favicon

Design: dark #0a0a0a bg, Solana-green (#14F195) concentric target rings, purple combo dot.
"""

from PIL import Image, ImageDraw
import os

ASSETS = os.path.join(os.path.dirname(__file__), '..', 'assets')

BG     = (10, 10, 10)
GREEN  = (20, 241, 149)
PURPLE = (153, 69, 255)
WHITE  = (255, 255, 255)
TRANS  = (0, 0, 0, 0)


def new_rgba(size):
    return Image.new('RGBA', (size, size), TRANS)


def draw_target(draw: ImageDraw.ImageDraw, cx, cy, r, ring_color, hole_color):
    """Concentric ring + filled inner circle, like a tap target."""
    # outer ring
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ring_color)
    # punch hole — second ellipse with hole_color
    inner_r = int(r * 0.62)
    draw.ellipse([cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r], fill=hole_color)
    # bullseye dot
    bull_r = int(r * 0.28)
    draw.ellipse([cx - bull_r, cy - bull_r, cx + bull_r, cy + bull_r], fill=ring_color)


def draw_combo_streak(draw: ImageDraw.ImageDraw, cx, cy, r, color):
    """Three small dots offset to the upper-right of the main target."""
    offset = r * 0.95
    dot_r = max(2, int(r * 0.09))
    for i in range(3):
        gap = dot_r * 2.6
        x = cx + offset + i * gap
        y = cy - offset - i * gap
        draw.ellipse([x - dot_r, y - dot_r, x + dot_r, y + dot_r], fill=color)


# ── icon (1024x1024, no alpha) ──────────────────────────────────────────────

def make_icon(size=1024):
    img = Image.new('RGBA', (size, size), (*BG, 255))
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    r = int(size * 0.36)
    # subtle outer glow ring
    glow_r = int(r * 1.12)
    draw.ellipse([cx - glow_r, cy - glow_r, cx + glow_r, cy + glow_r], fill=(20, 100, 70, 90))
    draw_target(draw, cx, cy, r, (*GREEN, 255), (*BG, 255))
    draw_combo_streak(draw, cx, cy, r, (*PURPLE, 255))
    return img.convert('RGB')


def make_splash_logo(size=1024):
    img = new_rgba(size)
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    r = int(size * 0.36)
    glow_r = int(r * 1.12)
    draw.ellipse([cx - glow_r, cy - glow_r, cx + glow_r, cy + glow_r], fill=(20, 100, 70, 90))
    draw_target(draw, cx, cy, r, (*GREEN, 255), (*BG, 255))
    draw_combo_streak(draw, cx, cy, r, (*PURPLE, 255))
    return img


def make_adaptive_fg(size=512):
    img = new_rgba(size)
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    # 66% safe zone — keep target inside
    r = int(size * 0.32)
    draw_target(draw, cx, cy, r, (*GREEN, 255), (*BG, 255))
    draw_combo_streak(draw, cx, cy, r, (*PURPLE, 255))
    return img


def make_adaptive_bg(size=512):
    return Image.new('RGBA', (size, size), (*BG, 255))


def make_monochrome(size=432):
    img = new_rgba(size)
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    r = int(size * 0.34)
    # white target on transparent — Android tints this for themed icons
    draw_target(draw, cx, cy, r, (*WHITE, 255), TRANS)
    return img


def make_favicon(size=48):
    img = Image.new('RGBA', (size, size), (*BG, 255))
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    r = int(size * 0.40)
    draw_target(draw, cx, cy, r, (*GREEN, 255), (*BG, 255))
    return img.convert('RGB')


if __name__ == '__main__':
    os.makedirs(ASSETS, exist_ok=True)

    tasks = [
        ('icon.png',                    make_icon,        {}),
        ('splash-icon.png',             make_splash_logo, {}),
        ('android-icon-foreground.png', make_adaptive_fg, {}),
        ('android-icon-background.png', make_adaptive_bg, {}),
        ('android-icon-monochrome.png', make_monochrome,  {}),
        ('favicon.png',                 make_favicon,     {}),
    ]

    for filename, fn, kwargs in tasks:
        path = os.path.join(ASSETS, filename)
        img = fn(**kwargs)
        img.save(path)
        print(f'  + {filename:40s}  {img.size[0]}x{img.size[1]}  {img.mode}')

    print('\nAll assets written to assets/')
