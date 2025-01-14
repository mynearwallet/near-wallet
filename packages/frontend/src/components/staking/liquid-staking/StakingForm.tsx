import React, { useState } from 'react';
import { Translate } from 'react-localize-redux';
import BN from 'bn.js';
import { useDispatch, useSelector } from 'react-redux';
import { formatNearAmount, parseNearAmount } from 'near-api-js/lib/utils/format';
import { useMutation } from '@tanstack/react-query';
import { FinalExecutionStatus } from 'near-api-js/lib/providers';
import { useParams } from 'react-router';
import styled from 'styled-components';

import FormButton from '../../common/FormButton';
import ArrowCircleIcon from '../../svg/ArrowCircleIcon';
import ValidatorBoxItem from '../components/ValidatorBoxItem';
import { Mixpanel } from '../../../mixpanel';
import AmountInput from '../components/AmountInput';
import { selectStakingSlice } from '../../../redux/slices/staking';
import {
    LIQUID_STAKING_MIN_AMOUNT,
    STAKING_AMOUNT_DEVIATION,
} from '../../../utils/staking';
import isDecimalString from '../../../utils/isDecimalString';
import { METAPOOL_CONTRACT_ID } from '../../../services/metapool/constant';
import { toYoctoNear } from '../../../utils/gasPrice';
import { selectAvailableBalance } from '../../../redux/slices/account';
import Container from '../../common/styled/Container.css';
import ledgerSlice from '../../../redux/slices/ledger';
import { getBalance } from '../../../redux/actions/account';
import { liquidStaking } from '../../../redux/actions/liquidStaking';
import SuccessActionContainer from './SuccessActionContainer';

const StakingForm = () => {
    const [isSuccess, setIsSuccess] = useState(false);
    const dispatch = useDispatch();
    const [amount, setAmount] = useState('');
    const staking = useSelector(selectStakingSlice);
    const availableBalance = useSelector(selectAvailableBalance);
    const { validatorId }: { validatorId: string } = useParams();
    const { currentAccount } = staking;

    const liquidStakingMutation = useMutation({
        mutationFn: async (amount: string) => {
            return await liquidStaking({
                contractId: validatorId,
                amountInYocto: new BN(toYoctoNear(amount)).toString(),
                accountId: currentAccount.accountId,
            });
        },
        mutationKey: ['liquidStakingMutation', amount],
        onSuccess: (res) => {
            if ((res?.status as FinalExecutionStatus)?.SuccessValue) {
                setIsSuccess(true);
            }
        },
        onSettled: () => {
            dispatch(ledgerSlice.actions.hideLedgerModal());
            dispatch(getBalance());
        },
    });

    const handleSetMax = () => {
        const isPositiveValue = new BN(availableBalance).gt(new BN('0'));

        if (isPositiveValue) {
            setAmount(formatNearAmount(availableBalance, 5).replace(/,/g, ''));
        }
        Mixpanel.track('STAKE/UNSTAKE Use max token');
    };

    const handleOnChange = (amount) => {
        setAmount(amount);
    };

    const invalidStakeActionAmount =
        new BN(parseNearAmount(amount))
            .sub(new BN(availableBalance))
            .gt(new BN(STAKING_AMOUNT_DEVIATION)) ||
        new BN(parseNearAmount(amount)).lt(new BN(LIQUID_STAKING_MIN_AMOUNT)) ||
        !isDecimalString(amount);

    if (isSuccess) {
        return (
            <SuccessActionContainer
                action='stake'
                validatorId={validatorId}
                changesAmount={amount}
            />
        );
    }

    return (
        <StyledContainer className='small-centered'>
            <div className='send-theme'>
                <h1>
                    <Translate id={'staking.stake.title'} />
                </h1>
                <h2>
                    <Translate id={'staking.stake.desc'} />
                </h2>
                <div className='amount-header-wrapper'>
                    <h4>
                        <Translate id='staking.stake.amount' />
                    </h4>
                    <FormButton
                        onClick={handleSetMax}
                        type='button'
                        color='light-blue'
                        className='max-button small'
                    >
                        <Translate id='button.useMax' />
                    </FormButton>
                </div>
                <AmountInput
                    action={'stake'}
                    value={amount}
                    onChange={handleOnChange}
                    valid={!liquidStakingMutation.isLoading && !invalidStakeActionAmount}
                    availableBalance={availableBalance}
                    availableClick={handleSetMax}
                    insufficientBalance={!!amount && invalidStakeActionAmount}
                    disabled={false}
                    stakeFromAccount={true}
                    inputTestId='stakingAmountInput'
                    showSymbolNEAR={true}
                    symbol=''
                />
                {!!amount && amount < '1' && (
                    <div style={{ color: '#ff585d' }}>Minimum 1 NEAR</div>
                )}
                <ArrowCircleIcon color={'#6AD1E3'} />
                <div className='header-button'>
                    <h4>
                        <Translate id={'staking.stake.stakeWith'} />
                    </h4>
                    <FormButton
                        className='small'
                        color='light-blue'
                        linkTo='/staking/validators'
                        trackingId='STAKE Go to validators list page'
                    >
                        <Translate id='button.edit' />
                    </FormButton>
                </div>
                <ValidatorBoxItem validatorId={METAPOOL_CONTRACT_ID} active />
                <FormButton
                    sending={liquidStakingMutation.isLoading}
                    sendingString='staking.staking.checkingValidator'
                    disabled={
                        !amount ||
                        amount < '1' ||
                        liquidStakingMutation.isLoading ||
                        +amount === 0
                    }
                    onClick={() => {
                        liquidStakingMutation.mutate(amount);
                    }}
                    trackingId='STAKE/UNSTAKE Click submit stake button'
                    data-test-id='submitStakeButton'
                >
                    <Translate id={'staking.stake.button'} />
                </FormButton>
            </div>
        </StyledContainer>
    );
};

export default StakingForm;

const StyledContainer = styled(Container)`
    &&& {
        .max-button {
            margin: 0;
        }
    }
    .amount-header-wrapper {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }
    .validator-box-container {
        border-top: 2px solid #f2f2f2;
    }
`;
