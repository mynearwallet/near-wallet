import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: false,
            refetchOnWindowFocus: false,
        },
    },
});

const localStoragePersister = createSyncStoragePersister({
    storage: window.localStorage,
});

persistQueryClient({
    queryClient,
    persister: {
        persistClient: async (client) => {
            const filteredClient = {
                ...client,
                queries: client.clientState.queries.filter((query) =>
                    query.queryKey.includes('persist')
                ),
            };
            await localStoragePersister.persistClient(filteredClient);
        },
        restoreClient: localStoragePersister.restoreClient,
        removeClient: localStoragePersister.removeClient,
    },
    maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
});
