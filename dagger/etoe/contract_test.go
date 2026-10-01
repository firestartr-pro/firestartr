package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUpstreamCallsUseSecretHandlesNotPlaintext(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	var foundConfig, foundOperator, foundNormalTests, foundCrdPhase bool
	constructorHandles := map[string]bool{
		"githubAppID":      false,
		"githubAppPemFile": false,
		"prefappBotPAT":    false,
	}
	secretVariables := map[string]string{
		"GITHUB_APP_ID":       "GithubAppID",
		"GITHUB_APP_PEM_FILE": "GithubAppPemFile",
		"PREFAPP_BOT_PAT":     "PrefappBotPAT",
	}
	foundSecretVariables := make(map[string]bool)
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") || strings.HasSuffix(file, ".gen.go") {
			continue
		}
		parsed, err := parser.ParseFile(token.NewFileSet(), file, nil, parser.ParseComments)
		if err != nil {
			t.Fatal(err)
		}
		for _, decl := range parsed.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			if fn.Name.Name == "New" && fn.Recv == nil {
				for _, param := range fn.Type.Params.List {
					for _, name := range param.Names {
						if _, found := constructorHandles[name.Name]; !found {
							continue
						}
						pointer, ok := param.Type.(*ast.StarExpr)
						if !ok {
							t.Errorf("%s constructor argument is not a Secret pointer", name.Name)
							continue
						}
						secret, ok := pointer.X.(*ast.SelectorExpr)
						if !ok || secret.Sel.Name != "Secret" {
							t.Errorf("%s constructor argument is not a Dagger Secret", name.Name)
						}
						constructorHandles[name.Name] = true
					}
				}
			}
			ast.Inspect(fn.Body, func(node ast.Node) bool {
				if call, ok := node.(*ast.CallExpr); ok {
					if selector, ok := call.Fun.(*ast.SelectorExpr); ok && selector.Sel.Name == "withE2EEnv" {
						if fn.Name.Name == "runCrdUpgradePhase" {
							foundCrdPhase = true
						}
						if fn.Name.Name == "CmdRunTests" {
							foundNormalTests = true
						}
					}
				}
				return true
			})
		}
		ast.Inspect(parsed, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			selector, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			switch selector.Sel.Name {
			case "SetSecret":
				t.Errorf("unsafe secret conversion in %s", file)
			case "WithEnvVariable":
				if len(call.Args) > 0 {
					if name, ok := call.Args[0].(*ast.BasicLit); ok {
						if _, found := secretVariables[strings.Trim(name.Value, `"`)]; found {
							t.Errorf("test credential attached with WithEnvVariable in %s", file)
						}
					}
				}
			case "WithSecretVariable":
				if len(call.Args) != 2 {
					return true
				}
				name, ok := call.Args[0].(*ast.BasicLit)
				if !ok {
					return true
				}
				credentialName := strings.Trim(name.Value, `"`)
				expected, found := secretVariables[credentialName]
				if !found {
					return true
				}
				arg, ok := call.Args[1].(*ast.SelectorExpr)
				if !ok || arg.Sel.Name != expected {
					t.Errorf("%s is not attached from its secret handle in %s", credentialName, file)
				}
				foundSecretVariables[credentialName] = true
            case "GetConfig":
                foundConfig = true
                if len(call.Args) != 9 {
                    t.Errorf("GetConfig received %d arguments; expected only non-sensitive config", len(call.Args))
                }
            case "PrepareOperator":
                foundOperator = true
                if len(call.Args) != 6 {
                    t.Errorf("PrepareOperator received %d arguments; expected config and three secret handles", len(call.Args))
                    return true
                }
				for i, expected := range []string{"AWSAccessKey", "AWSSecretAccessKey", "AWSSessionToken"} {
					arg, ok := call.Args[3+i].(*ast.SelectorExpr)
					if !ok || arg.Sel.Name != expected {
						t.Errorf("PrepareOperator credential argument %d is not %s secret handle", i, expected)
					}
				}
			}
			return true
		})
	}
	if !foundConfig || !foundOperator {
		t.Fatal("missing upstream config/operator call")
	}
	for name := range secretVariables {
		if !foundSecretVariables[name] {
			t.Errorf("missing test credential secret-variable attachment for %s", name)
		}
	}
	for name, found := range constructorHandles {
		if !found {
			t.Errorf("missing test credential constructor handle %s", name)
		}
	}
	if !foundNormalTests || !foundCrdPhase {
		t.Error("test execution did not route normal and CRD phases through secret-variable attachment")
	}
}

func TestWorkflowNeverForwardsOIDCOrCredentialValues(t *testing.T) {
	workflow, err := os.ReadFile("../../.github/workflows/e2e.yaml")
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"--oidc-token", "GITHUB_OIDC_TOKEN", "steps.oidc.outputs.token"} {
		if strings.Contains(string(workflow), forbidden) {
			t.Fatalf("workflow still forwards %s through Dagger", forbidden)
		}
	}
	for _, required := range []string{
		"aws-actions/configure-aws-credentials",
		"fetch_e2e_test_credentials",
		"--aws-access-key=\"env:AWS_ACCESS_KEY_ID\"",
		"--aws-secret-access-key=\"env:AWS_SECRET_ACCESS_KEY\"",
		"--aws-session-token=\"env:AWS_SESSION_TOKEN\"",
		"--github-app-id=\"env:GITHUB_APP_ID\"",
		"--github-app-pem-file=\"env:GITHUB_APP_PEM_FILE\"",
		"--prefapp-bot-pat=\"env:PREFAPP_BOT_PAT\"",
	} {
		if !strings.Contains(string(workflow), required) {
			t.Fatalf("workflow missing secret source %s", required)
		}
	}
}
