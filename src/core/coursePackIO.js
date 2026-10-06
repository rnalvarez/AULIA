import { cloneCourse, validateCourse } from "./courseContract.js";

export const COURSE_PACK_VERSION = "1.0";

export function courseToPack(course) {
  return {
    format: "aulia-course-pack",
    version: COURSE_PACK_VERSION,
    exportedAt: new Date().toISOString(),
    assistant: cloneCourse(course.assistant || {}),
    course: {
      id: course.id,
      title: course.title,
      author: course.author,
      description: course.description || "",
      language: course.language || "es",
      level: course.level || "universitario",
    },
    bibliography: cloneCourse(course.bibliography || []),
    documents: cloneCourse(course.documents || []),
    pedagogicalUnits: cloneCourse(course.pedagogicalUnits || []),
    concepts: cloneCourse(course.concepts || []),
    examples: cloneCourse(course.examples || []),
    modes: cloneCourse(course.modes || []),
    activities: cloneCourse(course.activities || []),
    commissions: cloneCourse(course.commissions || []),
    tracking: cloneCourse(course.tracking || {}),
    corpus: cloneCourse(course.corpus || []),
    llm: cloneCourse(course.llm || null),
  };
}

export function packToCourse(pack) {
  if (!pack || pack.format !== "aulia-course-pack") {
    throw new Error("El archivo no parece ser un course pack de AULIA.");
  }

  const course = {
    ...(pack.course || {}),
    assistant: pack.assistant || {},
    bibliography: pack.bibliography || [],
    documents: pack.documents || [],
    pedagogicalUnits: pack.pedagogicalUnits || [],
    concepts: pack.concepts || [],
    examples: pack.examples || [],
    modes: pack.modes || [],
    activities: pack.activities || [],
    commissions: pack.commissions || pack.course?.commissions || [],
    tracking: pack.tracking || {},
    corpus: pack.corpus || [],
    llm: pack.llm || null,
  };

  const validation = validateCourse(course);
  if (!validation.valid) {
    throw new Error(validation.errors.join("\n"));
  }

  return course;
}

export function downloadCoursePack(course) {
  const blob = new Blob(
    [JSON.stringify(courseToPack(course), null, 2)],
    { type: "application/json;charset=utf-8" }
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${course.id || "curso"}-course-pack.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function readCoursePackFile(file) {
  const text = await file.text();
  return packToCourse(JSON.parse(text));
}
