/** Only SQL identifiers, never values or expressions, may cross this boundary. */
export function safeIdentifier(value) {
  if (typeof value !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value) ||
      /[^a-zA-Z0-9_]/.test(value)) {
    throw new Error("Unsafe database identifier");
  }
  return `"${value}"`;
}
