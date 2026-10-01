import { parseLog } from "../src/helpers/log-parser";

describe("Log parser helper", () => {

    it("can parse multiline string doc", async () => {
        
        const multiline =`
"{\"@level\":\"info\",\"@message\":\"Terraform 1.7.3\",\"@module\":\"terraform.ui\",\"@timestamp\":\"2024-09-10T13:32:34.479166Z\",\"terraform\":\"1.7.3\",\"type\":\"version\",\"ui\":\"1.2\"}\n{\"@level\":\"error\",\"@message\":\"Error: No value for required variable\",\"@module\":\"terraform.ui\",\"@timestamp\":\"2024-09-10T13:32:35.340156Z\",\"diagnostic\":{\"severity\":\"error\",\"summary\":\"No value for required variable\",\"detail\":\"The root module input variable \\\"purge_protection_enabled\\\" is not set, and has no default value. Use a -var or -var-file command line argument to provide a value for this variable.\",\"range\":{\"filename\":\"variables.tf\",\"start\":{\"line\":13,\"column\":1,\"byte\":154},\"end\":{\"line\":13,\"column\":36,\"byte\":189}},\"snippet\":{\"context\":null,\"code\":\"variable \\\"purge_protection_enabled\\\" {\",\"start_line\":13,\"highlight_start_offset\":0,\"highlight_end_offset\":35,\"values\":[]}},\"type\":\"diagnostic\"}\n{\"@level\":\"error\",\"@message\":\"Error: No value for required variable\",\"@module\":\"terraform.ui\",\"@timestamp\":\"2024-09-10T13:32:35.340470Z\",\"diagnostic\":{\"severity\":\"error\",\"summary\":\"No value for required variable\",\"detail\":\"The root module input variable \\\"enable_rbac_authorization\\\" is not set, and has no default value. Use a -var or -var-file command line argument to provide a value for this variable.\",\"range\":{\"filename\":\"variables.tf\",\"start\":{\"line\":25,\"column\":1,\"byte\":297},\"end\":{\"line\":25,\"column\":37,\"byte\":333}},\"snippet\":{\"context\":null,\"code\":\"variable \\\"enable_rbac_authorization\\\" {\",\"start_line\":25,\"highlight_start_offset\":0,\"highlight_end_offset\":36,\"values\":[]}},\"type\":\"diagnostic\"}\n{\"@level\":\"error\",\"@message\":\"Error: No value for required variable\",\"@module\":\"terraform.ui\",\"@timestamp\":\"2024-09-10T13:32:35.340705Z\",\"diagnostic\":{\"severity\":\"error\",\"summary\":\"No value for required variable\",\"detail\":\"The root module input variable \\\"enabled_for_disk_encryption\\\" is not set, and has no default value. Use a -var or -var-file command line argument to provide a value for this variable.\",\"range\":{\"filename\":\"variables.tf\",\"start\":{\"line\":5,\"column\":1,\"byte\":37},\"end\":{\"line\":5,\"column\":39,\"byte\":75}},\"snippet\":{\"context\":null,\"code\":\"variable \\\"enabled_for_disk_encryption\\\" {\",\"start_line\":5,\"highlight_start_offset\":0,\"highlight_end_offset\":38,\"values\":[]}},\"type\":\"diagnostic\"}\n{\"@level\":\"error\",\"@message\":\"Error: No value for required variable\",\"@module\":\"terraform.ui\",\"@timestamp\":\"2024-09-10T13:32:35.340953Z\",\"diagnostic\":{\"severity\":\"error\",\"summary\":\"No value for required variable\",\"detail\":\"The root module input variable \\\"soft_delete_retention_days\\\" is not set, and has no default value. Use a -var or -var-file command line argument to provide a value for this variable.\",\"range\":{\"filename\":\"variables.tf\",\"start\":{\"line\":9,\"column\":1,\"byte\":95},\"end\":{\"line\":9,\"column\":38,\"byte\":132}},\"snippet\":{\"context\":null,\"code\":\"variable \\\"soft_delete_retention_days\\\" {\",\"start_line\":9,\"highlight_start_offset\":0,\"highlight_end_offset\":37,\"values\":[]}},\"type\":\"diagnostic\"}\n"        
        `
        

        expect(
        
            parseLog(multiline).includes("```json")
        
        ).toBeTruthy()

        
    })

    it("can parse a single string json", async () => {
        
        const singleJson = `{"@level":"info","@message":"Terraform 1.7.3","@module":"terraform.ui","@timestamp":"2024-09-10T13:32:34.479166Z","terraform":"1.7.3","type":"version","ui":"1.2"}`
        
        expect(
        
            parseLog(singleJson).includes("```json")
        
        ).toBeTruthy()
    })

    it("can parse a non-json log and split it by newlines", async () => {
        
        const log = `
"╷\n│ Error: Error acquiring the state lock\n│ \n│ Error message: state blob is already locked\n│ Lock Info:\n│   ID:        0c4e58e2-bc7b-7bfa-8dd9-319e51510567\n│   Path:      terraform/31eb7401-3ee3-4730-b736-c17295831e81\n│   Operation: OperationTypeApply\n│   Who:       root@example-controller-controller-7d98b8785-7lf49\n│   Version:   1.7.3\n│   Created:   2024-09-10 11:42:19.250645847 +0000 UTC\n│   Info:      \n│ \n│ \n│ Terraform acquires a state lock to protect the state from being written\n│ by multiple users at the same time. Please resolve the issue above and try\n│ again. For most commands, you can disable locking with the \"-lock=false\"\n│ flag, but this is not recommended.\n╵\n"
        `
        expect(
            
            parseLog(log).includes("```shell")
            
        ).toBeTruthy()
    
    })
})
