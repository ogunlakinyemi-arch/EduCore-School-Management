/** Academic routes can return either a string error or a structured error. */
export function academicSaveError(error: unknown, fallback = 'Could not save this academic record.'): string {
  const problem = error as {
    data?: { error?: string | { message?: string }; message?: string };
    message?: string;
  } | null;
  const detail = problem?.data?.error;
  for (const message of [
    typeof detail === 'string' ? detail : detail?.message,
    problem?.data?.message,
    problem?.message,
  ]) {
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}