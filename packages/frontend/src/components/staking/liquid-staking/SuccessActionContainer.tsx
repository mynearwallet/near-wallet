import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSelector } from 'react-redux';

import { selectAccountId } from '../../../redux/slices/account';
import { getCachedContractMetadataOrFetch } from '../../../redux/slices/tokensMetadata';
import SuccessAction from './SuccessAction';
import { selectTokensFiatValueUSD } from '../../../redux/slices/tokenFiatValues';
import { getMetapoolValidator } from './utils';

type Props = {
    action: 'stake' | 'unstake' | 'liquidUnstake';
    validatorId: string;
    changesAmount: string;
};

const SuccessActionContainer = ({ validatorId, action, changesAmount }: Props) => {
    const accountId = useSelector(selectAccountId);
    const fungibleTokenPrices = useSelector(selectTokensFiatValueUSD);

    const { data: liquidValidatorData } = useQuery({
        queryKey: ['liquidValidator', accountId],
        queryFn: async () => {
            return getMetapoolValidator({
                accountId,
                tokens: [validatorId],
            });
        },
        enabled: !!accountId,
    });

    const { data: liquidStakingMetadata } = useQuery({
        queryKey: ['liquidStakingMetadata', accountId, validatorId],
        queryFn: async () => {
            return getCachedContractMetadataOrFetch(validatorId, {});
        },
    });

    const { stakedBalance = '0' } = liquidValidatorData || {};

    return (
        <SuccessAction
            action={action}
            accountId={accountId}
            stakedAmountYocto={stakedBalance}
            changesAmount={changesAmount}
            token={{
                balance: stakedBalance || '',
                contractName: validatorId,
                onChainFTMetadata: liquidStakingMetadata || {},
                fiatValueMetadata: {
                    usd: fungibleTokenPrices[validatorId]?.usd,
                },
            }}
        />
    );
};

export default SuccessActionContainer;
