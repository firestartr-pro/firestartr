import { ImportInitializer } from "../src/initializers/import";
import { ICustomResourcePatch } from "../src/patches";
import common from 'catalog_common';

class Doppleman {

  claim: any = {};
  previousCr: any = {};
  patches: ICustomResourcePatch[] = [];
  data: any = {};

  get(k: string): any { return this.data[k]; }
  set(k: string, v: any) { this.data[k] = v; }

  constructor(claim: any, previousCr: any, patches: ICustomResourcePatch[]) {
    this.claim = claim
    this.previousCr = previousCr
    this.patches = patches
  }

  async render() {
    const fClone = (obj: any) => JSON.parse(JSON.stringify(obj));
    let cr = fClone(this.previousCr)

    for (const patch of this.patches) {
      patch.ctx = () => this.ctx();
      cr = await patch.apply(cr)
      patch.validate(cr)
    }

    return cr
  }

  ctx() {
    const provider = this.get("provider") ?? "doppleman"
    const kind = this.get("kind") ?? "k8s-doppleman"

    return {
      get kind() { return kind },
      get provider() { return provider },
    }
  }

}

describe('The import initializer', () => {
  it("creates the import label when it doesn't exist", async () => {
    const templateCr = {
      metadata: { name: "Awesome-Project" },
    }

    const ImportInitializerPatches = await new ImportInitializer().patches({}, {});
    const doppleman = new Doppleman({}, templateCr, ImportInitializerPatches);

    const githubEntity = await doppleman.render()
    expect(githubEntity.metadata.annotations[
      common.generic.getFirestartrAnnotation("import")
    ]).toEqual("true");
  });

  it("maintains the annotations' value if it already exists", async () => {
    const templateCr = {
      metadata: { annotations: { "firestartr.dev/import": "test-value" } },
    }

    const ImportInitializerPatches = await new ImportInitializer().patches({}, {});
    const doppleman = new Doppleman({}, templateCr, ImportInitializerPatches);

    const githubEntity = await doppleman.render()
    expect(githubEntity.metadata.annotations[
      common.generic.getFirestartrAnnotation("import")
    ]).toEqual("test-value");
  });

  it("correctly validates the patch' existence", async () => {
    const crWithAnnotation = {
      metadata: { annotations: { "firestartr.dev/import": "test-value" } },
    }
    const crWithoutAnnotation = {
      metadata: { annotations: {} },
    }

    const annotationExists = await new ImportInitializer().patches({}, {});
    const annotationDoesntExists = await new ImportInitializer().patches({}, {});

    expect(annotationExists[0].validate(crWithAnnotation)).toEqual(true);
    expect(annotationDoesntExists[0].validate(crWithoutAnnotation)).toEqual(false);
  });
});

