export type JsonValue = string | number | boolean | JsonValue[] | { [key: string]: JsonValue };

export type RegistryDigest = `sha256:${string}`;

export type RouteLabel = string;

export type RegistryErrorCode =
  | "registry-missing"
  | "registry-unreadable"
  | "format-missing"
  | "format-unsupported"
  | "registry-invalid"
  | "label-duplicate"
  | "reference-unknown"
  | "rating-mismatch";

export interface Route {
  harness: string;
  modelId: string;
  provider?: string;
  hosted: boolean;
  privacyEligible?: boolean;
  cost?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  rateLimitRpm?: number;
  responseSeconds?: number;
  notes?: string;
}

export interface Model {
  family: string;
  notes?: string;
  routes: Route[];
}

export interface RegistryFacts {
  models: Record<string, Model>;
}

export interface RegistryFile {
  format: 1;
  models: Record<string, Model>;
}

export type IndexedRoute = Route & { model: string };

export interface LoadedRegistry {
  format: 1;
  digest: RegistryDigest;
  path: string;
  registry: RegistryFacts;
  routes: Record<RouteLabel, IndexedRoute>;
  sections: Record<string, JsonValue>;
}

export interface LoadRegistryOptions {
  path?: string;
}

export interface RegistryProblem {
  code: RegistryErrorCode;
  field: string;
  message: string;
  fix: string;
}

export interface RegistryErrorDetails {
  code: RegistryErrorCode;
  message: string;
  fix: string;
  path: string;
  problems: RegistryProblem[];
}
