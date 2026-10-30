import type { Option } from "@clack/prompts";
import * as clack from "@clack/prompts";

/** Thrown when the user cancels a prompt. The wizard writes nothing after it. */
export class InitCancelled extends Error {
  constructor() {
    super("the init wizard was cancelled");
    this.name = "InitCancelled";
  }
}

export interface InitPromptOption<T> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
}

export interface InitSpinner {
  start(message: string): void;
  stop(message: string): void;
}

export interface InitMultiselectRequest<T> {
  readonly message: string;
  readonly options: readonly InitPromptOption<T>[];
  readonly initialValues: readonly T[];
  /** True when the prompt refuses an empty selection. */
  readonly required?: boolean;
}

export interface InitSelectRequest<T> {
  readonly message: string;
  readonly options: readonly InitPromptOption<T>[];
  readonly initialValue?: T;
}

export interface InitConfirmRequest {
  readonly message: string;
  readonly initialValue?: boolean;
}

export interface InitTextRequest {
  readonly message: string;
  readonly placeholder?: string;
  /** Returns an error message, or undefined when the value is accepted. */
  readonly validate?: (value: string) => string | undefined;
}

export interface InitPasswordRequest {
  readonly message: string;
}

/**
 * The wizard's terminal UI, behind an interface so the flow can be driven
 * by scripted answers with no terminal at all. Every method that waits for
 * an answer throws {@link InitCancelled} when the user cancels.
 */
export interface InitPrompts {
  intro(message: string): void;
  outro(message: string): void;
  /** Prints the closing line of a cancelled wizard. */
  cancel(message: string): void;
  /** Runs a group of prompts under one heading. */
  group<T>(label: string, body: () => Promise<T>): Promise<T>;
  multiselect<T>(request: InitMultiselectRequest<T>): Promise<T[]>;
  select<T>(request: InitSelectRequest<T>): Promise<T>;
  confirm(request: InitConfirmRequest): Promise<boolean>;
  text(request: InitTextRequest): Promise<string>;
  password(request: InitPasswordRequest): Promise<string>;
  spinner(): InitSpinner;
}

function checkCancel(value: unknown): void {
  if (clack.isCancel(value)) {
    throw new InitCancelled();
  }
}

function options<T>(values: readonly InitPromptOption<T>[]): Option<T>[] {
  return values.map((option) => ({
    value: option.value,
    label: option.label,
    ...(option.hint === undefined ? {} : { hint: option.hint }),
  })) as Option<T>[];
}

/** The real wizard UI, built on `@clack/prompts`. */
export function clackPrompts(): InitPrompts {
  return {
    intro(message: string): void {
      clack.intro(message);
    },
    outro(message: string): void {
      clack.outro(message);
    },
    cancel(message: string): void {
      process.stdout.write(`${message}\n`);
    },
    async group<T>(label: string, body: () => Promise<T>): Promise<T> {
      clack.log.step(label);
      return body();
    },
    async multiselect<T>(request: InitMultiselectRequest<T>): Promise<T[]> {
      const answer = await clack.multiselect<T>({
        message: request.message,
        options: options(request.options),
        initialValues: [...request.initialValues],
        required: request.required === true,
      });
      checkCancel(answer);
      return answer as T[];
    },
    async select<T>(request: InitSelectRequest<T>): Promise<T> {
      const answer = await clack.select<T>({
        message: request.message,
        options: options(request.options),
        ...(request.initialValue === undefined ? {} : { initialValue: request.initialValue }),
      });
      checkCancel(answer);
      return answer as T;
    },
    async confirm(request: InitConfirmRequest): Promise<boolean> {
      const answer = await clack.confirm({
        message: request.message,
        ...(request.initialValue === undefined ? {} : { initialValue: request.initialValue }),
      });
      checkCancel(answer);
      return answer as boolean;
    },
    async text(request: InitTextRequest): Promise<string> {
      const answer = await clack.text({
        message: request.message,
        ...(request.placeholder === undefined ? {} : { placeholder: request.placeholder }),
        ...(request.validate === undefined
          ? {}
          : { validate: (value: string | undefined) => request.validate?.(value ?? "") }),
      });
      checkCancel(answer);
      return answer as string;
    },
    async password(request: InitPasswordRequest): Promise<string> {
      const answer = await clack.password({ message: request.message });
      checkCancel(answer);
      return answer as string;
    },
    spinner(): InitSpinner {
      const handle = clack.spinner();
      return {
        start(message: string): void {
          handle.start(message);
        },
        stop(message: string): void {
          handle.stop(message);
        },
      };
    },
  };
}
