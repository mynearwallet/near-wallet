import Cache from '../../utils/cache';

export class AccessKeyCache extends Cache {
    static STORE_NAME = 'AccessKeyCache';
    static INDEX_NAME = 'AccountId';

    constructor() {
        super(AccessKeyCache.STORE_NAME, AccessKeyCache.INDEX_NAME);
    }

    getRecord(accountId) {
        return new Promise(async (resolve, reject) => {
            const store = await this.getIndexStore();
            const query = store.get(accountId);

            query.onsuccess = (event) => {
                resolve(event.target.result);
            };

            query.onerror = reject;
        });
    }

    addRecord(accountId, keyMetas) {
        return new Promise(async (resolve, reject) => {
            const store = await this.getObjectStore();

            const item = {
                accountId,
                keyMetas,
            };

            const request = store.add(item, IDBCursor.primaryKey);
            request.onsuccess = resolve;
            request.onerror = reject;
        });
    }

    async updateRecord(accountId, keyMetas) {
        const id = await this.getRecord(accountId).then((record) => record?.id);

        if (!id) {
            return this.addRecord(accountId, keyMetas);
        }

        return new Promise(async (resolve, reject) => {
            const store = await this.getObjectStore();

            const request = store.put({
                accountId,
                keyMetas,
                id,
            });

            request.onsuccess = resolve;
            request.onerror = reject;
        });
    }
}

const cache = new AccessKeyCache();
cache.open();

export default cache;
