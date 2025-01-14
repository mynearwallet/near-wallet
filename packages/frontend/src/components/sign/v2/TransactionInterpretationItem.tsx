import React from 'react';
import ImageWithLoading from '../../common/image/ImageWithLoading';
import classNames from '../../../utils/classNames';
import { ETxDirection } from '../../transactions/TransactionItem';
import {
    getPrefixByDir,
    transactionToHistoryUIData,
} from '../../../redux/slices/transactionHistory/utils';
import { useSelector } from 'react-redux';
import { selectAccountId } from '../../../redux/slices/account';
import { useQuery } from '@tanstack/react-query';
import { keysToSnakeCase } from '../../../utils/object';
import CONFIG from '../../../config';
import { fetchAllMetaData } from '../../../redux/slices/transactionHistory';

type Props = {
    transaction: any;
};

const TransactionInterpretationItem = ({ transaction }: Props) => {
    const accountId = useSelector(selectAccountId);
    const txData = {
        transaction: {
            ...keysToSnakeCase(transaction),
            actions: transaction.actions.map((action) => {
                return Object.entries(action).reduce((acc, [key, value]) => {
                    return {
                        ...acc,
                        [key.charAt(0).toUpperCase() + key.slice(1)]:
                            keysToSnakeCase(value),
                    };
                }, {});
            }),
        },
        transaction_outcome: {
            outcome: {
                status: {},
            },
        },
        receipts: [],
        metaData: {},
        status: {},
        isPreTransaction: true,
    };

    const txUIRaw = transactionToHistoryUIData(
        txData,
        accountId,
        CONFIG.CURRENT_NEAR_NETWORK
    );

    const { data } = useQuery({
        queryKey: ['signTxMetadata', transaction, txUIRaw.args?.nft_contract_id],
        queryFn: async () => {
            const allReceiver =
                txUIRaw.isNft && txUIRaw.args?.nft_contract_id
                    ? [transaction.receiverId, txUIRaw.args.nft_contract_id]
                    : [transaction.receiverId];
            const metaDatas = await fetchAllMetaData({}, allReceiver);
            return metaDatas;
        },
        enabled: !!transaction,
        staleTime: 300_000,
    });

    const txUI = transactionToHistoryUIData(
        {
            ...txData,
            metaData:
                data?.[transaction?.receiverId] ||
                data?.[txUIRaw.args?.nft_contract_id] ||
                {},
        },
        accountId,
        CONFIG.CURRENT_NEAR_NETWORK
    );

    const hasImage = data?.[txUIRaw.args?.nft_contract_id]?.icon || !!txUI.image;

    return (
        <div className='account tx-card from no-border'>
            <div className='tx-card__icon'>
                {hasImage && (
                    <ImageWithLoading
                        src={data?.[txUIRaw.args?.nft_contract_id]?.icon || txUI.image}
                        alt='transaction-icon'
                        loadImageTimeout={60_000}
                        style={{ objectFit: 'contain' }}
                    />
                )}
            </div>
            <div className='tx-card__content'>
                <div className='tx-card__title'>{txUI.title}</div>
                <div className='tx-card__subtitle'>{txUI.subtitle}</div>
            </div>
            <div className='tx-card__right'>
                {!!txUI.assetChangeText && (
                    <div
                        className={classNames([
                            'tx-card__right__title',
                            {
                                'text-green': txUI.dir !== ETxDirection.send,
                            },
                        ])}
                    >
                        {getPrefixByDir(txUI.dir)}
                        {txUI.assetChangeText}
                    </div>
                )}
                {!!txUI.assetChangeText2 && (
                    <div
                        className={classNames([
                            'asset-change2',
                            {
                                'text-green': txUI.dir === ETxDirection.send,
                            },
                        ])}
                    >
                        {txUI.assetChangeText2}
                    </div>
                )}
            </div>
        </div>
    );
};

export default TransactionInterpretationItem;
