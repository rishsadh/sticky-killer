"""Writes the three extension icons (a copper square with a dark bar pinned to the top)."""
import pathlib
import struct
import zlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "extension"
COPPER, INK = (217, 138, 94, 255), (20, 22, 25, 255)


def png(size):
    bar = max(3, size // 4)
    rows = []
    for y in range(size):
        px = INK if y < bar else COPPER
        rows.append(b"\x00" + bytes(px) * size)
    raw = b"".join(rows)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


for s in (16, 48, 128):
    (OUT / f"icon{s}.png").write_bytes(png(s))
    print("wrote", OUT / f"icon{s}.png")
