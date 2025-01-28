import CONFIG from '../../config';
import { AccessKeyCache } from './cache';

interface KeyMeta {
    publicKey: string;
    created: {
        block_timestamp: number;
        transaction_hash: string;
    };
}

export async function getAccessKeyMeta(accessKeys, accountId) {
    const accessKeysWithMetadata = accessKeys.map((key) => ({ ...key }));

    const accessKeyCache = new AccessKeyCache();
    await accessKeyCache.open();

    try {
        let pageCount = 1;
        let response;

        const existingRecords = await accessKeyCache.getRecord(accountId);

        let lastRecord: KeyMeta | undefined;
        let newRecords: KeyMeta[];

        if ((existingRecords?.keyMetas?.length ?? 0) > 0) {
            lastRecord = existingRecords.keyMetas.sort(
                (keyMetaX, keyMetaY) => keyMetaX.created - keyMetaY.created
            )[0];

            newRecords = existingRecords.keyMetas;
        } else {
            lastRecord = undefined;

            newRecords = [];
        }

        let found = false;

        do {
            response = await fetch(
                `${
                    CONFIG.INDEXER_NEARBLOCK_SERVICE_URL
                }/v1/account/${accountId}/keys?page=${pageCount++}&per_page=25&order=desc`
            ).then((res) => res.json());

            response.keys.map((keyInfo) => {
                if (keyInfo.public_key === lastRecord?.publicKey) {
                    found = true;
                }

                const record = newRecords.find(
                    (record) => record.publicKey === keyInfo.public_key
                );

                if (record) {
                    record.created = keyInfo.created;
                } else {
                    newRecords.push({
                        publicKey: keyInfo.public_key,
                        created: keyInfo.created,
                    });
                }
            });
        } while (response?.keys?.length === 25 && !found);

        await accessKeyCache.updateRecord(accountId, newRecords);
    } catch (err) {
        console.error('fetch access key from nearblocks error', err);
        // Even with error, we don't want to stop the process, we try to fetch old value from cache
    }

    const records = await accessKeyCache.getRecord(accountId);

    console.log('records', records);

    records.keyMetas.forEach((keyMeta) => {
        const accessKey = accessKeysWithMetadata.find(
            (key) => key.public_key === keyMeta.publicKey
        );

        if (accessKey) {
            accessKey.created = keyMeta.created;
        }
    });

    return accessKeysWithMetadata;
}
