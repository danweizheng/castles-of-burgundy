"""从规则书 PDF 里抽取文本。

优先用文本层；如果某一页没有文本层（纯图片扫描页），就记录该页图片数量，
后续改为把该页图片交给视觉模型识别。
"""

from __future__ import annotations

import os

from pypdf import PdfReader

PDF_PATH = r"E:\CastlesOfBurgundy\rules\CoB_Rulebook_285x210mm [28 pages].pdf"
OUT_DIR = r"E:\CastlesOfBurgundy\rules"
TEXT_OUT = os.path.join(OUT_DIR, "rulebook-text.txt")
IMG_OUT = os.path.join(OUT_DIR, "pages")


def main() -> None:
    reader = PdfReader(PDF_PATH)
    print("pages:", len(reader.pages))

    chunks: list[str] = []
    os.makedirs(IMG_OUT, exist_ok=True)

    for index, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
        except Exception as error:  # noqa: BLE001
            text = ""
            print(f"page {index + 1}: extract_text failed: {error}")

        images = []
        try:
            images = list(page.images)
        except Exception as error:  # noqa: BLE001
            print(f"page {index + 1}: images failed: {error}")

        cleaned = text.strip()
        printable = sum(1 for ch in cleaned if ch.isprintable() and ch not in "\x00")
        print(f"page {index + 1}: chars={len(cleaned)} printable={printable} images={len(images)}")

        chunks.append(f"\n\n===== PAGE {index + 1} =====\n{cleaned}")

        # 文本层为空或极少时，把该页最大的图片导出来，留给视觉模型
        if printable < 40 and images:
            biggest = max(
                images,
                key=lambda item: len(getattr(item, "data", b"") or b""),
                default=None,
            )
            if biggest is not None and getattr(biggest, "data", None):
                name = getattr(biggest, "name", f"page-{index + 1}.jpg") or f"page-{index + 1}.jpg"
                safe = name.replace("/", "_").replace("\\", "_")
                path = os.path.join(IMG_OUT, f"p{index + 1:02d}-{safe}")
                with open(path, "wb") as handle:
                    handle.write(biggest.data)
                print(f"    -> exported image {os.path.basename(path)} ({len(biggest.data)} bytes)")

    with open(TEXT_OUT, "w", encoding="utf-8") as handle:
        handle.write("".join(chunks))
    print("text written to", TEXT_OUT)


if __name__ == "__main__":
    main()
