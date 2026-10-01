import type { RegistryErrorDetails } from "./types.js";

const ERROR_NAME = "RegistryError";

/**
 * The single error type the loader throws. One run reports every collected
 * problem, and the JSON serialization never includes the stack or the
 * underlying filesystem exception.
 */
export class RegistryError extends Error {
  readonly code: RegistryErrorDetails["code"];
  readonly fix: string;
  readonly path: string;
  readonly problems: RegistryErrorDetails["problems"];

  constructor(details: RegistryErrorDetails) {
    super(details.message);
    this.name = ERROR_NAME;
    this.code = details.code;
    this.fix = details.fix;
    this.path = details.path;
    this.problems = details.problems;
  }

  toJSON(): RegistryErrorDetails {
    return {
      code: this.code,
      fix: this.fix,
      message: this.message,
      path: this.path,
      problems: this.problems,
    };
  }
}
