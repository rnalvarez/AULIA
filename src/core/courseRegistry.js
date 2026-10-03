import course from "../courses/chion/course.json";
import concepts from "../courses/chion/concepts.json";
import bibliography from "../courses/chion/bibliography.json";
import modes from "../courses/chion/modes.json";
import activities from "../courses/chion/activities.json";
import examples from "../courses/chion/examples.json";
import tracking from "../courses/chion/tracking.json";

export const COURSE_REGISTRY = [
  {
    ...course,
    bibliography,
    concepts,
    modes,
    activities,
    examples,
    tracking,
  },
];
