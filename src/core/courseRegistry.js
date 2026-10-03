import { validateCourse } from "./courseContract.js";

const courseFiles = import.meta.glob("../courses/*/*.json", {
  eager: true,
  query: "?json",
  import: "default",
});

function buildRegistry() {
  const packs = {};

  for (const [path, data] of Object.entries(courseFiles)) {
    const match = path.match(/\/courses\/([^/]+)\/([^/]+)\.json$/);
    if (!match) continue;

    const [, folder, file] = match;
    if (folder.startsWith("_")) continue;

    if (!packs[folder]) packs[folder] = {};
    packs[folder][file] = data;
  }

  return Object.entries(packs)
    .map(([folder, pack]) => {
      const requiredFiles = ["course", "bibliography", "concepts", "modes", "activities", "examples", "tracking"];
      const missingFiles = requiredFiles.filter((file) => !(file in pack));
      if (missingFiles.length) {
        console.warn(
          `AULIA: se omitió el curso "${folder}" porque faltan archivos: ${missingFiles.join(", ")}`
        );
        return null;
      }

      const course = {
        ...(pack["course"] || {}),
        bibliography: pack["bibliography"],
        concepts: pack["concepts"],
        modes: pack["modes"],
        activities: pack["activities"],
        examples: pack["examples"],
        tracking: pack["tracking"],
        assistant: pack["assistant"] || {
          name: course?.title || "Asistente pedagógico",
          shortTitle: course?.title || "Asistente pedagógico",
          initials: "AI",
          welcomeMessage: "Elegí una modalidad para comenzar.",
          suggestions: [],
        },
        _folder: folder,
      };

      const validation = validateCourse(course);
      if (!validation.valid) {
        console.warn(
          `AULIA: se omitió el curso "${folder}" porque no cumple el contrato:`,
          validation.errors
        );
        return null;
      }

      return course;
    })
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title, "es"));
}

export const COURSE_REGISTRY = buildRegistry();
