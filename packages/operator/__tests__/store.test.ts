
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


    describe('deletionUnblocked', () => {
        const repo = (finalizers: string[], deleting = true) => ({
            kind: 'FirestartrGithubRepository',
            metadata: {
                name: 'repo',
                namespace: 'default',
                finalizers,
                ...(deleting ? { deletionTimestamp: '2026-10-27T00:00:00Z' } : {}),
            },
        });

        it('detects the foreground finalizer being removed from a terminating item', () => {
            const store = new Store('test');
            store.add(repo(['firestartr.dev/foreground-deletion']));

            expect(store.deletionUnblocked(repo([]))).toBe(true);
        });

        it('ignores finalizer changes that keep the item blocked', () => {
            const store = new Store('test');
            store.add(repo(['firestartr.dev/foreground-deletion', 'other']));

            expect(
                store.deletionUnblocked(repo(['firestartr.dev/foreground-deletion'])),
            ).toBe(false);
        });

        it('ignores items that are not terminating or not in the store', () => {
            const store = new Store('test');

            expect(store.deletionUnblocked(repo([]))).toBe(false);

            store.add(repo(['foregroundDeletion'], false));

            expect(store.deletionUnblocked(repo([], false))).toBe(false);
        });
    });
});
