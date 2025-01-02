export default class Cache {
    static CACHE_DB_NAME = 'Cache';
    static DB_VERSION = 2;

    constructor(storeName = 'unknown', indexName = 'unknown') {
        this.dbPromise = null;
        this.storeName = storeName;
        this.indexName = indexName;
    }

    onCreateScheme(db) {
        if (!db.objectStoreNames.contains('IndexerCache')) {
            const store = db.createObjectStore('IndexerCache', {
                keyPath: 'id',
                autoIncrement: true,
            });

            store.createIndex('Kind', ['account.id', 'account.kind'], {
                unique: true,
            });
        }

        if (!db.objectStoreNames.contains('AccessKeyCache')) {
            const store = db.createObjectStore('AccessKeyCache', {
                keyPath: 'id',
                autoIncrement: true,
            });

            store.createIndex('AccountId', 'accountId', {
                unique: true,
            });
        }
    }

    onSuccess = Function.prototype;

    _checkDbOpened() {
        if (this.dbPromise) {
            return;
        }

        throw Error('IndexedDB should be opened');
    }

    async getObjectStore(access = 'readwrite') {
        this._checkDbOpened();
        const db = await this.dbPromise;
        const tx = db.transaction(this.storeName, access);

        return tx.objectStore(this.storeName);
    }

    async getIndexStore(access = 'readwrite') {
        const store = await this.getObjectStore();

        return store.index(this.indexName);
    }

    open() {
        const indexedDB =
            window.indexedDB ||
            window.mozIndexedDB ||
            window.webkitIndexedDB ||
            window.msIndexedDB ||
            window.shimIndexedDB;

        this.dbPromise = new Promise((resolve, reject) => {
            try {
                const open = indexedDB.open(Cache.CACHE_DB_NAME, Cache.DB_VERSION);
                open.onupgradeneeded = () => {
                    this.onCreateScheme(open.result);
                };

                open.onsuccess = () => {
                    this.onSuccess(open.result);
                    resolve(open.result);

                    return;
                };

                open.onerror = reject;
            } catch (e) {
                reject(e);
            }
        });
    }

    async close() {
        this._checkDbOpened();
        const db = await this.dbPromise;
        db.close();
    }
}
