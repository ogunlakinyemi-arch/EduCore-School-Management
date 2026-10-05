"""Render uploaded acceptance documents privately; do not infer business values."""
import sys
from pathlib import Path
import fitz

out = Path("/tmp/exam-acceptance-pdfs")
out.mkdir(parents=True, exist_ok=True)
for index, filename in enumerate(sys.argv[1:], start=1):
    doc = fitz.open(filename)
    print(f"Document {index}: {doc.page_count} pages")
    for page_index in range(min(doc.page_count, 4)):
        path = out / f"document-{index}-page-{page_index + 1}.png"
        doc[page_index].get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(path)
        print(path)
