"""One-off generator for the extension's PNG icons (no external deps)."""
import struct
import zlib
import math
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT_DIR, exist_ok=True)

BG = (217, 119, 87)     # clay/orange
FACE = (255, 250, 244)  # warm white
HAND = (60, 40, 30)     # dark brown


def make_icon(size):
    cx = cy = size / 2
    radius = size * 0.40
    hand_len = size * 0.27
    hand_angle = math.radians(-45)  # pointing to ~1:30, evokes "time left"
    hand_x = cx + hand_len * math.sin(hand_angle)
    hand_y = cy - hand_len * math.cos(hand_angle)

    pixels = []
    for y in range(size):
        row = []
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            d = math.hypot(px - cx, py - cy)
            if d <= radius:
                # distance from the hand line segment (cx,cy)-(hand_x,hand_y)
                t = ((px - cx) * (hand_x - cx) + (py - cy) * (hand_y - cy))
                seg_len2 = (hand_x - cx) ** 2 + (hand_y - cy) ** 2
                t = max(0, min(1, t / seg_len2)) if seg_len2 else 0
                proj_x = cx + t * (hand_x - cx)
                proj_y = cy + t * (hand_y - cy)
                hand_dist = math.hypot(px - proj_x, py - proj_y)
                if hand_dist <= max(1.0, size * 0.035) or d <= radius * 0.08:
                    row.append(HAND + (255,))
                else:
                    row.append(FACE + (255,))
            else:
                row.append(BG + (255,))
        pixels.append(row)
    return pixels


def write_png(path, pixels):
    size = len(pixels)
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # no filter
        for (r, g, b, a) in row:
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig)
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", idat))
        f.write(chunk(b"IEND", b""))


for sz in (16, 48, 128):
    write_png(os.path.join(OUT_DIR, f"icon{sz}.png"), make_icon(sz))

print("icons written to", OUT_DIR)
