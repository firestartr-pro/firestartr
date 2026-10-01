import CsvWriter from "../src/generic/csv_generator";
import * as fs from "fs";

// CSV generator with data
const csvGenerator = new CsvWriter(["Kind", "Name", "Details"], true);
csvGenerator.addEntry(["component", "catalog", "no details"]);
csvGenerator.addEntry(["team", "platform-team", "imported"]);
csvGenerator.addEntry(["user", "example", "no details"]);

// Expected output for tests
const expectedOutput = `Kind;Name;Details
component;catalog;no details
team;platform-team;imported
user;example;no details
`;

test("Generate CSV code", async () => {
  const output = await csvGenerator.generateCsvOutput();
  expect(output).toEqual(expectedOutput);
});

test("Write CSV file", async () => {
  // Write file to disk
  const filePath = `/tmp/tst_csv_${new Date().getTime().toString()}.csv`;

  await csvGenerator.writeCsvToFile(filePath);

  const fileContents = fs.readFileSync(filePath, "utf-8");

  expect(fileContents).toEqual(expectedOutput);
});

test("Exception with incorrect number of fields", () => {
  expect.assertions(1);
  try {
    csvGenerator.addEntry(["one", "two", "three", "four", "five", "six"]);
  } catch (e) {
    expect(e).toMatch("Entry fields count is different than headers");
  }
});

test("Constructor excetion: when using headers almost one must be defined", () => {
  expect.assertions(1);
  try {
    new CsvWriter([], true);
  } catch (e) {
    expect(e).toMatch("CSV headers must be defined");
  }
});
