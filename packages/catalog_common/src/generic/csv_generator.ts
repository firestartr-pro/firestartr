import { stringify } from 'csv-stringify';
import * as fs from 'fs';

class CsvWriter {
  useHeaders = true;
  columns: string[] = [];
  data: string[][] = [];

  constructor(columns: string[] = [], useHeaders = true) {
    if (useHeaders && columns.length < 1) {
      throw 'CSV headers must be defined';
    }

    if (columns && Array.isArray(columns)) {
      this.columns = columns;
    }

    this.useHeaders = useHeaders;
  }

  addEntry(entry: string[]) {
    if (this.useHeaders && entry.length !== this.columns.length) {
      throw 'Entry fields count is different than headers';
    }
    this.data.push(entry);
  }

  async generateCsvOutput(): Promise<string> {
    const columns = this.columns;
    const records = this.data;

    return new Promise((resolve, reject) => {
      stringify(
        records,
        { header: this.useHeaders, columns, delimiter: ';' },
        (err: any, output: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(output);
          }
        },
      );
    });
  }

  async writeCsvToFile(destination: string) {
    // Get CSV contents
    const fileContents = await this.generateCsvOutput();

    fs.writeFileSync(destination, fileContents);
  }

  toTable() {
    const result: any[] = this.data.map((item) => {
      const obj: any = {};
      this.columns.forEach((key, index) => {
        obj[key] = item[index];
      });
      return obj;
    });
    return result;
  }
}

export default CsvWriter;
