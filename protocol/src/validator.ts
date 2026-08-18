import Ajv2020Module, { type ValidateFunction } from "ajv/dist/2020.js";
import type { Options } from "ajv";
import schema from "../schemas/control-v1.schema.json" with { type: "json" };

type AjvInstance = {
  compile: (value: object) => ValidateFunction;
  errorsText: (errors?: ValidateFunction["errors"], options?: { separator?: string }) => string;
};
const Ajv2020 = Ajv2020Module as unknown as new (options?: Options) => AjvInstance;
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate: ValidateFunction = ajv.compile(schema);

export function validateProtocolMessage(value: unknown): boolean {
  return validate(value) as boolean;
}

export function protocolValidationErrors(): string {
  return ajv.errorsText(validate.errors, { separator: "; " });
}
