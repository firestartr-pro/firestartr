import { crawl, crawlWithExclusions } from "../src/crawler";
import * as path from "path";

describe("The crawler", () => {

  const FOLDER_PATH: string = path.join(__dirname, "fixtures", "crawler");

  const SUBFOLDER1_PATH: string = path.join(
    __dirname, "fixtures", "crawler", "subfolder1"
  );

  it("can correctly crawl a folder", async () => {

    const filesToBeFound: string[] = [
      path.join(SUBFOLDER1_PATH, "file1.txt"),
      path.join(SUBFOLDER1_PATH, "subfolder2c", "file2.yaml"),
      path.join(SUBFOLDER1_PATH, "subfolder2c", "file3.bin"),
      path.join(SUBFOLDER1_PATH, "subfolder2a", "subfolder3", "file4.txt"),
      path.join(
        SUBFOLDER1_PATH, "subfolder2b", "subfolder4", "subfolder5", "file5.zip"
      ),
    ]

    const filesFound: any[] = [];

    await crawl(

      FOLDER_PATH,
      () => true,
      (fileName: any) => {
        filesFound.push(fileName);
      }

    );

    expect(filesFound.sort()).toEqual(filesToBeFound.sort());

  });

  it("can correctly crawl a folder and filter files", async () => {

    const filesToBeFound: string[] = [
      path.join(SUBFOLDER1_PATH, "file1.txt"),
      path.join(SUBFOLDER1_PATH, "subfolder2a", "subfolder3", "file4.txt"),
    ]

    const filesFound: any[] = [];

    await crawl(

      FOLDER_PATH,
      (fileName: string) => fileName.endsWith(".txt"),
      (fileName: string) => {
        filesFound.push(fileName);
      }

    );

    expect(filesFound.sort()).toEqual(filesToBeFound.sort());

  });

  it("can correctly crawl a folder and apply exclusions", async () => {

    const filesToBeFound: string[] = [
      path.join(SUBFOLDER1_PATH, "file1.txt"),
      path.join(SUBFOLDER1_PATH, "subfolder2c", "file2.yaml"),
      path.join(SUBFOLDER1_PATH, "subfolder2c", "file3.bin"),
    ]

    const pathsToExclude: string[] = [
      path.join(FOLDER_PATH, "subfolder1", "subfolder2a"),
      path.join(FOLDER_PATH, "subfolder1", "subfolder2b"),
    ]

    const filesFound: any[] = [];

    await crawlWithExclusions(

      FOLDER_PATH,
      () => true,
      (fileName: any) => {
        filesFound.push(fileName);
      },
      pathsToExclude

    );

    expect(filesFound.sort()).toEqual(filesToBeFound.sort());

  });

  it("visits files in sorted (deterministic) order", async () => {
    const filesFound: string[] = [];

    await crawl(
      FOLDER_PATH,
      () => true,
      (fileName: string) => {
        filesFound.push(fileName);
      }
    );

    const sorted = [...filesFound].sort();
    expect(filesFound).toEqual(sorted);
  });

  it("includes the directory when crawling fails", async () => {
    await expect(
      crawl(FOLDER_PATH, () => true, (fileName: string) => {
        if (fileName.endsWith("file2.yaml")) {
          throw new Error("test failure");
        }
      }),
    ).rejects.toBe(
      `Crawling ${FOLDER_PATH}: crawlDirectory: crawlDirectory: crawlDirectory: Error: test failure on ${path.join(
        SUBFOLDER1_PATH,
        "subfolder2c",
      )} on ${SUBFOLDER1_PATH} on ${FOLDER_PATH}`,
    );
  });

});
