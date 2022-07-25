import Cache from '../utils/cache';

export class IndexerCache extends Cache {
    static DB_VERSION = 1;
    static CACHE_VERSION = 1;
    static STORE_NAME = 'IndexerCache';
    static INDEX_NAME = 'Kind';

    static LIKELY_NFT_KEY = 'likelyNFTs';
    static LIKELY_TOKENS_KEY = 'likelyTokens';
    static UPDATE_REQUEST_INTERVAL = 1000 * 30;

    constructor() {
        super(
            IndexerCache.DB_VERSION,
            IndexerCache.STORE_NAME,
            IndexerCache.INDEX_NAME
        );
    }

    onCreateScheme = (open) => {
        const store = open.result.createObjectStore(
            IndexerCache.STORE_NAME,
            {
                keyPath: 'id',
                autoIncrement: true
            }
        );

        store.createIndex(
            IndexerCache.INDEX_NAME, [
                'account.id',
                'account.kind',
                'account.version'
            ],
            {
                unique: true
            }
        );
    }

    _getRecord(accountId, kind) {
        return new Promise(async (resolve, reject) => {
            const store = await this.getIndexStore();
            const query = store.get([accountId, kind, IndexerCache.CACHE_VERSION]);

            query.onsuccess = (event) => {
                resolve(event.target.result);
            };

            query.onerror = reject;
        });
    }

    _addRecord(accountId, kind, data) {
        return new Promise(async (resolve, reject) => {
            const store = await this.getObjectStore();

            const item = {
                account: {
                    id: accountId,
                    kind,
                    version: IndexerCache.CACHE_VERSION,
                },
                data
            };

            const request = store.add(item, IDBCursor.primaryKey);
            request.onsuccess = resolve;
            request.onerror = reject;
        });
    }

    async _updateRecord(accountId, kind, data) {
        return new Promise(async (resolve) => {
            const store = await this.getObjectStore();

            store.openCursor().onsuccess = (event) => {
                const cursor = event.target.result;

                if (cursor) {
                    const { account } = cursor.value;
                    const isFound = account.id === accountId
                        && account.kind === kind;

                    if (isFound) {
                        const updatedData = cursor.value;
                        updatedData.data = data;
                        const request = cursor.update(updatedData);

                        request.onsuccess = resolve;
                    } else {
                        cursor.continue();
                    }
                }
            };
        });
    }

    _shouldUpdate(lastTimestamp = 0) {
        const time = new Date().getTime();

        return time - lastTimestamp >= IndexerCache.UPDATE_REQUEST_INTERVAL;
    }

    /**
     * The main idea is save the contract-helper from searching through the entire history of the blockchain.
     * Each next request, we send the last timestamp, while accumulating data on the client.
     */
    async accumulate(accountId, kind, updater) {
        const record = await this._getRecord(accountId, kind);
        try {
            const lastTimestamp = record?.data?.timestamp;

            if (this._shouldUpdate(lastTimestamp)) {
                const response = await updater(lastTimestamp);
                const prev = record?.data?.list || [];

                const onlyUniqValues = new Set(response.concat(prev));
                const updated = {
                    timestamp: new Date().getTime(),
                    list: Array.from(onlyUniqValues),
                };

                if (Boolean(record)) {
                    await this._updateRecord(accountId, kind, updated);
                } else {
                    await this._addRecord(accountId, kind, updated);
                }

                return updated.list;
            }
        } catch (e) {
            console.error(e);
        }

        return record.data?.list;
    }
}

const cache = new IndexerCache();
cache.open();

export default cache;