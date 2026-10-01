
import { Store } from '../src/store';

describe('Operator Store', () => {
    it('should not detect random annotations as a change ',() => {

        const store = new Store("test") 
        
        store.add({
            kind: "test",
            apiVersion: "v1",
            metadata: {
                name: "test",
                annotations:{
                    "test": "test"
                }
            }
        })

        const modified = store.modified({
            kind: "test",
            apiVersion: "v1",
            metadata: {
                name: "test",
                annotations:{
                    "test": "test-2"
                }
            }
        })

        expect(modified).toBeFalsy();

    });

    it('should detect firestartr.dev/ annotations as a change ',() => {

        const store = new Store("test") 
        
        store.add({
            kind: "test",
            apiVersion: "v1",
            metadata: {
                name: "test",
                annotations:{
                    "firestartr.dev/test": "test"
                }
            }
        })

        const modified = store.modified({
            kind: "test",
            apiVersion: "v1",
            metadata: {
                name: "test",
                annotations:{
                    "firestartr.dev/test": "test-2"
                }
            }
        })

        expect(modified).toBeTruthy();

    });

    it('should detect firestartr.dev/ annotations as a change when annotations has been added',() => {

        const store = new Store("test") 
        
        store.add({
            kind: "test",
            apiVersion: "v1",
            metadata: {
                name: "test",
                annotations:{}
            }
        })

        const modified = store.modified({
            kind: "test",
            apiVersion: "v1",
            metadata: {
                name: "test",
                annotations:{
                    "firestartr.dev/test": "test-2"
                }
            }
        })

        expect(modified).toBeTruthy();

    });

    it('should detect firestartr.dev/ annotations as a change when annotations has been removed',() => {

        const store = new Store("test") 
        
        store.add({
            kind: "test",
            apiVersion: "v1",
            metadata: {
                name: "test",
                annotations:{
                    "firestartr.dev/test": "test"
                }
            }
        })

        const modified = store.modified({
            kind: "test",
            apiVersion: "v1",
            metadata: {
                name: "test",
                annotations:{}
            }
        })

        expect(modified).toBeTruthy();

    });

    it('should detect firestartr.dev/ annotations as a change when annotations has been removed and added',() => {

        const store = new Store("test") 
        
        store.add({
            kind: "test",
            apiVersion: "v1",
            metadata: {
                name: "test",
                annotations:{
                    "firestartr.dev/a": "test",
                    "firestartr.dev/b": "test"
                }
            }
        })

        const modified = store.modified({
            kind: "test",
            apiVersion: "v1",
            metadata: {
                name: "test",
                annotations:{
                    "firestartr.dev/test": "test-2",
                    "firestartr.dev/c": "test"
                }
            }
        })

        expect(modified).toBeTruthy();

    });

});
