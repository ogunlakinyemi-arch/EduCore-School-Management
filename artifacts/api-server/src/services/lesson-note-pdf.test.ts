import { describe,it,expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { validateLessonPdfBytes,validateLessonPdfMetadata,lessonDocumentContext } from "./lesson-note-pdf";
import { lessonTeachingScope } from "./lesson-teaching-scope";

describe("Lesson-note PDF validation and context",()=>{
  it("accepts a genuine one-page PDF without changing the original bytes",async()=>{
    const pdf=await PDFDocument.create();pdf.addPage();
    const bytes=Buffer.from(await pdf.save()),original=Buffer.from(bytes);
    await validateLessonPdfBytes(bytes);
    expect(bytes.equals(original)).toBe(true);
  });
  it("rejects renamed text, forged PDF headers and damaged files",async()=>{
    for(const bytes of [Buffer.from("not a PDF"),Buffer.from("%PDF-1.4\nfake contents\n%%EOF"),
      Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj")])
      await expect(validateLessonPdfBytes(bytes)).rejects.toThrow();
  });
  it("rejects zero-page files and the exact oversized boundary",async()=>{
    const empty=Buffer.from(await (await PDFDocument.create()).save({addDefaultPage:false}));
    await expect(validateLessonPdfBytes(empty)).rejects.toThrow();
    expect(()=>validateLessonPdfMetadata("valid.pdf",10485761)).toThrow();
    expect(validateLessonPdfMetadata("valid.pdf",10485760).size).toBe(10485760);
    for(const filename of ["../note.pdf","note.doc","note.pdf\n"])expect(()=>validateLessonPdfMetadata(filename,10)).toThrow();
  });
  it("pins school, teacher and all academic/topic associations without inferring anything from bytes",()=>{
    const context=lessonDocumentContext({schoolId:1,teacherId:2,sessionId:3,termId:4,classId:5,subjectId:6,section:"A",topicId:7});
    expect(context).toMatchObject({schoolId:1,teacherId:2,sessionId:3,termId:4,classId:5,subjectId:6,section:"A",topicId:7,curriculumVersionId:null});
  });
  it("reuses staffing-only, explicit enrollment, wildcard and date predicates",()=>{
    const sql=lessonTeachingScope(["school","session","term","class","subject","employee","section"]);
    expect(sql).toContain("NOT EXISTS(SELECT 1 FROM class_subjects existing");
    expect(sql).toContain("assigned.assignment_type='SUBJECT_TEACHER'");
    expect(sql).toContain("ta.assignment_type<>'SUBJECT_TEACHER'");
    expect(sql).toContain("ta.section='' OR ta.section=(section)");
    expect(sql).toContain("ta.start_date<=");
    expect(sql).not.toMatch(/\$\d/);
  });
});
