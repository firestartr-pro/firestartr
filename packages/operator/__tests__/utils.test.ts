import { buildCommandExecutionError } from "catalog_common/src/generic/command_error";

import { extractErrorDetails } from "../src/utils";

describe("operator utils", () => {
  it("prefers a non-empty error output string", () => {
    expect(
      extractErrorDetails({ output: "terraform failed", message: "fallback" }),
    ).toEqual({ output: "terraform failed", exitCode: undefined });
  });

  it("falls back to the error message when output is empty", () => {
    const error = buildCommandExecutionError("", 2, ["terraform"]);

    expect(extractErrorDetails(error)).toEqual({
      output: "Command 'terraform' failed with exit code 2",
      exitCode: 2,
    });
  });

  it("falls back to message for plain objects with empty output", () => {
    expect(
      extractErrorDetails({ output: "", message: "fallback", exitCode: 3 }),
    ).toEqual({ output: "fallback", exitCode: 3 });
  });

  it("returns the original string error", () => {
    expect(extractErrorDetails("plain error")).toEqual({
      output: "plain error",
      exitCode: undefined,
    });
  });
});
