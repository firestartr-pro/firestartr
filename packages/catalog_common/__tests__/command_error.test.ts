import {
  buildCommandExecutionError,
  normalizeExitCode,
} from "../src/generic/command_error";

describe("command error helpers", () => {
  it("builds an error with fallback message and metadata", () => {
    const error = buildCommandExecutionError("", 2, ["terraform", "plan"]);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("CommandExecutionError");
    expect(error.message).toBe("Command 'terraform plan' failed with exit code 2");
    expect(error).toMatchObject({
      command: ["terraform", "plan"],
      exitCode: 2,
      output: "",
    });
  });

  it("uses the provided output, name, and label", () => {
    const error = buildCommandExecutionError("terraform failed", 1, ["terraform"], {
      errorName: "TerraformCommandError",
      label: "Terraform command",
    });

    expect(error.name).toBe("TerraformCommandError");
    expect(error.message).toBe("terraform failed");
    expect(error.output).toBe("terraform failed");
  });

  it("preserves numeric exit codes", () => {
    expect(normalizeExitCode(0)).toBe(0);
    expect(normalizeExitCode(12)).toBe(12);
  });

  it("converts null exit codes to -1", () => {
    expect(normalizeExitCode(null)).toBe(-1);
  });
});
