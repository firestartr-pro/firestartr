import { setHighPriorityStatus } from '../src/high_priority_status';

describe('Operator HighPriorityStatus', () => {

    it("is able to properly handle an unknown status item", () => {
    
        const item = {
        
            kind: "test",
            metadata: {
                name: "foo"
            },
            status: {
     
                conditions: [
                    
                ]       
            
            }
        }

        setHighPriorityStatus(item)

		expect(item.status).toEqual({
			conditions: [],
			highPriorityState: 'UNKNOWN',
			highPriorityReason: 'AwaitingReconciliation'
		})
    })

    it("is able to properly handle sorted priorities", () => {
    
        const item = {
        
            kind: "test",
            metadata: {
                name: "foo"
            },
            status: {
     
                conditions: [
                    {type: "PROVISIONED", status: "True", reason: "SYNC"},
                    {type: "SYNCHRONIZED", status: "True", reason: "SYNC"},
                    {type: "OUT_OF_SYNC", status: "True", reason: "SYNC"},
                ]       
            
            }
        }

        setHighPriorityStatus(item)

		expect(item.status).toEqual({
			conditions: [
				{type: "PROVISIONED", status: "True", reason: "SYNC"},
				{type: "SYNCHRONIZED", status: "True", reason: "SYNC"},
				{type: "OUT_OF_SYNC", status: "True", reason: "SYNC"},

			],
			highPriorityState: 'OUT_OF_SYNC',
			highPriorityReason: 'SYNC'
		})
    })

    it("ERROR always takes highest priority over all other states", () => {
        const item = {
            kind: "test",
            metadata: { name: "foo" },
            status: {
                conditions: [
                    {type: "SYNCHRONIZED", status: "True", reason: "SYNC"},
                    {type: "ERROR", status: "True", reason: "ApplyFailed"},
                    {type: "PROVISIONED", status: "True", reason: "SYNC"},
                ]
            }
        }

        setHighPriorityStatus(item)

		expect(item.status).toEqual({
			conditions: [
				{type: "SYNCHRONIZED", status: "True", reason: "SYNC"},
				{type: "ERROR", status: "True", reason: "ApplyFailed"},
				{type: "PROVISIONED", status: "True", reason: "SYNC"},
			],
			highPriorityState: 'ERROR',
			highPriorityReason: 'ApplyFailed'
		})
    })

});
