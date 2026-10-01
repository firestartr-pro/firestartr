import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import renderFeature, { buildContext, renderContent, expandFiles, resolveInside } from "../src/render";
import validate from "../src/validate";
import auxiliar, {
    RenderContext,
    ExpectedOutput,
    createRenderContext
} from '../src/auxiliar'

describe("The renderer", function(){

    it("can interpret a feature with '$template' args", async () => {

        const ctx: RenderContext = await createRenderContext(
            'files-templates'
        )
    
        await renderFeature(
        
            path.join(__dirname, "fixtures/features/feature_files_templates"),

            ctx.getContextPath(),

            {}, 

            {},

            {
                include_b: true
            }
        
        )   
    
        const content = await ctx.getFile('b.txt') as string

        expect(new RegExp(/A\-B\-C/).test(content)).toBe(true)

    })

    it("can expand a feature with filesTemplates keys", async () => {
 
        await renderFeature(
        
            path.join(__dirname, "fixtures/features/feature_files_templates"),

            '/tmp/foo',

            {}, 

            {},

            {
                include_b: true
            }
        
        )   
    
    })

    it("can work with filesTemplates", async () => {
    
        const ctx: RenderContext = await createRenderContext(
            'files-templates'
        )
    
        await renderFeature(
        
            path.join(__dirname, "fixtures/features/feature_files_templates"),

            ctx.getContextPath(),

            {}, 

            {},

            {
                include_b: true
            }
        
        ) 

        const output: ExpectedOutput = await ctx.getOutputJson()
        
        expect(output.files.some((f:any) => f.repoPath === 'b.txt')).toBe(true)
        
        await ctx.remove()
    })

    it("expected output matches output.json after filesTemplates expansion", async () => {

        const featurePath = path.join(__dirname, "fixtures/features/feature_files_templates")

        const ctx: RenderContext = await createRenderContext(
            'files-templates'
        )

        const featureArgs = { include_b: true }

        await renderFeature(
        
            featurePath,

            ctx.getContextPath(),

            {}, 

            {},

            featureArgs
        
        ) 

        // Mirror the logic in bin/validate.js: expand filesTemplates into the
        // resolved config before building the expected output, exactly as
        // render() does when writing output.json.
        const configData = validate(featurePath)

        const context = buildContext({}, configData.args, {}, featureArgs)

        const cfgResolved = JSON.parse(
            renderContent(JSON.stringify(configData), context),
        )

        context.config = cfgResolved

        if ('filesTemplates' in cfgResolved) {
            expandFiles(featurePath, configData, context)
        }

        const expected = auxiliar.buildExpectedOutput(cfgResolved, ctx.getContextPath())

        const output: ExpectedOutput = await ctx.getOutputJson()

        expect(output).toEqual(expected)

        // The template-expanded file must be part of the expected output,
        // not only of output.json.
        expect(expected.files.some((f:any) => f.repoPath === 'b.txt')).toBe(true)

        await ctx.remove()
    })

    it("buildExpectedOutput keeps targetBranch consistent with output.json", async () => {

        const featurePath = path.join(__dirname, "fixtures/features/feature_files_templates")

        const ctx: RenderContext = await createRenderContext(
            'files-templates'
        )

        const featureArgs = { include_b: true }

        await renderFeature(
        
            featurePath,

            ctx.getContextPath(),

            {}, 

            {},

            featureArgs
        
        ) 

        const configData = validate(featurePath)

        const context = buildContext({}, configData.args, {}, featureArgs)

        const cfgResolved = JSON.parse(
            renderContent(JSON.stringify(configData), context),
        )

        context.config = cfgResolved

        if ('filesTemplates' in cfgResolved) {
            expandFiles(featurePath, configData, context)
        }

        const expected = auxiliar.buildExpectedOutput(cfgResolved, ctx.getContextPath())

        const output: ExpectedOutput = await ctx.getOutputJson()

        for (const file of output.files) {
            const match = expected.files.find((e:any) => e.repoPath === file.repoPath)
            expect(match).toBeDefined()
            expect(match.targetBranch).toEqual(file.targetBranch)
        }

        await ctx.remove()
    })

    it("can work with conditional filesTemplates", async () => {
    
        const ctx: RenderContext = await createRenderContext(
            'files-templates'
        )
    
        await renderFeature(
        
            path.join(__dirname, "fixtures/features/feature_files_templates"),

            ctx.getContextPath(),

            {}, 

            {},

            {},
        
        ) 

        const output: ExpectedOutput = await ctx.getOutputJson()
        
        expect(output.files.some((f:any) => f.repoPath === 'b.txt')).toBe(false)
        
        await ctx.remove()
    })

    it("can work with loops in filesTemplates", async () => {
    
        const ctx: RenderContext = await createRenderContext(
            'files-templates'
        )
    
        await renderFeature(
        
            path.join(__dirname, "fixtures/features/feature_files_templates"),

            ctx.getContextPath(),

            {}, 
            
            {}, 

            { 
              additional_files: ["a1.txt", "a2.txt", "a3.txt"], 
              include_b: true
            },

        
        ) 

        const output: ExpectedOutput = await ctx.getOutputJson()
        
        expect(output.files.some((f:any) => f.repoPath === 'b.txt')).toBe(true)

        expect(output.files.filter((f:any) => f.repoPath.match(/a\d\.txt/)).length).toBe(3)
 
        await ctx.remove()
    })

    it("buildExpectedOutput maps user_managed, upgradable and target_branch consistently", () => {

        const renderDir = path.join(os.tmpdir(), "expected-output")

        const expected = auxiliar.buildExpectedOutput(
            {
                files: [
                    { src: "a.txt", dest: "a.txt", user_managed: true },
                    { src: "b.txt", dest: "b.txt", upgradable: true },
                    { src: "c.txt", dest: "c.txt", upgradable: false },
                    { src: "d.txt", dest: "d.txt", target_branch: "main" },
                    { src: "e.txt", dest: "e.txt" },
                ],
                claimPatches: [],
            },
            renderDir,
        )

    expect(expected.files).toEqual([
        { localPath: path.join(renderDir, "a.txt"), repoPath: "a.txt", userManaged: true, targetBranch: "" },
        { localPath: path.join(renderDir, "b.txt"), repoPath: "b.txt", userManaged: true, targetBranch: "" },
        { localPath: path.join(renderDir, "c.txt"), repoPath: "c.txt", userManaged: false, targetBranch: "" },
        { localPath: path.join(renderDir, "d.txt"), repoPath: "d.txt", userManaged: false, targetBranch: "main" },
        { localPath: path.join(renderDir, "e.txt"), repoPath: "e.txt", userManaged: false, targetBranch: "" },
    ])
})

})

describe("buildContext resolves $arg over $default", () => {

    it("lets a falsy feature arg override a truthy default", () => {
        const ctx = buildContext(
            {},
            { INCLUDE_B: { $default: true, $arg: 'include_b' } },
            {},
            { include_b: false }
        )
        expect(ctx.INCLUDE_B).toBe(false)
    })

    it("keeps the default when the feature arg key is absent", () => {
        const ctx = buildContext(
            {},
            { INCLUDE_B: { $default: true, $arg: 'include_b' } },
            {},
            {}
        )
        expect(ctx.INCLUDE_B).toBe(true)
    })

    it("overrides the default when the feature arg is truthy", () => {
        const ctx = buildContext(
            {},
            { INCLUDE_B: { $default: false, $arg: 'include_b' } },
            {},
            { include_b: true }
        )
        expect(ctx.INCLUDE_B).toBe(true)
    })

    it("uses a falsy feature arg even when no default exists", () => {
        const ctx = buildContext(
            {},
            { FLAG: { $arg: 'flag' } },
            {},
            { flag: false }
        )
        expect(ctx.FLAG).toBe(false)
    })
})

describe("buildContext $ref fallbacks", () => {

    it("maps legacy spec.provisioner.technology.stack to providers.github.technology.stack", () => {
        const ctx = buildContext(
            { providers: { github: { org: 'wrong-org', technology: { stack: 'legacy-stack' } } } },
            { STACK: { $ref: ['spec', 'provisioner', 'technology', 'stack'] } },
            {},
            {}
        )
        expect(ctx.STACK).toBe('legacy-stack')
    })

    it("maps legacy spec.firestartr.technology.stack to providers.github.technology.stack", () => {
        const ctx = buildContext(
            { providers: { github: { org: 'wrong-org', technology: { stack: 'legacy-stack' } } } },
            { STACK: { $ref: ['spec', 'firestartr', 'technology', 'stack'] } },
            {},
            {}
        )
        expect(ctx.STACK).toBe('legacy-stack')
    })

    it("falls back forward: providers.github.technology.stack reads spec.firestartr.technology.stack on CR-shaped docs", () => {
        const ctx = buildContext(
            { spec: { firestartr: { technology: { stack: 'cr-stack' } } } },
            { STACK: { $ref: ['providers', 'github', 'technology', 'stack'] } },
            {},
            {}
        )
        expect(ctx.STACK).toBe('cr-stack')
    })

    it("falls back forward: providers.github.technology.stack reads spec.provisioner.technology.stack on CR-shaped docs", () => {
        const ctx = buildContext(
            { spec: { provisioner: { technology: { stack: 'provisioner-stack' } } } },
            { STACK: { $ref: ['providers', 'github', 'technology', 'stack'] } },
            {},
            {}
        )
        expect(ctx.STACK).toBe('provisioner-stack')
    })

    it("does not substitute org for the legacy stack paths", () => {
        const ctx = buildContext(
            { providers: { github: { org: 'some-org', technology: { stack: 'real-stack' } } } },
            { STACK: { $ref: ['spec', 'provisioner', 'technology', 'stack'] } },
            {},
            {}
        )
        expect(ctx.STACK).toBe('real-stack')
    })
})

describe("conditional filesTemplates honor falsy feature args", () => {

    const CONDITIONAL_CONFIG = [
        'feature_name: "falsy_conditional"',
        'args:',
        '  INCLUDE_EXTRA:',
        '    $default: true',
        '    $arg: include_extra',
        'files:',
        '  - src: base.txt',
        '    dest: base.txt',
        'filesTemplates:',
        '  - ./extra.tpl',
        'claimPatches: []'
    ].join('\n')

    const EXTRA_TPL = [
        'files:',
        '{{| #INCLUDE_EXTRA |}}',
        '  - src: extra.txt',
        '    dest: extra.txt',
        '{{| /INCLUDE_EXTRA |}}'
    ].join('\n')

    async function setup() {
        const feature = await createRenderContext('feature-conditional-falsy-')
        const renderDir = await createRenderContext('feature-render-conditional-falsy-')
        await feature.setFile('config.yaml', CONDITIONAL_CONFIG)
        await feature.setFile('templates/base.txt', 'base')
        await feature.setFile('templates/extra.txt', 'extra')
        await feature.setFile('extra.tpl', EXTRA_TPL)
        return { feature, renderDir }
    }

    it("includes the conditional file when the arg is absent (default applies)", async () => {
        const { feature, renderDir } = await setup()
        try {
            await renderFeature(
                feature.getContextPath(),
                renderDir.getContextPath(),
                {},
                {},
                {}
            )
            const output = await renderDir.getOutputJson() as ExpectedOutput
            expect(output.files.some((f: any) => f.repoPath === 'extra.txt')).toBe(true)
        } finally {
            await feature.remove()
            await renderDir.remove()
        }
    })

    it("excludes the conditional file when the arg is explicitly false", async () => {
        const { feature, renderDir } = await setup()
        try {
            await renderFeature(
                feature.getContextPath(),
                renderDir.getContextPath(),
                {},
                {},
                { include_extra: false }
            )
            const output = await renderDir.getOutputJson() as ExpectedOutput
            expect(output.files.some((f: any) => f.repoPath === 'extra.txt')).toBe(false)
        } finally {
            await feature.remove()
            await renderDir.remove()
        }
    })

    it("includes the conditional file when the arg is explicitly true", async () => {
        const { feature, renderDir } = await setup()
        try {
            await renderFeature(
                feature.getContextPath(),
                renderDir.getContextPath(),
                {},
                {},
                { include_extra: true }
            )
            const output = await renderDir.getOutputJson() as ExpectedOutput
            expect(output.files.some((f: any) => f.repoPath === 'extra.txt')).toBe(true)
        } finally {
            await feature.remove()
            await renderDir.remove()
        }
    })
})

describe("Path traversal protection", () => {

    const TRAVERSAL_CONFIG = (files: string, filesTemplates: string): string => [
        'feature_name: "traversal"',
        'args: {}',
        ...files.split('\n'),
        ...filesTemplates.split('\n'),
        'claimPatches: []',
    ].join('\n')

    async function buildFeature(
        configYaml: string,
        extraFiles: Array<[string, string]> = []
    ): Promise<{ feature: RenderContext, renderDir: RenderContext }> {
        const feature = await createRenderContext('feature-path-traversal-')
        const renderDir = await createRenderContext('feature-render-out-')
        await feature.setFile('config.yaml', configYaml)
        for (const [rel, content] of extraFiles) {
            await feature.setFile(rel, content)
        }
        return { feature, renderDir }
    }

    function renderTraversalFeature(feature: RenderContext, renderDir: RenderContext) {
        return () => renderFeature(
            feature.getContextPath(),
            renderDir.getContextPath(),
            {},
            {},
            {}
        )
    }

    it("rejects filesTemplates entries that escape the feature directory", async () => {
        const { feature, renderDir } = await buildFeature(
            TRAVERSAL_CONFIG(
                'files:\n  - src: ok.txt\n    dest: ok.txt',
                'filesTemplates:\n  - ../evil.tpl'
            ),
            [["templates/ok.txt", "ok"]]
        )

        expect(renderTraversalFeature(feature, renderDir)).toThrow()

        await feature.remove()
        await renderDir.remove()
    })

    it("rejects expanded file src that escapes the feature directory", async () => {
        const { feature, renderDir } = await buildFeature(
            TRAVERSAL_CONFIG(
                'files: []',
                'filesTemplates:\n  - ./evil.tpl'
            ),
            [
                ["evil.tpl", "files:\n  - src: ../../etc/passwd\n    dest: leaked.txt\n"],
            ]
        )

        expect(renderTraversalFeature(feature, renderDir)).toThrow(/must not contain/)

        await feature.remove()
        await renderDir.remove()
    })

    it("rejects static file src that escapes the feature directory", async () => {
        const { feature, renderDir } = await buildFeature(
            TRAVERSAL_CONFIG(
                'files:\n  - src: ../secret.txt\n    dest: leaked.txt',
                ''
            )
        )

        expect(renderTraversalFeature(feature, renderDir)).toThrow()

        await feature.remove()
        await renderDir.remove()
    })

    it("rejects expanded file dest that escapes the render target", async () => {
        const { feature, renderDir } = await buildFeature(
            TRAVERSAL_CONFIG(
                'files: []',
                'filesTemplates:\n  - ./evil.tpl'
            ),
            [
                ["evil.tpl", "files:\n  - src: ok.txt\n    dest: ../leaked.txt\n"],
                ["templates/ok.txt", "ok"],
            ]
        )

        expect(renderTraversalFeature(feature, renderDir)).toThrow(/must not contain/)

        await feature.remove()
        await renderDir.remove()
    })

    it("allows files and templates nested inside the feature directory", async () => {
        const { feature, renderDir } = await buildFeature(
            TRAVERSAL_CONFIG(
                'files:\n  - src: nested/tpl.txt\n    dest: out/nested.txt',
                'filesTemplates:\n  - ./templates/list.tpl'
            ),
            [
                ["templates/nested/tpl.txt", "hello"],
                ["templates/list.tpl", "files:\n  - src: nested/tpl.txt\n    dest: out/from-tpl.txt\n"],
            ]
        )

        expect(renderTraversalFeature(feature, renderDir)).not.toThrow()

        const output = await renderDir.getOutputJson() as ExpectedOutput
        expect(output.files.map((f: any) => f.repoPath).sort()).toEqual(
            ["out/from-tpl.txt", "out/nested.txt"]
        )

        await feature.remove()
        await renderDir.remove()
    })

    it("rejects a non-string src produced by an expanded template with a clear error", async () => {
        const { feature, renderDir } = await buildFeature(
            TRAVERSAL_CONFIG(
                'files: []',
                'filesTemplates:\n  - ./evil.tpl'
            ),
            [
                ["evil.tpl", "files:\n  - src: 123\n    dest: leaked.txt\n"],
            ]
        )

        expect(renderTraversalFeature(feature, renderDir)).toThrow(/must be a non-empty string/)

        await feature.remove()
        await renderDir.remove()
    })

    it("rejects file src that escapes via a symlink inside the feature directory", async () => {
        const outside = await createRenderContext('feature-outside-')
        await outside.setFile('secret.txt', 'secret')

        const { feature, renderDir } = await buildFeature(
            TRAVERSAL_CONFIG(
                'files:\n  - src: link/secret.txt\n    dest: leaked.txt',
                ''
            ),
            []
        )

        fs.mkdirSync(feature.join('templates'), { recursive: true })
        fs.symlinkSync(outside.getContextPath(), feature.join('templates', 'link'), 'dir')

        expect(renderTraversalFeature(feature, renderDir)).toThrow(/symbolic link/)

        await feature.remove()
        await renderDir.remove()
        await outside.remove()
    })

    it("rejects expanded src with a '..' segment even when it resolves inside", async () => {
        const outside = await createRenderContext('feature-outside-')

        const { feature, renderDir } = await buildFeature(
            TRAVERSAL_CONFIG(
                'files: []',
                'filesTemplates:\n  - ./evil.tpl'
            ),
            [
                ["evil.tpl", "files:\n  - src: link/../evil.txt\n    dest: leaked.txt\n"],
            ]
        )

        fs.mkdirSync(feature.join('templates'), { recursive: true })
        fs.symlinkSync(outside.getContextPath(), feature.join('templates', 'link'), 'dir')

        expect(renderTraversalFeature(feature, renderDir)).toThrow(/must not contain/)

        await feature.remove()
        await renderDir.remove()
        await outside.remove()
    })

    it("rejects file dest that escapes via a symlink inside the render target directory", async () => {
        const outside = await createRenderContext('feature-outside-')

        const { feature, renderDir } = await buildFeature(
            TRAVERSAL_CONFIG(
                'files:\n  - src: ok.txt\n    dest: link/evil.txt',
                ''
            ),
            [
                ["templates/ok.txt", "ok"],
            ]
        )

        fs.symlinkSync(outside.getContextPath(), path.join(renderDir.getContextPath(), 'link'), 'dir')

        expect(renderTraversalFeature(feature, renderDir)).toThrow(/symbolic link/)

        await feature.remove()
        await renderDir.remove()
        await outside.remove()
    })

    it("rejects a filesTemplates entry that escapes via a symlink inside the feature directory", async () => {
        const outside = await createRenderContext('feature-outside-')
        await outside.setFile('evil.tpl', 'files:\n  - src: ok.txt\n    dest: ok.txt\n')

        const { feature, renderDir } = await buildFeature(
            TRAVERSAL_CONFIG(
                'files: []',
                'filesTemplates:\n  - link/evil.tpl'
            ),
            [
                ["templates/ok.txt", "ok"],
            ]
        )

        fs.symlinkSync(outside.getContextPath(), feature.join('link'), 'dir')

        expect(renderTraversalFeature(feature, renderDir)).toThrow(/symbolic link/)

        await feature.remove()
        await renderDir.remove()
        await outside.remove()
    })

    it("rejects a symlink that stays inside the feature directory", async () => {
        const { feature, renderDir } = await buildFeature(
            TRAVERSAL_CONFIG(
                'files:\n  - src: link/inside.txt\n    dest: out.txt',
                ''
            ),
            [
                ["templates/sub/inside.txt", "hello"],
            ]
        )

        fs.symlinkSync(feature.join('templates', 'sub'), feature.join('templates', 'link'), 'dir')

        expect(renderTraversalFeature(feature, renderDir)).toThrow(/symbolic link/)

        await feature.remove()
        await renderDir.remove()
    })
})

describe("resolveInside", () => {
    async function makeDir(prefix: string): Promise<string> {
        const ctx = await createRenderContext(prefix)
        return ctx.getContextPath()
    }

    it("rejects a non-string candidate", async () => {
        const root = await makeDir('feature-root-')
        expect(() => resolveInside(root, 123 as any, 'x', 'root')).toThrow(/must be a non-empty string/)
    })

    it("rejects an empty candidate", async () => {
        const root = await makeDir('feature-root-')
        expect(() => resolveInside(root, '', 'x', 'root')).toThrow(/must be a non-empty string/)
    })

    it("rejects a candidate that escapes via a symlink", async () => {
        const root = await makeDir('feature-root-')
        const outside = await makeDir('feature-outside-')
        fs.symlinkSync(outside, path.join(root, 'link'), 'dir')

        expect(() => resolveInside(root, path.join('link', 'secret.txt'), 'x', 'root')).toThrow(/symbolic link/)
    })

    it("rejects a candidate that stays inside via symlink", async () => {
        const root = await makeDir('feature-root-')
        fs.mkdirSync(path.join(root, 'sub'))
        fs.symlinkSync(path.join(root, 'sub'), path.join(root, 'link'), 'dir')

        expect(() => resolveInside(root, path.join('link', 'file.txt'), 'x', 'root')).toThrow(/symbolic link/)
    })

    it("allows a plain nested candidate without symlinks", async () => {
        const root = await makeDir('feature-root-')
        fs.mkdirSync(path.join(root, 'sub', 'deep'), { recursive: true })

        expect(() => resolveInside(root, path.join('sub', 'deep', 'file.txt'), 'x', 'root')).not.toThrow()
    })

    it("rejects a candidate with a '..' segment even when it resolves inside", async () => {
        const root = await makeDir('feature-root-')
        const outside = await makeDir('feature-outside-')
        fs.symlinkSync(outside, path.join(root, 'link'), 'dir')

        expect(() => resolveInside(root, 'link/../evil.txt', 'x', 'root')).toThrow(/must not contain/)
    })

    it("rejects an absolute candidate", async () => {
        const root = await makeDir('feature-root-')
        expect(() => resolveInside(root, '/etc/passwd', 'x', 'root')).toThrow(/must be a relative path/)
    })

    it("rejects a Windows drive-relative candidate that escapes the base", async () => {
        if (process.platform !== 'win32') {
            return
        }

        expect(() => resolveInside('D:\\features\\component-a', 'C:foo', 'x', 'root')).toThrow(/escapes root/)
    })

    it("allows a Windows drive-relative candidate that stays on the base drive", async () => {
        if (process.platform !== 'win32') {
            return
        }

        const root = await makeDir('feature-root-')
        expect(() => resolveInside(root, path.win32.join('sub', 'file.txt'), 'x', 'root')).not.toThrow()
    })
})

describe("allow_non_anchored_paths renders non-anchored paths", () => {

    async function buildFeature(
        configYaml: string,
        extraFiles: Array<[string, string]> = []
    ): Promise<{ feature: RenderContext, renderDir: RenderContext }> {
        const feature = await createRenderContext('feature-non-anchored-')
        const renderDir = await createRenderContext('feature-render-out-')
        await feature.setFile('config.yaml', configYaml)
        for (const [rel, content] of extraFiles) {
            await feature.setFile(rel, content)
        }
        return { feature, renderDir }
    }

    function renderTraversalFeature(feature: RenderContext, renderDir: RenderContext) {
        return () => renderFeature(
            feature.getContextPath(),
            renderDir.getContextPath(),
            {},
            {},
            {}
        )
    }

    function nonAnchoredConfig(files: string, filesTemplates: string): string {
        return [
            'feature_name: "non_anchored"',
            'args: {}',
            'meta:',
            '  allow_non_anchored_paths: true',
            ...files.split('\n'),
            ...filesTemplates.split('\n'),
            'claimPatches: []',
        ].join('\n')
    }

    it("renders a file whose src escapes the feature directory", async () => {
        const outside = await createRenderContext('feature-non-anchored-outside-')
        await outside.setFile('secret.txt', 'leaked')

        const outsideName = path.basename(outside.getContextPath())

        const { feature, renderDir } = await buildFeature(
            nonAnchoredConfig(
                `files:\n  - src: ../../${outsideName}/secret.txt\n    dest: leaked.txt`,
                ''
            )
        )

        expect(renderTraversalFeature(feature, renderDir)).not.toThrow()

        expect(await renderDir.getFile('leaked.txt')).toEqual('leaked')

        await feature.remove()
        await renderDir.remove()
        await outside.remove()
    })

    it("renders a file whose dest escapes the render target directory", async () => {
        const { feature, renderDir } = await buildFeature(
            nonAnchoredConfig(
                'files:\n  - src: ok.txt\n    dest: ../escaped/leaked.txt',
                ''
            ),
            [["templates/ok.txt", "ok"]]
        )

        expect(renderTraversalFeature(feature, renderDir)).not.toThrow()

        const escapedPath = path.join(
            path.dirname(renderDir.getContextPath()),
            'escaped',
            'leaked.txt'
        )
        expect(fs.existsSync(escapedPath)).toBe(true)
        expect(fs.readFileSync(escapedPath, 'utf8')).toEqual('ok')

        fs.rmSync(path.dirname(escapedPath), { recursive: true, force: true })

        await feature.remove()
        await renderDir.remove()
    })

    it("renders a filesTemplates entry that escapes the feature directory", async () => {
        const outside = await createRenderContext('feature-non-anchored-tpl-')
        await outside.setFile('evil.tpl', 'files:\n  - src: ok.txt\n    dest: ok.txt\n')

        const outsideName = path.basename(outside.getContextPath())

        const { feature, renderDir } = await buildFeature(
            nonAnchoredConfig(
                'files: []',
                `filesTemplates:\n  - ../${outsideName}/evil.tpl`
            ),
            [["templates/ok.txt", "ok"]]
        )

        expect(renderTraversalFeature(feature, renderDir)).not.toThrow()

        const output = await renderDir.getOutputJson() as ExpectedOutput
        expect(output.files.some((f: any) => f.repoPath === 'ok.txt')).toBe(true)
        expect(await renderDir.getFile('ok.txt')).toEqual('ok')

        await feature.remove()
        await renderDir.remove()
        await outside.remove()
    })

    it("renders a src that traverses a symlink under the feature directory", async () => {
        const outside = await createRenderContext('feature-non-anchored-outside-')
        await outside.setFile('secret.txt', 'leaked')

        const { feature, renderDir } = await buildFeature(
            nonAnchoredConfig(
                'files:\n  - src: link/secret.txt\n    dest: leaked.txt',
                ''
            )
        )

        fs.mkdirSync(feature.join('templates'), { recursive: true })
        fs.symlinkSync(outside.getContextPath(), feature.join('templates', 'link'), 'dir')

        expect(renderTraversalFeature(feature, renderDir)).not.toThrow()

        expect(await renderDir.getFile('leaked.txt')).toEqual('leaked')

        await feature.remove()
        await renderDir.remove()
        await outside.remove()
    })

    it("still rejects the same escaping paths when the flag is absent", async () => {
        const outside = await createRenderContext('feature-non-anchored-outside-')
        await outside.setFile('secret.txt', 'leaked')

        const outsideName = path.basename(outside.getContextPath())

        const { feature, renderDir } = await buildFeature(
            'feature_name: "anchored"\n' +
            'args: {}\n' +
            `files:\n  - src: ../../../${outsideName}/secret.txt\n    dest: leaked.txt\n` +
            'claimPatches: []\n'
        )

        expect(renderTraversalFeature(feature, renderDir)).toThrow(/escapes|must not contain|config.yaml invalid/)

        await feature.remove()
        await renderDir.remove()
        await outside.remove()
    })
})
