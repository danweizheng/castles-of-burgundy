"""探测规则书 PDF 能否抽取文本。

环境里没有任何 PDF 工具（pdftotext / PyMuPDF / pypdf 都没有），所以先用最原始的办法：
直接按字节扫 PDF，看有没有字体对象、图片对象、ToUnicode 映射，以及能否把
FlateDecode 的流解压出来并找到文本绘制算符（BT/ET/Tj/TJ）。

输出刻意全用 ASCII，避免 Windows 控制台编码把中文糊掉。
"""

from __future__ import annotations

import re
import zlib

PDF_PATH = r"E:\CastlesOfBurgundy\rules\CoB_Rulebook_285x210mm [28 pages].pdf"


def main() -> None:
    with open(PDF_PATH, "rb") as handle:
        data = handle.read()

    print("file_size_bytes:", len(data))
    print("count_/Font:", data.count(b"/Font"))
    print("count_/Image:", data.count(b"/Image"))
    print("count_/XObject:", data.count(b"/XObject"))
    print("count_/ToUnicode:", data.count(b"/ToUnicode"))
    print("count_/Encoding:", data.count(b"/Encoding"))
    print("count_/FlateDecode:", data.count(b"/FlateDecode"))
    print("count_/DCTDecode:", data.count(b"/DCTDecode"))
    print("count_/JPXDecode:", data.count(b"/JPXDecode"))
    print("count_/CCITTFaxDecode:", data.count(b"/CCITTFaxDecode"))
    print("count_/Type/Page:", data.count(b"/Type/Page"), data.count(b"/Type /Page"))
    print("count_/Subtype/Image:", data.count(b"/Subtype/Image"), data.count(b"/Subtype /Image"))
    print("header:", data[:16])

    streams = 0
    inflated = 0
    text_streams = 0
    samples: list[bytes] = []

    for match in re.finditer(rb"stream\r?\n", data):
        start = match.end()
        end = data.find(b"endstream", start)
        if end == -1:
            continue
        streams += 1
        raw = data[start:end]
        try:
            out = zlib.decompress(raw)
        except Exception:
            continue
        inflated += 1
        if b"BT" in out and (b"Tj" in out or b"TJ" in out):
            text_streams += 1
            if len(samples) < 3:
                samples.append(out[:600])

    print("streams_found:", streams)
    print("streams_inflated:", inflated)
    print("streams_with_text_ops:", text_streams)

    for index, sample in enumerate(samples):
        print(f"--- sample {index} (first 600 bytes) ---")
        printable = bytes(byte if 32 <= byte < 127 else 46 for byte in sample)
        print(printable.decode("ascii"))


if __name__ == "__main__":
    main()
