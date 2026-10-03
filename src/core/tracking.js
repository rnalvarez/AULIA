export function createInteractionEvent({
  courseId,
  modeId,
  question,
  response,
  retrievedIds = [],
  studentId = null,
  sessionId = null,
  activityId = null,
}) {
  return {
    eventId: crypto.randomUUID(),
    ts: new Date().toISOString(),
    courseId,
    studentId,
    sessionId,
    modeId,
    activityId,
    question,
    response,
    retrievedIds,
  };
}
