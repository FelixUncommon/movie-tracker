# Draws a gold cinema ticket on a dark background, as PNG, using only the standard library.
import math, struct, sys, zlib

BG = (0x12, 0x10, 0x14)
GOLD = (0xE8, 0xB0, 0x4A)

def inside_ticket(x, y):
    # rotate the point by +12 degrees around the centre (so the ticket appears tilted -12)
    a = math.radians(12)
    cx, cy = x - 0.5, y - 0.5
    x, y = cx * math.cos(a) - cy * math.sin(a) + 0.5, cx * math.sin(a) + cy * math.cos(a) + 0.5
    x0, x1, y0, y1, r = 0.15, 0.85, 0.31, 0.69, 0.05
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    # rounded corners
    for qx, qy in ((x0 + r, y0 + r), (x1 - r, y0 + r), (x0 + r, y1 - r), (x1 - r, y1 - r)):
        if (x < x0 + r or x > x1 - r) and (y < y0 + r or y > y1 - r):
            if math.hypot(x - qx, y - qy) > r and abs(x - qx) <= r and abs(y - qy) <= r:
                return False
    # side notches
    if math.hypot(x - x0, y - 0.5) < 0.065 or math.hypot(x - x1, y - 0.5) < 0.065:
        return False
    # perforation: a column of small holes
    px = 0.64
    if abs(x - px) < 0.016:
        k = round((y - 0.355) / 0.058)
        if 0 <= k <= 5 and math.hypot(x - px, y - (0.355 + k * 0.058)) < 0.014:
            return False
    # a star on the main part of the ticket
    if in_polygon(x, y, STAR):
        return False
    return True

def star_points(cx, cy, R, r):
    pts = []
    for k in range(10):
        rad = R if k % 2 == 0 else r
        a = -math.pi / 2 + k * math.pi / 5
        pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
    return pts

def in_polygon(x, y, pts):
    inside = False
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside

STAR = star_points(0.40, 0.51, 0.115, 0.047)

def render(size, ss=3):
    rows = []
    for j in range(size):
        row = bytearray([0])
        for i in range(size):
            hits = 0
            for sj in range(ss):
                for si in range(ss):
                    if inside_ticket((i + (si + 0.5) / ss) / size, (j + (sj + 0.5) / ss) / size):
                        hits += 1
            f = hits / (ss * ss)
            row += bytes(round(BG[c] + (GOLD[c] - BG[c]) * f) for c in range(3))
        rows.append(bytes(row))
    raw = b"".join(rows)
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

out = sys.argv[1]
for size in (180, 192, 512):
    open(f"{out}/icon-{size}.png", "wb").write(render(size))
print("ok")
