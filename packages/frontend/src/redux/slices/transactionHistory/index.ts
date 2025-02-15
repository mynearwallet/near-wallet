import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import set from 'lodash.set';
import uniq from 'lodash.uniq';
import uniqBy from 'lodash.uniqby';
import { providers } from 'near-api-js';

import { nearMetadata, wNearMetadata } from './constant';
import { IMetaData, ITransactionListItem } from './type';
import CONFIG from '../../../config';
import { listTransactions } from '../../../services/indexer';
import { getCachedContractMetadataOrFetch } from '../tokensMetadata';
import NonFungibleTokens from '../../../services/NonFungibleTokens';

/****************************/
// Var declarations
/****************************/
const SLICE_NAME = 'transactionHistory';
const PER_PAGE = 10;

interface ITransactionHistoryState {
    transactions: ITransactionListItem[];
    isLoading: boolean;
    hasMore: boolean;
    selectedTx: string;
    transactionAccountId: string;
}

const initialState: ITransactionHistoryState = {
    transactions: [],
    isLoading: false,
    hasMore: true,
    selectedTx: '',
    transactionAccountId: '',
};

/****************************/
// Slice
/****************************/
const transactionHistorySlice = createSlice({
    name: SLICE_NAME,
    initialState,
    reducers: {
        setTransactions(state, actions) {
            set(state, ['transactions'], actions.payload);
            set(state, ['hasMore'], true);
        },
        addTransactions(state, actions) {
            state.transactions = uniqBy(
                [...state.transactions, ...actions.payload],
                'transaction_hash'
            );
            if (!actions.payload.length) {
                set(state, ['hasMore'], false);
            }
        },
        setLoading(state, actions) {
            state.isLoading = actions.payload;
        },
        setSelectedTx(state, actions) {
            state.selectedTx = actions.payload;
        },
    },
    extraReducers: (builder) => {
        builder.addCase(fetchTransactions.pending, (state) => {
            state.isLoading = true;
        });
        builder.addCase(fetchTransactions.fulfilled, (state) => {
            state.isLoading = false;
        });
        builder.addCase(fetchTransactions.rejected, (state) => {
            state.isLoading = false;
        });
    },
});

export async function fetchAllMetaData(state, allReceiver: string[]) {
    const res: any = await Promise.allSettled([
        ...allReceiver.map((contractName) => {
            return getCachedContractMetadataOrFetch(contractName, state);
        }),
        ...allReceiver.map((contractName) => {
            return NonFungibleTokens.getMetadata(contractName);
        }),
    ]);
    const metas: { [key: string]: IMetaData } = {};
    allReceiver.forEach((receiverId, i) => {
        metas[receiverId] = res[i]?.value || res[i + allReceiver.length]?.value;
    });
    return metas;
}

const fetchTransactions = createAsyncThunk(
    `${SLICE_NAME}/fetchTransactions`,
    async (state: { accountId: string; page: number }, { dispatch }) => {
        const { accountId, page } = state;
        if (!page) {
            return;
        }
        const { setTransactions, addTransactions } = transactionHistorySlice.actions;

        try {
            const indexerTransactions = await listTransactions(accountId, page, PER_PAGE);
            const transactionsHashs: string[] = uniq(
                indexerTransactions.txns.map((item) => item.transaction_hash)
            );
            const transactionsRaw = await Promise.allSettled(
                transactionsHashs.map((txHash) => {
                    return getTransactionDetail({ txHash, accountId });
                })
            );
            const transactions = transactionsRaw
                .map((item) => (item.status === 'fulfilled' ? item.value : null))
                .filter(Boolean);

            const receipt_ids: string[] = [];
            for (const t of transactions) {
                for (const r of t?.receipts || []) {
                    receipt_ids.push(r.receiver_id);
                }
            }
            const metaDatas = await fetchAllMetaData(
                state,
                uniq([
                    'x.paras.near',
                    ...receipt_ids,
                    ...transactions
                        .map((r) => r?.transaction?.receiver_id || '')
                        .filter((x) => x),
                ])
            );

            const result = transactions
                .map((item) => {
                    const action = item.transaction.actions[0];
                    const isNear = action.Transfer;
                    const indexerTransaction = indexerTransactions.txns.find(
                        (t) => t.transaction_hash === item.transaction.hash
                    );
                    const delegateReceiverId =
                        action.Delegate?.delegate_action.receiver_id || '';
                    return {
                        ...item,
                        block_timestamp: indexerTransaction?.block_timestamp,
                        transaction_hash: item.transaction.hash,
                        receipts: item.receipts.map((r) => {
                            const isNear = r.receipt.Action.actions[0]?.Transfer;
                            const isWNear = r.receiver_id === 'wrap.near';
                            const defaultMetaData = isWNear
                                ? wNearMetadata
                                : metaDatas[r.receiver_id];
                            return {
                                ...r,
                                metaData: isNear
                                    ? nearMetadata
                                    : defaultMetaData || metaDatas[r.predecessor_id],
                            };
                        }),
                        metaData: isNear
                            ? nearMetadata
                            : metaDatas[item.transaction?.receiver_id] ||
                              metaDatas[delegateReceiverId] ||
                              {},
                    };
                })
                .filter(Boolean);
            dispatch(page <= 1 ? setTransactions(result) : addTransactions(result));
            return result;
        } catch (err) {
            dispatch(addTransactions([]));
            return;
        }
    }
);

export const transactionHistoryActions = {
    fetchTransactions,
    ...transactionHistorySlice.actions,
};

export const getTransactionDetail = ({
    txHash,
    accountId,
}): Promise<ITransactionListItem> => {
    const provider = new providers.JsonRpcProvider({
        url: CONFIG.NODE_ARCHIVAL_URL,
    });
    return provider.sendJsonRpc('EXPERIMENTAL_tx_status', [txHash, accountId]);
};
export default transactionHistorySlice;

export const transactionHistorySelector = (state): ITransactionHistoryState =>
    state[SLICE_NAME];
