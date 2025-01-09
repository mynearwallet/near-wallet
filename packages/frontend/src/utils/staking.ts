import BN from 'bn.js';
import * as nearApiJs from 'near-api-js';
import { EpochValidatorInfo } from 'near-api-js/lib/providers/provider';
import uniq from 'lodash.uniq';
import { nearTo } from './amounts';
import { wallet } from './wallet';

import CONFIG from '../config';
import { coreIndexerAdapter } from '../services/coreIndexer/CoreIndexerAdapter';
import { queryClient } from './query/queryClient';

const {
    utils: {
        format: { parseNearAmount },
    },
} = nearApiJs;

export const STAKING_AMOUNT_DEVIATION = parseNearAmount('0.00001');
export const LIQUID_STAKING_MIN_AMOUNT = parseNearAmount('1');

const STAKE_VALIDATOR_PREFIX = '__SVPRE__';
export const ZERO = new BN('0');
export const MIN_DISPLAY_YOCTO = new BN('100');
export const EXPLORER_DELAY = 2000;

export const ACCOUNT_DEFAULTS = {
    selectedValidator: '',
    totalPending: '0', // pending withdrawal
    totalAvailable: '0', // available for withdrawal
    totalUnstaked: '0', // available to be staked
    totalStaked: '0',
    totalUnclaimed: '0', // total rewards paid out - staking deposits made
    validators: [],
};

export const stakingMethods = {
    viewMethods: [
        'get_account_staked_balance',
        'get_account_unstaked_balance',
        'get_account_total_balance',
        'is_account_unstaked_balance_available',
        'get_total_staked_balance',
        'get_owner_id',
        'get_reward_fee_fraction',
        'get_farms',
        'get_farm',
        'get_active_farms',
        'get_unclaimed_reward',
        'get_pool_summary',
    ],
    changeMethods: [
        'ping',
        'deposit',
        'deposit_and_stake',
        'deposit_to_staking_pool',
        'stake',
        'stake_all',
        'unstake',
        'withdraw',
        'claim',
    ],
};

export const lockupMethods = {
    viewMethods: [
        'get_balance',
        'get_locked_amount',
        'get_owners_balance',
        'get_staking_pool_account_id',
        'get_known_deposited_balance',
    ],
};

export async function signAndSendTransaction(signAndSendTransactionOptions) {
    return (await wallet.getAccount(wallet.accountId)).signAndSendTransaction(
        signAndSendTransactionOptions
    );
}

export async function updateStakedBalance(validatorId, account_id, contract) {
    const lastStakedBalance = await contract.get_account_staked_balance({ account_id });
    localStorage.setItem(
        STAKE_VALIDATOR_PREFIX + validatorId + account_id,
        lastStakedBalance
    );
}

export async function getStakingDeposits(accountId: string) {
    const validatorIds = await getValidatorIds(accountId);
    const account = wallet.getAccountBasic(accountId);
    let validatorWithBalance = await Promise.all(
        validatorIds.map(async (validatorId) => {
            const balance = await account
                .viewFunction(validatorId, 'get_account_total_balance', {
                    account_id: accountId,
                })
                .catch((err) => {
                    if (
                        // Means the validators  don't have contract deployed, or don't support staking
                        err.message.includes('CompilationError(CodeDoesNotExist') ||
                        err.message.includes('MethodResolveError(MethodNotFound)')
                    ) {
                        return '0';
                    } else {
                        throw err;
                    }
                });

            return { validator_id: validatorId, deposit: balance } as {
                validator_id: string;
                deposit: string;
            };
        })
    );

    validatorWithBalance = validatorWithBalance.filter((validator) => {
        return validator.deposit !== '0';
    });

    const validatorDepositMap = {};
    validatorWithBalance.forEach(({ validator_id, deposit }) => {
        validatorDepositMap[validator_id] = deposit;
    });

    return validatorDepositMap;
}

export function shuffle(sourceArray) {
    for (let i = 0; i < sourceArray.length - 1; i++) {
        const j = i + Math.floor(Math.random() * (sourceArray.length - i));
        const temp = sourceArray[j];
        sourceArray[j] = sourceArray[i];
        sourceArray[i] = temp;
    }
    return sourceArray;
}

const SECONDS_IN_YEAR = 3600 * 24 * 365;

export const calculateAPY = (poolSummary, tokenPrices) => {
    // Handle if there are no active farms:
    const activeFarms = poolSummary?.farms?.filter((farm) => farm.active);
    if (!activeFarms || activeFarms.every((farm) => !+tokenPrices[farm.token_id]?.usd)) {
        return 0;
    }

    try {
        const farmsWithTokenPrices = activeFarms.filter(
            (farm) => tokenPrices[farm.token_id]?.usd
        );
        const totalStakedBalance = nearTo(poolSummary.total_staked_balance);

        const summaryAPY = farmsWithTokenPrices.reduce((acc, farm) => {
            const tokenPriceInUSD = +tokenPrices[farm.token_id].usd;
            const nearPriceInUSD = +tokenPrices[CONFIG.NEAR_TOKEN_ID].usd;

            const rewardsPerSecond =
                farm.amount / ((farm.end_date - farm.start_date) * 1e9);
            const rewardsPerSecondInUSD = rewardsPerSecond * tokenPriceInUSD;
            const totalStakedBalanceInUSD = totalStakedBalance * nearPriceInUSD;
            const farmAPY =
                ((rewardsPerSecondInUSD * SECONDS_IN_YEAR) / totalStakedBalanceInUSD) *
                100;
            return acc + farmAPY;
        }, 0);

        return summaryAPY.toFixed(2);
    } catch (e) {
        console.error('Error during calculating APY', e);
        return '-';
    }
};

function getUniqueAccountIdsFromEpochValidatorInfo(
    epochValidatorInfo: EpochValidatorInfo
): string[] {
    try {
        const allAccountIds: string[] = [];
        // Extract account IDs from each key and concatenate them
        allAccountIds.push(
            ...epochValidatorInfo.current_proposals.map(
                (validator) => validator.account_id
            ),
            ...epochValidatorInfo.current_validators.map(
                (validator) => validator.account_id
            ),
            ...epochValidatorInfo.next_validators.map(
                (validator) => validator.account_id
            ),
            ...epochValidatorInfo.prev_epoch_kickout.map(
                (validator) => validator.account_id
            )
        );

        // Convert the concatenated array into a Set to remove duplicates
        const uniqueAccountIdsSet = new Set(allAccountIds);
        return Array.from(uniqueAccountIdsSet);
    } catch (error) {
        console.error('Error in getUniqueAccountIdsFromEpochValidatorInfo: ', error);
        return [];
    }
}

export const getRecentEpochValidators = async () => {
    return await queryClient.fetchQuery({
        queryKey: ['recent_provider_validators', 'persist'],
        queryFn: () => wallet.connection.provider.validators(null),
        staleTime: 1000 * 60 * 60 * 24, // 1 day
    });
};
export const getValidatorIdsFromRpc = async (): Promise<string[]> => {
    const validatorsList = await getRecentEpochValidators();
    return getUniqueAccountIdsFromEpochValidatorInfo(validatorsList);
};

const getValidatorIdsFromIndexer = async (accountId: string): Promise<string[]> => {
    return await coreIndexerAdapter.fetchAccountValidatorIds(accountId);
};

export const getValidatorIds = async (accountId: string): Promise<string[]> => {
    const [validatorIdsRpc, validatorIdsIndexer] = await Promise.all([
        getValidatorIdsFromRpc(),
        getValidatorIdsFromIndexer(accountId),
    ]);
    return uniq([...validatorIdsRpc, ...validatorIdsIndexer]);
};
