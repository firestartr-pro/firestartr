import * as fs from "fs"
import * as path from "path"
import common from "catalog_common"

export function loadYaml(filePath:string){

  return common.io.fromYaml(fs.readFileSync(filePath, 'utf-8'))

}

export function loadYamlFixture(relativePath:string){

  return loadYaml(path.join(__dirname, relativePath))

}
