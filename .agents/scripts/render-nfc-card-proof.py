"""Render and inspect generated NFC card PDFs without contacting a service."""
import argparse
from pathlib import Path
import fitz

parser = argparse.ArgumentParser()
parser.add_argument("pdf")
parser.add_argument("--output", default="/tmp/nfc-card-proof")
args = parser.parse_args()
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)
document = fitz.open(args.pdf)
print(f"Pages: {len(document)}")
for index, page in enumerate(document):
    print(f"Page {index + 1}: {page.rect.width * 25.4 / 72:.2f} × "
          f"{page.rect.height * 25.4 / 72:.2f} mm")
    print(page.get_text())
    page.get_pixmap(dpi=300).save(output / f"page-{index + 1}.png")