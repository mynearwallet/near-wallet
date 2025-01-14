import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { useHistory } from 'react-router';

import { selectAllowedTokens } from '../../../redux/slices/tokens';
import ValidatorBoxItem from '../components/ValidatorBoxItem';
import { formatNearAmount } from '../../common/balance/helpers';
import LoadingDots from '../../common/loader/LoadingDots';
import styled from 'styled-components';
import { Mixpanel } from '../../../mixpanel';
import { getMetapoolValidator } from './utils';

const OwnedValidators = ({
    accountId,
    validatorId,
}: {
    accountId: string;
    validatorId: string;
}) => {
    const history = useHistory();
    const allowedTokens = useSelector(selectAllowedTokens);
    const { data: liquidValidatorData, isLoading } = useQuery({
        queryKey: ['liquidValidator', accountId, allowedTokens],
        queryFn: async () => {
            return getMetapoolValidator({
                accountId,
                tokens: allowedTokens,
            });
        },
        enabled: !!accountId,
    });

    if (isLoading) {
        return <LoadingDots />;
    }

    if (!liquidValidatorData) {
        return null;
    }

    return (
        <Container>
            {!!+liquidValidatorData?.stakedBalance && (
                <ValidatorBoxItem
                    validatorId={validatorId}
                    amountString={
                        liquidValidatorData
                            ? `${formatNearAmount(liquidValidatorData.stakedBalance)} ${
                                  liquidValidatorData?.tokenToReceive?.onChainFTMetadata
                                      ?.symbol || ''
                              }`
                            : ''
                    }
                    active
                    apy={liquidValidatorData?.apy}
                    isLiquidStaking
                    onClick={() => {
                        Mixpanel.track('STAKE Go to staked account page');
                        history.push(`/liquid-staking/${validatorId}`);
                    }}
                />
            )}
        </Container>
    );
};

export default OwnedValidators;

const Container = styled.div`
    .validator-box-item__info {
        border: 1px solid #ddd;
        padding: 0.8em 1em;
        margin: 1em;
        border-radius: 4px;
    }
`;
