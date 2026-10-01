import {
    getSyncStatus,
    SyncStatus,
    setSyncStatus,

} from '../src/syncCtl';
import { getItemIfNeededSync } from '../src/syncer';
import { getItemByItemPath } from '../src/ctl';

const MOCKED_CRS = {};

jest.mock(

    '../src/ctl', () => ({

        getItemByItemPath: jest.fn(async (itemPath: string) => {
        
            return MOCKED_CRS[itemPath]
        
        })

    })

)


describe("The syncer machinery", () => {


    beforeEach(() => {
    
        for(const mock of Object.keys(MOCKED_CRS))
            delete MOCKED_CRS[mock]
    
    })

    it('can be used to assess the sync status of an item', async () => {
    
        MOCKED_CRS["item_no_sync_status"] = {
        
            metadata: {
            
                annotations: {
                
                }
            
            },

            status: {
            
                conditions: [
                
                
                ]
            
            }
        
        }

        let status: SyncStatus = await getSyncStatus("item_no_sync_status")
    
        expect(status.syncStatusPresent).toBe(false)

        MOCKED_CRS["item_sync"] = {
        
            metadata: {
                annotations: {
                
                }
            },

            status: {
                conditions: [
             
                    {
                        type: "SYNCHRONIZED",
                        reason: "UPDATED",
                        message: "SYNCHRONIZED",
                        lastSyncTime: new Date(Date.now() - (5 * 1000)).toISOString(),
                        nextSyncTime: new Date(Date.now() + (1 * 1000)).toISOString(),
                    }   
                
                ]
            }
        
        }

        status = await getSyncStatus("item_sync")
    
        expect(status.syncStatusPresent).toBe(true)
        expect(status.intervalLapsed).toBe(false)

    })

    it('removes sync watcher on 404 error', async () => {
      const mockGet = jest.mocked(getItemByItemPath);
      const syncWatchers: any = {
        'path/to/item': { itemPath: 'path/to/item' },
      };

      mockGet.mockRejectedValueOnce(
        new Error('Error on getItemByItemPath: path/to/item: Not Found'),
      );

      const result = await getItemIfNeededSync(
        { itemPath: 'path/to/item' },
        syncWatchers,
      );

      expect(result).toBeNull();
      expect(syncWatchers['path/to/item']).toBeUndefined();
    });

    it('keeps sync watcher on transient 500 error', async () => {
      const mockGet = jest.mocked(getItemByItemPath);
      const syncWatchers: any = {
        'path/to/item': { itemPath: 'path/to/item' },
      };

      mockGet.mockRejectedValueOnce(
        new Error('Error on getItemByItemPath: path/to/item: Internal Server Error'),
      );

      const result = await getItemIfNeededSync(
        { itemPath: 'path/to/item' },
        syncWatchers,
      );

      expect(result).toBeNull();
      expect(syncWatchers['path/to/item']).toBeDefined();
    });

})
