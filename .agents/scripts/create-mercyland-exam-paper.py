"""Approved Development English paper: verify its 60 marks before producing PDFs."""
from pathlib import Path
import fitz

out = Path("outputs/mercyland-exam-acceptance")
out.mkdir(parents=True, exist_ok=True)
sections = [
    ("Section A - Grammar and Usage (20 marks)", [
        "Circle the correct word: (A / An) apple.",
        "Circle the correct word: I (am / is) happy.",
        "Circle the correct word: She (is / are) a girl.",
        "Circle the correct word: Two (cat / cats) are playing.",
        "Circle the correct word: The boy (has / have) a book.",
        "Circle the correct word: We (is / are) friends.",
        "Circle the naming word: (cup / run).",
        "Circle the action word: (jump / chair).",
        "Circle the correct capital letter to begin a name: (a / A).",
        "Circle the greeting used in the morning: (Good morning / Good night).",
    ], 2),
    ("Section B - Vocabulary and Comprehension (20 marks)", [
        "Circle the opposite of big: (small / tall).",
        "Circle the opposite of hot: (cold / warm).",
        "Circle the colour word: (red / bed).",
        "Circle the animal word: (cat / cap).",
        "Circle the word for something we write with: (pen / pot).",
        "Read the story. What is the girl's name?",
        "What colour is Ada's bag?",
        "What does Ada put in her bag?",
        "Where does Ada go?",
        "Who does Ada greet?",
    ], 2),
    ("Section C - Written English (20 marks)", [
        "Copy neatly: I can read and write.",
        "Write these words neatly: cat, sun, bag, pen, book.",
    ], 10),
]
marks = [mark for _, questions, mark in sections for _ in questions]
assert len(marks) == 22 and sum(marks) == 60

def make_paper(corrected):
    doc = fitz.open()
    number = 1
    for section_index, (title, questions, mark) in enumerate(sections):
        page = doc.new_page(width=595, height=842)
        logo = Path("/tmp/mercyland-school-logo")
        if logo.exists():
            page.insert_image(fitz.Rect(40, 28, 96, 84), stream=logo.read_bytes(), keep_proportion=True)
        page.insert_text((120, 45), "Mercyland school", fontsize=18, fontname="hebo")
        page.insert_text((120, 65), "2026/2027 - First Term", fontsize=11)
        page.insert_text((40, 108), "Prep 1/A - English Language Examination", fontsize=14, fontname="hebo")
        page.insert_text((40, 131), "Total Marks: 60", fontsize=12, fontname="hebo")
        instruction = ("Answer all 22 questions. Circle one answer in Section A and Questions 11-15. "
                       "Answer Questions 16-20 using the story. Complete both writing tasks."
                       if corrected else "Answer all questions. Read each section carefully.")
        page.insert_textbox(fitz.Rect(40, 145, 555, 189), instruction, fontsize=10)
        page.insert_text((40, 210), title, fontsize=13, fontname="hebo")
        y = 235
        if section_index == 1:
            story = "Story: Ada has a red bag. She puts a book in her bag. Ada goes to school. She greets her teacher."
            page.insert_textbox(fitz.Rect(40, y, 555, y+40), story, fontsize=11)
            y += 54
        for question in questions:
            if corrected and number == 22:
                question += " Award 2 marks for each correctly copied word (5 words x 2 marks)."
            lines = f"{number}. {question} [{mark} marks]"
            height = 43 if section_index != 2 else 76
            result = page.insert_textbox(fitz.Rect(40, y, 555, y+height), lines, fontsize=11)
            assert result >= 0, f"Question {number} overflowed"
            y += height + (3 if section_index != 2 else 10)
            if section_index == 2:
                for _ in range(4):
                    page.draw_line(fitz.Point(42, y), fitz.Point(550, y), color=(0.55,0.55,0.55))
                    y += 28
            number += 1
        page.insert_text((40, 809), f"Development acceptance paper - Page {section_index+1} of 3", fontsize=9)
    filename = out / ("mercyland-prep1-english-corrected-60-marks.pdf" if corrected else "mercyland-prep1-english-draft-60-marks.pdf")
    doc.save(filename)
    text = "\n".join(page.get_text() for page in doc)
    assert text.count("[2 marks]") == 20 and text.count("[10 marks]") == 2
    print(f"{filename}: 22 questions; allocated marks = {sum(marks)}")
    if corrected:
        doc[0].get_pixmap(matrix=fitz.Matrix(1.2,1.2)).save("/tmp/mercyland-corrected-paper-page1.png")

make_paper(False)
make_paper(True)
