import { getNearRpcClient } from '@meteorwallet/meteor-near-sdk';
import type { ENearNetwork } from '@meteorwallet/meteor-near-sdk/dist/packages/common/core/modules/blockchains/near/core/types/near_basic_types.d.ts';
import { CalimeroWalletUtils } from 'calimero-wallet-utils';
import isEqual from 'lodash.isequal';
import * as nearApiJs from 'near-api-js';
import type { AccessKeyList } from 'near-api-js/lib/providers/provider';
import { generateSeedPhrase, parseSeedPhrase } from 'near-seed-phrase';

import { decorateWithLockup } from './account-with-lockup';
import {
    removeAllAccountsPrivateKey,
    retrieveAllAccountsPrivateKey,
    storedWalletDataActions,
} from './encryptedWalletData';
import { getAccountIds } from './helper-api';
import { ledgerManager } from './ledgerManager';
import {
    setAccountConfirmed,
    setWalletAccounts,
    removeActiveAccount,
    removeAccountConfirmed,
    getLedgerHDPath,
    removeLedgerHDPath,
    setLedgerHdPath,
} from './localStorage';
import { ConnectionInfo, RpcProvider } from './mnw-api-js';
import { ConnectionsStorage } from './storage';
import { TwoFactor } from './twoFactor';
import { WalletError } from './walletError';
import { store, addAccountReducer } from '..';
import CONFIG from '../config';
import { makeAccountActive, redirectTo, switchAccount } from '../redux/actions/account';
import { actions as ledgerActions } from '../redux/slices/ledger';
import passwordProtectedWallet from '../redux/slices/passwordProtectedWallet/passwordProtectedWallet';
import sendJson from '../tmp_fetch_send_json';
import { withAdjustedStorageCost } from './accountsLogic/withAdjustedStorageCost';

export const WALLET_CREATE_NEW_ACCOUNT_URL = 'create';
export const WALLET_CREATE_NEW_ACCOUNT_FLOW_URLS = [
    'create',
    'set-recovery',
    'setup-seed-phrase',
    'recover-account',
    'recover-seed-phrase',
    'sign-in-ledger',
    'fund-create-account',
    'verify-account',
    'initial-deposit',
    'setup-ledger',
];
export const WALLET_LOGIN_URL = 'login';
export const WALLET_SIGN_URL = 'sign';
export const WALLET_BATCH_IMPORT_URL = 'batch-import';
export const WALLET_INITIAL_DEPOSIT_URL = 'initial-deposit';
export const WALLET_LINKDROP_URL = 'linkdrop';
export const WALLET_RECOVER_ACCOUNT_URL = 'recover-account';
export const WALLET_SEND_MONEY_URL = 'send-money';
export const WALLET_VERIFY_OWNER_URL = 'verify-owner';
export const WALLET_SIGN_MESSAGE_URL = 'sign-message';

export const CONTRACT_CREATE_ACCOUNT_URL = `${CONFIG.ACCOUNT_KITWALLET_HELPER_URL}/account`;
export const FUNDED_ACCOUNT_CREATE_URL = `${CONFIG.ACCOUNT_KITWALLET_HELPER_URL}/fundedAccount`;
export const IDENTITY_FUNDED_ACCOUNT_CREATE_URL = `${CONFIG.ACCOUNT_KITWALLET_HELPER_URL}/identityFundedAccount`;
const IDENTITY_VERIFICATION_METHOD_SEND_CODE_URL = `${CONFIG.ACCOUNT_KITWALLET_HELPER_URL}/identityVerificationMethod`;

export const SHOW_NETWORK_BANNER = !CONFIG.IS_MAINNET || CONFIG.SHOW_PRERELEASE_WARNING;
export const ENABLE_IDENTITY_VERIFIED_ACCOUNT = true;
// To disable coin-op 1.5: Set ENABLE_IDENTITY_VERIFIED_ACCOUNT to 'false'
// TODO: Clean up all Coin-op 1.5 related code after test period

const KEY_UNIQUE_PREFIX = '_4:';
export const KEY_STORE_PREFIX = 'nearlib:keystore:';
const KEY_WALLET_ACCOUNTS = KEY_UNIQUE_PREFIX + 'wallet:accounts_v2';
export const KEY_ACTIVE_ACCOUNT_ID = KEY_UNIQUE_PREFIX + 'wallet:active_account_id_v2';
const ACCOUNT_ID_REGEX = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export const RELEASE_NOTES_MODAL_VERSION = 'v0.01.2';

export const keyAccountConfirmed = (accountId) =>
    `wallet.account:${accountId}:${CONFIG.NETWORK_ID}:confirmed`;
export const keyStakingAccountSelected = () =>
    `wallet.account:${wallet.accountId}:${CONFIG.NETWORK_ID}:stakingAccount`;
export const keyReleaseNotesModalClosed = (version) =>
    `wallet.releaseNotesModal:${version}:closed`;

const WALLET_METADATA_METHOD = '__wallet__metadata';

export const ACCOUNT_CHECK_TIMEOUT = 500;
export const TRANSACTIONS_REFRESH_INTERVAL = 10000;

const {
    setLedgerTxSigned,
    showLedgerModal,
    handleShowConnectModal,
    checkAndHideLedgerModal,
} = ledgerActions;

class FundingAccount extends nearApiJs.Account {
    async signButDontSendTransaction(
        receiverId: string,
        actions: nearApiJs.transactions.Action[]
    ): Promise<[Uint8Array, nearApiJs.transactions.SignedTransaction]> {
        return await this.signTransaction(receiverId, actions);
    }
}

class LinkDropContract extends nearApiJs.Contract {
    get_key_balance;
    get_key_information;
}

export const convertPKForContract = (pk) => {
    if (typeof pk !== 'string') {
        pk = pk.toString();
    }
    return pk.replace('ed25519:', '');
};
export const toPK = (pk) => nearApiJs.utils.PublicKey.from(pk);

export async function setKeyMeta(publicKey, meta) {
    localStorage.setItem(`keyMeta:${publicKey}`, JSON.stringify(meta));
}

export async function getKeyMeta(publicKey) {
    try {
        return JSON.parse(localStorage.getItem(`keyMeta:${publicKey}`)) || {};
    } catch (e) {
        return {};
    }
}

export default class Wallet {
    accountId;
    accounts;
    connection: nearApiJs.Connection;
    connectionIgnoringLedger;
    keyStore;
    signer;
    signerIgnoringLedger;
    static instance;

    constructor(rpcInfo = null) {
        this.init(rpcInfo);
    }

    static get() {
        if (!Wallet.instance) {
            Wallet.instance = new Wallet();
        }
        return Wallet.instance;
    }

    init(rpcInfo = null) {
        const storedStatus = storedWalletDataActions.getStatus();

        this.keyStore = storedStatus.hasEncryptedData
            ? new nearApiJs.keyStores.InMemoryKeyStore()
            : new nearApiJs.keyStores.BrowserLocalStorageKeyStore(
                  window.localStorage,
                  KEY_STORE_PREFIX
              );

        // Just to make sure we actually always remove the localstorage values
        // if we are doing encrypted accounts
        if (storedStatus.hasEncryptedData) {
            removeAllAccountsPrivateKey();
        }

        this.signerIgnoringLedger = new nearApiJs.InMemorySigner(this.keyStore);

        const getSignerIgnoringLedger = () => {
            return rpcInfo ? wallet.signerIgnoringLedger : this.signerIgnoringLedger;
        };

        this.signer = {
            async getPublicKey(accountId, networkId) {
                const ledgerKey = await wallet.getLedgerKey(accountId);
                if (ledgerKey) {
                    return ledgerKey;
                }

                return await getSignerIgnoringLedger().getPublicKey(accountId, networkId);
            },
            async signMessage(message, accountId, networkId) {
                if (await wallet.getLedgerKey(accountId)) {
                    wallet.dispatchShowLedgerModal(true);
                    const path = getLedgerHDPath(accountId);

                    const { client } = ledgerManager;
                    if (!client) {
                        store.dispatch(checkAndHideLedgerModal());
                        store.dispatch(handleShowConnectModal());
                        throw new WalletError(
                            'The Ledger client is unavailable.',
                            'connectLedger.noClient'
                        );
                    }
                    const signature = await client.sign(message, path);
                    await store.dispatch(
                        setLedgerTxSigned({
                            status: true,
                            accountId,
                        })
                    );
                    const publicKey = await this.getPublicKey(accountId, networkId);
                    return {
                        signature,
                        publicKey,
                    };
                }

                return getSignerIgnoringLedger().signMessage(
                    message,
                    accountId,
                    networkId
                );
            },
        };
        let provider;
        if (rpcInfo) {
            const args: ConnectionInfo = { url: rpcInfo.shardRpc + '/' };
            if (rpcInfo.xSignature) {
                args.headers = {
                    'x-signature': rpcInfo.xSignature,
                };
            }
            provider = new RpcProvider(args);
        } else {
            provider = ConnectionsStorage.from(localStorage).createProvider();
        }
        this.connection = nearApiJs.Connection.fromConfig({
            networkId: CONFIG.NETWORK_ID,
            provider,
            signer: this.signer,
        });
        this.connectionIgnoringLedger = nearApiJs.Connection.fromConfig({
            networkId: CONFIG.NETWORK_ID,
            provider,
            signer: this.signerIgnoringLedger,
        });
        this.getAccountsLocalStorage();
        this.accountId = localStorage.getItem(KEY_ACTIVE_ACCOUNT_ID) || '';
    }

    static KEY_TYPES = {
        LEDGER: 'ledger',
        MULTISIG: 'multisig',
        FAK: 'fullAccessKey',
        OTHER: 'other',
    };

    // TODO-password-encryption: Need to add for passwordEncryption
    async removeWalletAccount(accountId) {
        const walletAccounts = this.getAccountsLocalStorage();
        delete walletAccounts[accountId];
        setWalletAccounts(KEY_WALLET_ACCOUNTS, walletAccounts);

        if (storedWalletDataActions.getStatus().hasEncryptedData) {
            await this.updateEncryptedAccountList(accountId, 'remove');
        } else {
            await this.keyStore.removeKey(CONFIG.NETWORK_ID, accountId);
        }

        removeActiveAccount(KEY_ACTIVE_ACCOUNT_ID);
        removeAccountConfirmed(accountId);
        return walletAccounts;
    }

    getAccountsLocalStorage() {
        return (this.accounts = JSON.parse(
            localStorage.getItem(KEY_WALLET_ACCOUNTS) || '{}'
        ));
    }

    async getLocalAccessKey(accountId, accessKeys) {
        const localPublicKey = await this.signerIgnoringLedger.getPublicKey(
            accountId,
            CONFIG.NETWORK_ID
        );
        return (
            localPublicKey &&
            accessKeys.find(({ public_key }) => public_key === localPublicKey.toString())
        );
    }

    async getLocalSecretKey(accountId) {
        const localKeyPair = await this.keyStore.getKey(CONFIG.NETWORK_ID, accountId);
        return localKeyPair ? localKeyPair.toString() : null;
    }

    async getLocalKeyPair(accountId) {
        return this.keyStore.getKey(CONFIG.NETWORK_ID, accountId);
    }

    async getLedgerKey(accountId) {
        // TODO: All callers should specify accountId explicitly
        accountId = accountId || this.accountId;
        // TODO: Refactor so that every account just stores a flag if it's on Ledger?

        // special handing for fixing issue #1919
        if (accountId === CONFIG.ACCOUNT_ID_SUFFIX) {
            return null;
        }

        const accessKeys = await this.getAccessKeys(accountId);
        if (accessKeys) {
            const localKey = await this.getLocalAccessKey(accountId, accessKeys);
            const ledgerKey = accessKeys.find(
                (accessKey) => accessKey.meta.type === 'ledger'
            );

            const localKeyIsNullOrNonMultisigLAK =
                !localKey ||
                (localKey.permission !== 'FullAccess' &&
                    !this.isMultisigKeyInfoView(accountId, localKey));

            if (ledgerKey && localKeyIsNullOrNonMultisigLAK) {
                return nearApiJs.utils.PublicKey.from(ledgerKey.public_key);
            }
        }
        return null;
    }

    save() {
        localStorage.setItem(KEY_ACTIVE_ACCOUNT_ID, this.accountId);
        localStorage.setItem(KEY_WALLET_ACCOUNTS, JSON.stringify(this.accounts));
    }

    isLegitAccountId(accountId) {
        return ACCOUNT_ID_REGEX.test(accountId);
    }

    isFullAccessKey(accountId, keypair) {
        return this.getAccessKeys(accountId).then((keys) => {
            const key = keys.find(
                ({ public_key }) => public_key === keypair.getPublicKey().toString()
            );

            return key?.access_key?.permission === 'FullAccess';
        });
    }

    async sendMoney(receiverId, amount) {
        return (await this.getAccount(this.accountId)).sendMoney(receiverId, amount);
    }

    isEmpty() {
        return !this.accounts || !Object.keys(this.accounts).length;
    }

    async isLedgerEnabled() {
        const accessKeys = await this.getAccessKeys();
        const ledgerKey = accessKeys.find((key) => key.meta.type === 'ledger');
        if (ledgerKey) {
            return true;
        }

        // additional check if the ledger is not connected but exists as a recovery method
        const userRecoveryMethods = await this.getRecoveryMethods();
        const accountState = await this.loadAccount();
        const hasLedger = userRecoveryMethods.some((method) => method.kind === 'ledger');
        const ledgerIsConnected = accountState.ledgerKey;
        const hasLedgerButNotConnected = hasLedger && !ledgerIsConnected;
        if (hasLedgerButNotConnected) {
            return true;
        }
    }

    async loadAccount(limitedAccountData = false) {
        if (!this.isEmpty()) {
            const accessKeys = limitedAccountData
                ? []
                : (await this.getAccessKeys()) || [];
            const ledgerKey = accessKeys.find((key) => key.meta.type === 'ledger');
            const account = await this.getAccount(this.accountId, limitedAccountData);
            const state = await account.state();

            return {
                ...state,
                has2fa: !!account.has2fa,
                balance: {
                    available: '',
                },
                accountId: this.accountId,
                accounts: this.accounts,
                accessKeys,
                authorizedApps: accessKeys.filter(
                    (it) =>
                        it.access_key &&
                        it.access_key.permission !== 'FullAccess' &&
                        it.access_key.permission.FunctionCall &&
                        it.access_key.permission.FunctionCall.receiver_id !==
                            this.accountId
                ),
                fullAccessKeys: accessKeys.filter(
                    (it) => it.access_key && it.access_key.permission === 'FullAccess'
                ),
                ledger: {
                    ledgerKey,
                    hasLedger: !!ledgerKey,
                },
            };
        }
    }

    async changeEncryptionPassword(oldPassword, newPassword) {
        await storedWalletDataActions.changePassword(oldPassword, newPassword);
        await this.unlockWallet();
    }

    async enablePasswordEncryption(password) {
        const accounts = retrieveAllAccountsPrivateKey();
        await storedWalletDataActions.setNewEncryptedData({ password, accounts });

        removeAllAccountsPrivateKey();
        this.keyStore = new nearApiJs.keyStores.InMemoryKeyStore();
        await this.unlockWallet();
    }

    async disablePasswordEncryption(password) {
        this.keyStore = new nearApiJs.keyStores.BrowserLocalStorageKeyStore(
            window.localStorage,
            KEY_STORE_PREFIX
        );

        await this.unlockWallet(password);
        storedWalletDataActions.removeEncryptedData();
        store.dispatch(passwordProtectedWallet.actions.updateStatus());
    }

    // TODO: Figure out whether wallet should work with any account or current one.
    // Maybe make wallet account specific and switch whole Wallet?
    async getAccessKeys(accountId = this.accountId) {
        if (!accountId) {
            return null;
        }

        const accessKeys = await (await this.getAccount(accountId)).getAccessKeys();
        return Promise.all(
            accessKeys.map(async (accessKey) => ({
                ...accessKey,
                meta: await getKeyMeta(accessKey.public_key),
            }))
        );
    }

    async getPublicKeyType(accountId, publicKeyString) {
        const allKeys = await this.getAccessKeys(accountId);
        const keyInfoView = allKeys.find(
            ({ public_key }) => public_key === publicKeyString
        );

        if (keyInfoView) {
            if (this.isFullAccessKeyInfoView(keyInfoView)) {
                return Wallet.KEY_TYPES.FAK;
            }
            if (this.isLedgerKeyInfoView(accountId, keyInfoView)) {
                return Wallet.KEY_TYPES.LEDGER;
            }
            if (this.isMultisigKeyInfoView(accountId, keyInfoView)) {
                return Wallet.KEY_TYPES.MULTISIG;
            }
            return Wallet.KEY_TYPES.OTHER;
        }

        throw new Error('No matching key pair for public key');
    }

    async getAccountKeyType(accountId) {
        const keypair = await wallet.keyStore.getKey(CONFIG.NETWORK_ID, accountId);
        return this.getPublicKeyType(accountId, keypair.getPublicKey().toString());
    }

    isFullAccessKeyInfoView(keyInfoView) {
        return keyInfoView?.access_key?.permission === 'FullAccess';
    }

    isLedgerKeyInfoView(accountId, keyInfoView) {
        const receiver_id =
            keyInfoView?.access_key?.permission?.FunctionCall?.receiver_id;
        const method_names =
            keyInfoView?.access_key?.permission?.FunctionCall?.method_names;
        return receiver_id === accountId && isEqual(method_names, ['__wallet__metadata']);
    }

    isMultisigKeyInfoView(accountId, keyInfoView) {
        const receiver_id =
            keyInfoView?.access_key?.permission?.FunctionCall?.receiver_id;
        const method_names =
            keyInfoView?.access_key?.permission?.FunctionCall?.method_names;
        return (
            receiver_id === accountId &&
            isEqual(method_names, [
                'add_request',
                'add_request_and_confirm',
                'delete_request',
                'confirm',
            ])
        );
    }

    async addExistingAccountKeyToWalletKeyStore(accountId, keyPair, ledgerHdPath) {
        const keyType = await this.getPublicKeyType(
            accountId,
            keyPair.getPublicKey().toString()
        );

        switch (keyType) {
            case Wallet.KEY_TYPES.FAK: {
                await this.saveAccount(accountId, keyPair);

                if (!this.accountId) {
                    return this.makeAccountActive(accountId);
                }
                return this.save();
            }
            case Wallet.KEY_TYPES.MULTISIG: {
                await this.saveAccount(accountId, keyPair);
                if (!this.accountId) {
                    return this.makeAccountActive(accountId);
                }
                return this.save();
            }
            case Wallet.KEY_TYPES.LEDGER: {
                await this.saveAccount(accountId, keyPair);
                if (ledgerHdPath) {
                    setLedgerHdPath({ accountId, path: ledgerHdPath });
                }
                await this.getLedgerPublicKey(ledgerHdPath).then((publicKey) =>
                    setKeyMeta(publicKey.toString(), { type: 'ledger' })
                );

                if (!this.accountId) {
                    return this.makeAccountActive(accountId);
                }
                return this.save();
            }
            default:
                throw new Error('Unable to add unrecognized key to wallet key store');
        }
    }

    async removeAccessKey(publicKey) {
        return await (await this.getAccount(this.accountId)).deleteKey(publicKey);
    }

    async removeNonLedgerAccessKeys() {
        const accessKeys = await this.getAccessKeys();
        const localAccessKey = await this.getLocalAccessKey(this.accountId, accessKeys);
        const account = await this.getAccount(this.accountId);
        const keysToRemove = accessKeys.filter(
            ({ public_key, access_key: { permission }, meta: { type } }) =>
                permission === 'FullAccess' &&
                type !== 'ledger' &&
                !(localAccessKey && public_key === localAccessKey.public_key)
        );

        const WALLET_METADATA_METHOD = '__wallet__metadata';
        let newLocalKeyPair;
        if (
            !localAccessKey ||
            !localAccessKey.access_key.permission.FunctionCall ||
            !localAccessKey.access_key.permission.FunctionCall.method_names.includes(
                WALLET_METADATA_METHOD
            )
        ) {
            // NOTE: This key isn't used to call actual contract method, just used to verify connection with account in private DB
            newLocalKeyPair = nearApiJs.KeyPair.fromRandom('ed25519');
            await account.addKey(
                newLocalKeyPair.getPublicKey(),
                this.accountId,
                WALLET_METADATA_METHOD,
                '0'
            );
        }

        for (const { public_key } of keysToRemove) {
            await account.deleteKey(public_key);
        }

        if (newLocalKeyPair) {
            if (localAccessKey) {
                await account.deleteKey(localAccessKey.public_key);
            }
            await this.keyStore.setKey(
                CONFIG.NETWORK_ID,
                this.accountId,
                newLocalKeyPair
            );
        }

        const recoveryMethods = await this.getRecoveryMethods();
        const methodsToRemove = recoveryMethods.filter(
            (method) => method.kind !== 'ledger'
        );
        for (const recoveryMethod of methodsToRemove) {
            await this.deleteRecoveryMethod(recoveryMethod);
        }
    }

    async checkAccountAvailable(accountId) {
        if (!this.isLegitAccountId(accountId)) {
            throw new Error('Invalid username.');
        }
        if (accountId !== this.accountId) {
            return await (await this.getAccount(accountId)).state();
        } else {
            throw new Error('You are logged into account ' + accountId + ' .');
        }
    }

    // TODO: Rename to make it clear that this is used to check if account can be created and that it throws. requireAccountNotExists?
    async checkNewAccount(accountId) {
        if (!this.isLegitAccountId(accountId)) {
            throw new Error('Invalid username.');
        }

        // TODO: This check doesn't seem up to date on what are current account name requirements
        // TODO: Is it even needed or is checked already both upstream/downstream?
        if (accountId.match(/.*[.@].*/)) {
            if (!accountId.endsWith(`.${CONFIG.ACCOUNT_ID_SUFFIX}`)) {
                throw new Error(
                    'Characters `.` and `@` have special meaning and cannot be used as part of normal account name.'
                );
            }
        }

        if (await this.accountExists(accountId)) {
            throw new Error('Account ' + accountId + ' already exists.');
        }

        return true;
    }

    async checkIsNew(accountId) {
        return !(await this.accountExists(accountId));
    }

    async sendIdentityVerificationMethodCode({
        kind,
        identityKey,
        recaptchaToken,
        recaptchaAction,
    }) {
        return await sendJson('POST', IDENTITY_VERIFICATION_METHOD_SEND_CODE_URL, {
            kind,
            identityKey,
            recaptchaToken,
            recaptchaAction,
            recaptchaSiteKey: CONFIG.RECAPTCHA_ENTERPRISE_SITE_KEY,
        });
    }

    async checkFundedAccountAvailable() {
        const { available } = await sendJson(
            'GET',
            CONFIG.ACCOUNT_KITWALLET_HELPER_URL + '/checkFundedAccountAvailable'
        );
        return available;
    }

    async createNewAccountWithNearContract({
        account,
        newAccountId,
        newPublicKey,
        newInitialBalance,
    }) {
        const {
            status: { SuccessValue: createResultBase64 },
            transaction: { hash: transactionHash },
        } = await account.functionCall({
            contractId: CONFIG.ACCOUNT_ID_SUFFIX,
            methodName: 'create_account',
            args: {
                new_account_id: newAccountId,
                new_public_key: newPublicKey.toString().replace(/^ed25519:/, ''),
            },
            gas: CONFIG.LINKDROP_GAS,
            attachedDeposit: newInitialBalance,
        });
        const createResult = JSON.parse(
            Buffer.from(createResultBase64, 'base64').toString()
        );
        if (!createResult) {
            throw new WalletError(
                'Creating account has failed',
                'createAccount.returnedFalse',
                { transactionHash }
            );
        }
    }

    async createNewAccountFromAnother(accountId, fundingAccountId, publicKey) {
        const account = await this.getAccount(fundingAccountId);

        await this.createNewAccountWithNearContract({
            account,
            newAccountId: accountId,
            newPublicKey: publicKey,
            newInitialBalance: CONFIG.MIN_BALANCE_FOR_GAS,
        });

        if (this.accounts[fundingAccountId] || fundingAccountId.length !== 64) {
            return;
        }

        // Check if account has any non-implicit keys (meaning account cannot be safely deleted)
        const accessKeys = await account.getAccessKeys();
        if (accessKeys.length !== 1) {
            return;
        }

        const [
            {
                access_key: { permission },
                public_key,
            },
        ] = accessKeys;
        const implicitPublicKey = new nearApiJs.utils.PublicKey({
            keyType: nearApiJs.utils.key_pair.KeyType.ED25519,
            data: Buffer.from(fundingAccountId, 'hex'),
        });

        if (permission !== 'FullAccess' || implicitPublicKey.toString() !== public_key) {
            return;
        }

        // TODO: Send transfer action as well to fail for sure if destination account doesn't exist?
        // Temporary implicit account used for funding – move whole balance by deleting it
        await account.deleteAccount(accountId);
    }

    async checkLinkdropInfo(fundingContract, fundingKey) {
        const account = await this.getAccount(fundingContract);

        const contract = new LinkDropContract(account, fundingContract, {
            changeMethods: [],
            viewMethods: ['get_key_balance', 'get_key_information'],
        });

        const key = (
            nearApiJs.KeyPair.fromString(fundingKey) as nearApiJs.utils.KeyPairEd25519
        ).publicKey.toString();

        const keyInfo = {
            required_gas: '100000000000000',
            yoctoNEAR: '0',
        };

        try {
            const returnedKeyInfo = await contract.get_key_information({ key });

            if (
                returnedKeyInfo.hasOwnProperty('yoctoNEAR') &&
                returnedKeyInfo.hasOwnProperty('required_gas')
            ) {
                return returnedKeyInfo;
            }

            const balance = await contract.get_key_balance({ key });
            keyInfo.yoctoNEAR = balance;
        } catch (e) {
            const balance = await contract.get_key_balance({ key });
            keyInfo.yoctoNEAR = balance;
        }

        return keyInfo;
    }

    async getLinkdropRequiredGas(fundingContract, fundingPubKey) {
        const account = new nearApiJs.Account(
            this.connectionIgnoringLedger,
            fundingContract
        );
        try {
            const key = await account.viewFunction(
                fundingContract,
                'get_drop_information',
                { key: fundingPubKey }
            );

            if (key.required_gas) {
                return key.required_gas;
            } else {
                const drop = await account.viewFunction(
                    fundingContract,
                    'get_drop_information',
                    { key: fundingPubKey }
                );
                return drop.required_gas || CONFIG.LINKDROP_GAS;
            }
        } catch {
            return CONFIG.LINKDROP_GAS;
        }
    }

    async createNewAccountLinkdrop(accountId, fundingContract, fundingKey, publicKey) {
        const fundingKeyPair = nearApiJs.KeyPair.fromString(fundingKey);
        const account = new FundingAccount(
            this.connectionIgnoringLedger,
            fundingContract
        );
        const fundingPubKey = fundingKeyPair.getPublicKey().toString();
        const attachedGas = await this.getLinkdropRequiredGas(
            fundingContract,
            fundingPubKey
        );
        await this.keyStore.setKey(CONFIG.NETWORK_ID, fundingContract, fundingKeyPair);
        const [, signedTx] = await account.signButDontSendTransaction(fundingContract, [
            nearApiJs.transactions.functionCall(
                'create_account_and_claim',
                {
                    new_account_id: accountId,
                    new_public_key: publicKey.toString().replace('ed25519:', ''),
                },
                attachedGas,
                0
            ),
        ]);
        return await getNearRpcClient(
            (CONFIG.IS_MAINNET ? 'mainnet' : 'testnet') as ENearNetwork,
            (this.connection.provider as nearApiJs.providers.JsonRpcProvider).connection
                .url
        ).custom_broadcast_tx_async_wait_all_receipts({
            signed_transaction_base64: Buffer.from(signedTx.encode()).toString('base64'),
            sender_account_id: fundingContract,
        });
    }

    async claimLinkdropToAccount(fundingContract, fundingKey) {
        const fundingKeyPair = nearApiJs.KeyPair.fromString(fundingKey);
        const account = new FundingAccount(
            this.connectionIgnoringLedger,
            fundingContract
        );
        const accountId = this.accountId;
        const fundingPubKey = fundingKeyPair.getPublicKey().toString();
        const attachedGas = await this.getLinkdropRequiredGas(
            fundingContract,
            fundingPubKey
        );

        await this.keyStore.setKey(CONFIG.NETWORK_ID, fundingContract, fundingKeyPair);
        const [, signedTx] = await account.signButDontSendTransaction(fundingContract, [
            nearApiJs.transactions.functionCall(
                'claim',
                { account_id: accountId },
                attachedGas,
                0
            ),
        ]);

        return await getNearRpcClient(
            (CONFIG.IS_MAINNET ? 'mainnet' : 'testnet') as ENearNetwork,
            (this.connection.provider as nearApiJs.providers.JsonRpcProvider).connection
                .url
        ).custom_broadcast_tx_async_wait_all_receipts({
            signed_transaction_base64: Buffer.from(signedTx.encode()).toString('base64'),
            sender_account_id: fundingContract,
        });
    }

    async saveAccountKeyPair({ accountId, recoveryKeyPair }) {
        await this.keyStore.setKey(this.connection.networkId, accountId, recoveryKeyPair);
    }

    async unlockWallet(password = undefined) {
        const sensitiveData = await storedWalletDataActions.getEncryptedData(password);

        store.dispatch(passwordProtectedWallet.actions.signIn());

        // Step 4: Set the key to the wallet InMemoryKeystore for transaction signing
        await Promise.all(
            sensitiveData.accounts.map(
                async (account) =>
                    await this.setKey(account.accountId, account.privateKey)
            )
        );
    }

    async updateEncryptedAccountList(accountId, action = 'add', keyPair = null) {
        // Step 1: Get encrypted data from memory storage (if we don't provide a password, it uses the data in memory)
        const sensitiveData = await storedWalletDataActions.getEncryptedData();
        const decryptedAccounts = [...sensitiveData.accounts];

        // Step 2: Based on the action, add or remove the account from the decrypted accounts list
        const accountIndex = decryptedAccounts.findIndex(
            (account) => account.accountId === accountId
        );

        if (action === 'add' && keyPair) {
            if (accountIndex < 0) {
                decryptedAccounts.push({
                    accountId,
                    privateKey: keyPair.secretKey,
                });
            } else {
                decryptedAccounts[accountIndex] = {
                    accountId,
                    privateKey: keyPair.secretKey,
                };
            }
        } else if (action === 'remove') {
            decryptedAccounts.splice(accountIndex, 1);
        }

        /*// Step 3: Encrypt the new list of accounts and save it in local storage
        const newEncryptedData = await EncryptionDecryptionUtils.encrypt(
            derivedPassword,
            decryptedAccounts
        );
        setEncryptedData({
            salt: newEncryptedData.salt,
            encryptedData: newEncryptedData.payload,
            isEncryptionEnabled: true,
        });*/
        await storedWalletDataActions.updateEncryptedData({
            accounts: decryptedAccounts,
        });

        // Step 4: Reinit the wallet instance and unlock it to make sure we have the right key store with updated list of keys
        this.init();
        await this.unlockWallet();
    }

    async saveAccount(accountId, keyPair = undefined) {
        this.getAccountsLocalStorage();

        if (keyPair) {
            if (storedWalletDataActions.getStatus().hasEncryptedData) {
                await this.updateEncryptedAccountList(accountId, 'add', keyPair);
            } else {
                await this.setKey(accountId, keyPair);
            }
        }

        this.accounts[accountId] = true;
        this.save();

        addAccountReducer();
    }

    makeAccountActive(accountId) {
        if (!(accountId in this.accounts)) {
            return false;
        }
        this.accountId = accountId;
        this.save();
    }

    async saveAndMakeAccountActive(accountId, keyPair) {
        await this.saveAccount(accountId, keyPair);
        this.makeAccountActive(accountId);
        // TODO: What does setAccountConfirmed do?
        setAccountConfirmed(this.accountId, false);
    }

    async importZeroBalanceAccount(accountId, keyPair) {
        await this.saveAccount(accountId, keyPair);
        this.makeAccountActive(accountId);
        setAccountConfirmed(this.accountId, true);
    }

    async setKey(accountId, keyPair) {
        if (keyPair) {
            await this.keyStore.setKey(CONFIG.NETWORK_ID, accountId, keyPair);
        }
    }

    /********************************
     recovering a second account attempts to call this method with the currently logged in account and not the tempKeyStore
     ********************************/
    // TODO: Why is fullAccess needed? Everything without contractId should be full access.
    async addAccessKey(
        accountId,
        contractId,
        publicKey,
        fullAccess = false,
        methodNames = '',
        recoveryKeyIsFAK = false
    ) {
        const account = recoveryKeyIsFAK
            ? new nearApiJs.Account(this.connection, accountId)
            : await this.getAccount(accountId);

        const has2fa = await TwoFactor.has2faEnabled(account);

        try {
            // TODO: Why not always pass `fullAccess` explicitly when it's desired?
            // TODO: Alternatively require passing MULTISIG_CHANGE_METHODS from caller as `methodNames`
            if (
                fullAccess ||
                (!has2fa && accountId === contractId && !methodNames.length)
            ) {
                console.log('adding full access key', publicKey.toString());
                return await account.addKey(publicKey);
            } else {
                const isMultisig =
                    has2fa && !methodNames.length && accountId === contractId;
                const finalMethodNames = isMultisig
                    ? nearApiJs.multisig.MULTISIG_CHANGE_METHODS
                    : methodNames;
                return await account.addKey(
                    publicKey.toString(),
                    contractId,
                    finalMethodNames,
                    CONFIG.ACCESS_KEY_FUNDING_AMOUNT
                );
            }
        } catch (e) {
            if (e.type === 'AddKeyAlreadyExists') {
                return true;
            }
            throw e;
        }
    }

    async addLedgerAccessKey(path, accountIdOverride) {
        const accountId = accountIdOverride || this.accountId;

        // additional check if the 2fa is enabled, in case the user was able to omit disabled buttons
        const account = new nearApiJs.Account(this.connection, accountId);
        const has2fa = await TwoFactor.has2faEnabled(account);
        // throw error if 2fa is enabled
        if (has2fa) {
            throw new WalletError(
                'Two-Factor Authentication is enabled',
                'addLedgerAccessKey.2faEnabled'
            );
        }

        const ledgerPublicKey = await this.getLedgerPublicKey(path);
        const accessKeys = await this.getAccessKeys(accountId);
        const accountHasLedgerKey = accessKeys.some(
            (key) => key.public_key === ledgerPublicKey.toString()
        );

        await setKeyMeta(ledgerPublicKey, { type: 'ledger' });

        if (!accountHasLedgerKey) {
            const account = await this.getAccount(accountId);
            await account.addKey(ledgerPublicKey);
            await this.postSignedJson('/account/ledgerKeyAdded', {
                accountId,
                publicKey: ledgerPublicKey.toString(),
            });
        }
    }

    async exportToLedgerWallet(path, accountId) {
        const ledgerPublicKey = await this.getLedgerPublicKey(path);
        const accessKeys = await this.getAccessKeys(accountId);
        const accountHasLedgerKey = accessKeys.some(
            (key) => key.public_key === ledgerPublicKey.toString()
        );

        if (!accountHasLedgerKey) {
            const account = await this.getAccount(accountId);
            const has2fa = await TwoFactor.has2faEnabled(account);

            if (has2fa) {
                await store.dispatch(
                    switchAccount({
                        accountId: account.accountId,
                    })
                );
            }
            await account.addKey(ledgerPublicKey);
        }
    }

    async disableLedger() {
        const account = await this.getAccount(this.accountId);
        const keyPair: nearApiJs.utils.KeyPairEd25519 = nearApiJs.KeyPair.fromRandom(
            'ed25519'
        ) as nearApiJs.utils.KeyPairEd25519;
        await account.addKey(keyPair.publicKey);
        await this.keyStore.setKey(CONFIG.NETWORK_ID, this.accountId, keyPair);

        const path = getLedgerHDPath(this.accountId);
        const publicKey = await this.getLedgerPublicKey(path);
        await this.removeAccessKey(publicKey);
        await this.getAccessKeys(this.accountId);

        await this.deleteRecoveryMethod({
            kind: 'ledger',
            publicKey: publicKey.toString(),
        });
        removeLedgerHDPath(this.accountId);
    }

    async addWalletMetadataAccessKeyIfNeeded(accountId, localAccessKey) {
        if (
            !localAccessKey ||
            !localAccessKey.access_key.permission.FunctionCall ||
            !localAccessKey.access_key.permission.FunctionCall.method_names.includes(
                WALLET_METADATA_METHOD
            )
        ) {
            // NOTE: This key isn't used to sign transaction, just used to verify connection with account in private DB
            const newLocalKeyPair = nearApiJs.KeyPair.fromRandom('ed25519');
            const account = await this.getAccount(accountId);
            try {
                await account.addKey(
                    newLocalKeyPair.getPublicKey(),
                    accountId,
                    WALLET_METADATA_METHOD,
                    '0'
                );
            } catch (error) {
                if (error.type === 'KeyNotFound') {
                    throw new WalletError(
                        'No accounts were found.',
                        'getLedgerAccountIds.noAccounts'
                    );
                }
                throw error;
            }
            return newLocalKeyPair;
        }

        return null;
    }

    async getLedgerAccountIds({ path }) {
        const publicKey = await this.getLedgerPublicKey(path);
        await setKeyMeta(publicKey, { type: 'ledger' });

        let accountIds;
        try {
            const waitAllIndexer = true;
            accountIds = await getAccountIds(publicKey, waitAllIndexer);
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new WalletError('Fetch aborted.', 'getLedgerAccountIds.aborted');
            }
            throw error;
        }

        const checkedAccountIds = (
            await Promise.all(
                accountIds.map(async (accountId) => {
                    try {
                        const account = await this.getAccount(accountId);
                        const accountKeys = await account.getAccessKeys();
                        return accountKeys.find(
                            ({ public_key }) => public_key === publicKey.toString()
                        )
                            ? accountId
                            : null;
                    } catch (error) {
                        if (
                            error.toString().indexOf('does not exist while viewing') !==
                            -1
                        ) {
                            return null;
                        }
                        throw error;
                    }
                })
            )
        )
            // todo: implicit boolean cast, maybe .filter((accountId) => Boolean(accountId)) ?
            .filter((accountId) => accountId);

        if (!checkedAccountIds.length) {
            throw new WalletError(
                'No accounts were found.',
                'getLedgerAccountIds.noAccounts'
            );
        }

        return checkedAccountIds;
    }

    async addLedgerAccountId({ accountId }) {
        try {
            const accessKeys = await this.getAccessKeys(accountId);
            const localAccessKey = await this.getLocalAccessKey(accountId, accessKeys);

            const newKeyPair = await this.addWalletMetadataAccessKeyIfNeeded(
                accountId,
                localAccessKey
            );

            if (storedWalletDataActions.getStatus().hasEncryptedData) {
                await this.updateEncryptedAccountList(accountId, 'add', newKeyPair);
            } else {
                await this.setKey(accountId, newKeyPair);
            }
        } catch (error) {
            if (error.name !== 'TransportStatusError') {
                throw new WalletError(error.message, 'addLedgerAccountId.errorRpc');
            }
            throw error;
        }
    }

    async saveAndSelectLedgerAccounts({ accounts }) {
        const accountIds = Object.keys(accounts).filter(
            (accountId) => accounts[accountId].status === 'success'
        );

        if (!accountIds.length) {
            throw new WalletError(
                'No accounts were accepted.',
                'getLedgerAccountIds.noAccountsAccepted'
            );
        }

        for (
            let accountIdIndex = 0;
            accountIdIndex < accountIds.length;
            accountIdIndex++
        ) {
            const accountId = accountIds[accountIdIndex];
            await this.saveAccount(accountId);
        }

        // await Promise.all(
        //     accountIds.map(async (accountId) => {
        //         await this.saveAccount(accountId);
        //     })
        // );

        store.dispatch(makeAccountActive(accountIds[accountIds.length - 1]));

        return {
            numberOfAccounts: accountIds.length,
        };
    }

    async getLedgerPublicKey(path) {
        const { client } = ledgerManager;
        if (!client) {
            store.dispatch(checkAndHideLedgerModal());
            store.dispatch(handleShowConnectModal());
            throw new WalletError(
                'The Ledger client is unavailable.',
                'connectLedger.noClient'
            );
        }
        this.dispatchShowLedgerModal(true);
        const rawPublicKey = await client.getPublicKey(path);
        return new nearApiJs.utils.PublicKey({
            keyType: nearApiJs.utils.key_pair.KeyType.ED25519,
            data: rawPublicKey,
        });
    }

    async getAvailableKeys() {
        const keyPair = await this.keyStore.getKey(CONFIG.NETWORK_ID, this.accountId);
        const availableKeys = [keyPair.publicKey];
        const ledgerKey = await this.getLedgerKey(this.accountId);
        if (ledgerKey) {
            availableKeys.push(ledgerKey.toString());
        }
        return availableKeys;
    }

    getAccountBasic(accountId) {
        return new nearApiJs.Account(this.connection, accountId);
    }

    async getAccount(accountId, limitedAccountData = false) {
        const AccountWithAdjustedStorageCost = withAdjustedStorageCost(nearApiJs.Account);
        let account = new AccountWithAdjustedStorageCost(this.connection, accountId);

        const TwoFactorWithAdjustedStorageCost = withAdjustedStorageCost(TwoFactor);
        const has2fa = await TwoFactor.has2faEnabled(account);
        if (has2fa) {
            account = new TwoFactorWithAdjustedStorageCost(this, accountId, has2fa);
        }

        // TODO: Check if lockup needed somehow? Should be changed to async? Should just check in wrapper?
        if (limitedAccountData) {
            return account;
        }
        return decorateWithLockup(account);
    }

    async getBalance(accountId, limitedAccountData = false) {
        accountId = accountId || this.accountId;
        if (!accountId) {
            return false;
        }

        const account = await this.getAccount(accountId);
        return await account.getAccountBalance(limitedAccountData);
    }

    async generatePrivateShardXSignature(shardInfo) {
        const calimeroConfig = {
            shardId: shardInfo.shardId,
            calimeroUrl: CONFIG.CALIMERO_URL,
            rpcEndpoint: shardInfo.shardRpc,
            walletNetworkId: CONFIG.NETWORK_ID,
        };

        const calimeroWalletUtils = CalimeroWalletUtils.init(calimeroConfig);
        const account = await wallet.getAccount(wallet.accountId);
        const signer = account.signerIgnoringLedger || account.connection.signer;

        const challenge = await calimeroWalletUtils.fetchChallenge();

        const signedChallenge = await signer.signMessage(
            Buffer.from(challenge.data),
            account.accountId,
            CONFIG.NETWORK_ID
        );

        const signedChallengePayload = Buffer.from(
            JSON.stringify({
                challenge: challenge.data,
                signature: Buffer.from(signedChallenge.signature).toString('base64'),
                publicKey: signedChallenge.publicKey.toString(),
                accountId: account.accountId,
            })
        ).toString('base64');

        return signedChallengePayload;
    }

    async signatureFor(account) {
        const { accountId } = account;
        const block = await account.connection.provider.block({
            finality: 'final',
        });
        const blockNumber = block.header.height.toString();
        const signer = account.signerIgnoringLedger || account.connection.signer;
        const signed = await signer.signMessage(
            Buffer.from(blockNumber),
            accountId,
            CONFIG.NETWORK_ID
        );
        const blockNumberSignature = Buffer.from(signed.signature).toString('base64');
        return { blockNumber, blockNumberSignature };
    }

    async postSignedJson(path, options) {
        return await sendJson('POST', CONFIG.ACCOUNT_KITWALLET_HELPER_URL + path, {
            ...options,
            ...(await this.signatureFor(this)),
        });
    }

    async initializeRecoveryMethodNewImplicitAccount(method) {
        const { seedPhrase } = generateSeedPhrase();
        const { secretKey } = parseSeedPhrase(seedPhrase);
        const recoveryKeyPair: nearApiJs.utils.KeyPairEd25519 =
            nearApiJs.KeyPair.fromString(secretKey) as nearApiJs.utils.KeyPairEd25519;
        const implicitAccountId = Buffer.from(recoveryKeyPair.publicKey.data).toString(
            'hex'
        );

        const body = {
            accountId: implicitAccountId,
            method,
            seedPhrase,
        };
        await sendJson(
            'POST',
            CONFIG.ACCOUNT_KITWALLET_HELPER_URL +
                '/account/initializeRecoveryMethodForTempAccount',
            body
        );
        return seedPhrase;
    }

    async initializeRecoveryMethod(accountId, method) {
        const { seedPhrase } = generateSeedPhrase();
        const isNew = await this.checkIsNew(accountId);
        const body = {
            accountId,
            method,
            seedPhrase,
        };
        if (isNew) {
            await sendJson(
                'POST',
                CONFIG.ACCOUNT_KITWALLET_HELPER_URL +
                    '/account/initializeRecoveryMethodForTempAccount',
                body
            );
        } else {
            await this.postSignedJson('/account/initializeRecoveryMethod', body);
        }
        return seedPhrase;
    }

    async validateSecurityCodeNewImplicitAccount(
        implicitAccountId,
        method,
        securityCode,
        publicKey
    ) {
        try {
            await sendJson(
                'POST',
                CONFIG.ACCOUNT_KITWALLET_HELPER_URL +
                    '/account/validateSecurityCodeForTempAccount',
                {
                    accountId: implicitAccountId,
                    method,
                    publicKey,
                    securityCode,
                }
            );
        } catch (e) {
            throw new WalletError(
                'Invalid code',
                'setupRecoveryMessageNewAccount.invalidCode'
            );
        }
    }

    async validateSecurityCode(
        accountId,
        method,
        securityCode,
        enterpriseRecaptchaToken,
        recaptchaAction,
        publicKey
    ) {
        const isNew = await this.checkIsNew(accountId);
        const body = {
            accountId,
            method,
            publicKey,
            securityCode,
        };

        try {
            if (isNew) {
                await sendJson(
                    'POST',
                    CONFIG.ACCOUNT_KITWALLET_HELPER_URL +
                        '/account/validateSecurityCodeForTempAccount',
                    {
                        ...body,
                        enterpriseRecaptchaToken,
                        recaptchaAction,
                        recaptchaSiteKey: CONFIG.RECAPTCHA_ENTERPRISE_SITE_KEY,
                    }
                );
            } else {
                await this.postSignedJson('/account/validateSecurityCode', body);
            }
        } catch (e) {
            throw new WalletError(
                'Invalid code',
                'setupRecoveryMessageNewAccount.invalidCode'
            );
        }
    }

    async getRecoveryMethods() {
        const { accountId } = this;
        const recoveryMethods = await this.postSignedJson('/account/recoveryMethods', {
            accountId,
        });
        const accessKeys = await this.getAccessKeys();
        const publicKeys = accessKeys.map((key) => key.public_key);
        const publicKeyMethods = recoveryMethods.filter(({ publicKey }) =>
            publicKeys.includes(publicKey)
        );
        const twoFactorMethods = recoveryMethods.filter(
            ({ kind }) => kind.indexOf('2fa-') === 0
        );

        return [...publicKeyMethods, ...twoFactorMethods];
    }

    async setupRecoveryMessage(accountId, method, securityCode, recoverySeedPhrase) {
        const { publicKey } = parseSeedPhrase(recoverySeedPhrase);
        const recaptchaToken = undefined;
        const recaptchaAction = undefined;

        await this.validateSecurityCode(
            accountId,
            method,
            securityCode,
            recaptchaToken,
            recaptchaAction,
            publicKey
        );

        try {
            await this.addNewAccessKeyToAccount(accountId, publicKey);
        } catch (e) {
            console.error(e);
            throw new WalletError(e.message, 'recoveryMethods.setupMethod');
        } finally {
            await store.dispatch(
                redirectTo('/profile', {
                    globalAlertPreventClear: true,
                })
            );
        }
    }

    async addNewAccessKeyToAccount(accountId, newPublicKey) {
        const account = await this.getAccount(accountId);
        const accountKeys = await account.getAccessKeys();

        if (!accountKeys.some((it) => it.public_key.endsWith(newPublicKey))) {
            await this.addAccessKey(
                accountId,
                accountId,
                convertPKForContract(newPublicKey)
            );
        }
    }

    async deleteRecoveryMethod({ kind, publicKey }, deleteAllowed = true) {
        const accessKeys = await this.getAccessKeys();
        const pubKeys = accessKeys.map((key) => key.public_key);

        if (deleteAllowed) {
            if (pubKeys.includes(publicKey)) {
                await this.removeAccessKey(publicKey);
            }
            await this.postSignedJson('/account/deleteRecoveryMethod', {
                accountId: this.accountId,
                kind,
                publicKey,
            });
        } else {
            throw new WalletError(
                'Cannot delete last recovery method',
                'recoveryMethods.lastMethod'
            );
        }
    }

    async accountExists(accountId) {
        try {
            await (await this.getAccount(accountId)).state();
            return true;
        } catch (error) {
            if (error.toString().indexOf('does not exist while viewing') !== -1) {
                return false;
            }
            throw error;
        }
    }

    async recoverAccountSeedPhrase(
        seedPhrase,
        accountId,
        shouldCreateFullAccessKey = true,
        shouldGetAccountIdList = true,
        shouldSelectMultipleAccounts = false
    ) {
        const { secretKey } = parseSeedPhrase(seedPhrase);
        return await this.recoverAccountSecretKey(
            secretKey,
            accountId,
            shouldCreateFullAccessKey,
            shouldGetAccountIdList,
            shouldSelectMultipleAccounts
        );
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async recoverAccountSecretKey(
        secretKey,
        accountId,
        shouldCreateFullAccessKey,
        shouldGetAccountIdList = true,
        shouldSelectMultipleAccounts
    ) {
        const keyPair: nearApiJs.utils.KeyPairEd25519 = nearApiJs.KeyPair.fromString(
            secretKey
        ) as nearApiJs.utils.KeyPairEd25519;
        const publicKey = keyPair.publicKey.toString();

        const tempKeyStore = new nearApiJs.keyStores.InMemoryKeyStore();

        let accountIds = [];
        if (shouldGetAccountIdList) {
            const accountIdsByPublicKey = await getAccountIds(publicKey);
            if (!accountId) {
                accountIds = accountIdsByPublicKey;
            } else if (accountIdsByPublicKey.includes(accountId)) {
                accountIds = [accountId];
            }
        } else if (!!accountId) {
            accountIds = [accountId];
        }

        // remove duplicate and non-existing accounts
        const accountsSet = new Set(accountIds);
        for (const accountId of accountsSet) {
            const isAccountExist = await this.accountExists(accountId);
            if (!isAccountExist) {
                accountsSet.delete(accountId);
            }
        }
        accountIds = [...accountsSet];

        const accountIdsError = [];
        if (!accountIds.length) {
            const implicitAccountId = Buffer.from(keyPair.getPublicKey().data).toString(
                'hex'
            );
            try {
                const account = await this.getAccount(implicitAccountId);
                if (account) {
                    const accessKeys = await this.getAccessKeys(implicitAccountId);
                    const hasMatchedPublicKey = accessKeys.some(
                        ({ public_key }) => public_key === publicKey
                    );
                    if (!hasMatchedPublicKey) {
                        throw new WalletError(
                            `No matching key pair for public key ${publicKey}`,
                            'recoverAccountSeedPhrase.keyPairUnmatch',
                            { errorCode: 'keyPairUnmatch' }
                        );
                    }
                    accountIds.push(implicitAccountId);
                } else {
                    throw new WalletError(
                        `Cannot find matching public key: ${publicKey}`,
                        'recoverAccountSeedPhrase.errorInvalidSeedPhrase',
                        { errorCode: 'noPublicKeyMatch' }
                    );
                }
            } catch (err) {
                const provider = new nearApiJs.providers.JsonRpcProvider({
                    url: (this.connection.provider as nearApiJs.providers.JsonRpcProvider)
                        .connection.url,
                });
                const accessKeys = await provider
                    .query<AccessKeyList>({
                        request_type: 'view_access_key_list',
                        finality: 'optimistic',
                        account_id: implicitAccountId,
                    })
                    .then((r) => r?.keys || []);

                const hasMatchedPublicKey = accessKeys.some(
                    ({ public_key }) => public_key === publicKey
                );
                if (accessKeys.length && !hasMatchedPublicKey) {
                    throw new WalletError(
                        `No matching key pair for public key ${publicKey}`,
                        'recoverAccountSeedPhrase.keyPairUnmatch',
                        { errorCode: 'keyPairUnmatch' }
                    );
                }

                throw new WalletError(
                    `Account not exist for public key: ${publicKey}`,
                    'recoverAccountSeedPhrase.errorInvalidSeedPhrase',
                    { errorCode: 'accountNotExist' }
                );
            }
        }

        const connection = nearApiJs.Connection.fromConfig({
            networkId: CONFIG.NETWORK_ID,
            provider: this.connection.provider,
            signer: new nearApiJs.InMemorySigner(tempKeyStore),
        });

        const connectionConstructor = this.connection;

        const accountIdsSuccess = [];
        await Promise.all(
            accountIds.map(async (accountId) => {
                if (!accountId || !accountId.length) {
                    return;
                }
                // temp account
                this.connection = connection;
                this.accountId = accountId;
                const account = await this.getAccount(accountId);
                let recoveryKeyIsFAK = false;

                // check for keypair match
                const accessKeys = await this.getAccessKeys(accountId);
                const hasFullAccessKey = accessKeys.some(
                    (key) => key.access_key.permission === 'FullAccess'
                );

                const has2faEnabled = await TwoFactor.has2faEnabled(account);

                const hasMatchedPublicKey = accessKeys.some(
                    ({ public_key }) => public_key === publicKey
                );

                if (!accessKeys.length || !(has2faEnabled || hasFullAccessKey)) {
                    accountIdsError.push({
                        accountId,
                        error: new WalletError(
                            `No access key found for ${accountId}`,
                            'recoverAccountSeedPhrase.errorGeneral'
                        ),
                    });
                    return;
                }

                // private key doesnt match with their public key
                if (!hasMatchedPublicKey) {
                    accountIdsError.push({
                        accountId,
                        error: new WalletError(
                            `No matching key pair for public key ${publicKey}`,
                            'recoverAccountSeedPhrase.keyPairUnmatch',
                            { errorCode: 'keyPairUnmatch' }
                        ),
                    });
                    return;
                }

                // check if recover access key is FAK and if so add key without 2FA
                if (has2faEnabled) {
                    recoveryKeyIsFAK = accessKeys.find(
                        ({ public_key, access_key }) =>
                            public_key === publicKey &&
                            access_key.permission &&
                            access_key.permission === 'FullAccess'
                    );
                    if (recoveryKeyIsFAK) {
                        console.log('using FAK and regular Account instance to recover');
                        shouldCreateFullAccessKey = false;
                    }
                }

                await tempKeyStore.setKey(CONFIG.NETWORK_ID, accountId, keyPair);
                account.keyStore = tempKeyStore;

                // todo WARNING, should be refactored: attempt to assign to const or readonly var
                account.signerIgnoringLedger = account.connection.signer =
                    new nearApiJs.InMemorySigner(tempKeyStore);

                // const newKeyPair: KeyPairEd25519 = nearApiJs.KeyPair.fromRandom(
                //     'ed25519'
                // ) as KeyPairEd25519;

                try {
                    // const methodNames = '';
                    // await this.addAccessKey(
                    //     accountId,
                    //     accountId,
                    //     newKeyPair.publicKey,
                    //     shouldCreateFullAccessKey,
                    //     methodNames,
                    //     recoveryKeyIsFAK
                    // );
                    accountIdsSuccess.push({
                        accountId,
                        newKeyPair: keyPair,
                    });
                } catch (error) {
                    console.error(error);
                    accountIdsError.push({
                        accountId,
                        error,
                    });
                }
            })
        );

        this.connection = connectionConstructor;

        if (!!accountIdsSuccess.length) {
            if (!shouldSelectMultipleAccounts) {
                await Promise.all(
                    accountIdsSuccess.map(async ({ accountId, newKeyPair }) => {
                        await this.saveAccount(accountId, newKeyPair);
                    })
                );

                const accountId =
                    accountIdsSuccess[accountIdsSuccess.length - 1].accountId;
                store.dispatch(makeAccountActive(accountId));
            }

            return {
                numberOfAccounts: accountIdsSuccess.length,
                accountList: accountIdsSuccess
                    .flatMap((accountId) => accountId.account_id)
                    .join(', '),
                accountIdsSuccess,
            };
        } else {
            const lastAccount = accountIdsError
                .reverse()
                .find((account) => account.error.type === 'LackBalanceForState');

            if (lastAccount) {
                this.accountId = localStorage.getItem(KEY_ACTIVE_ACCOUNT_ID) || '';
                store.dispatch(
                    redirectTo(`/profile/${lastAccount.accountId}`, {
                        globalAlertPreventClear: true,
                    })
                );

                throw lastAccount.error;
            } else {
                throw accountIdsError[accountIdsError.length - 1].error;
            }
        }
    }

    async signAndSendTransactions(transactions, accountId = this.accountId) {
        const account = await this.getAccount(accountId);

        const transactionHashes = [];
        for (const { receiverId, nonce, blockHash, actions } of transactions) {
            let status, transaction;
            // TODO: Decide whether we always want to be recreating transaction (vs only if it's invalid)
            // See https://github.com/near/near-wallet/issues/1856
            const recreateTransaction = account.deployMultisig || true;
            if (recreateTransaction) {
                try {
                    ({ status, transaction } = await account.signAndSendTransaction({
                        receiverId,
                        actions,
                    }));
                } catch (error) {
                    if (error.message.includes('Exceeded the prepaid gas')) {
                        throw new WalletError(error.message, error.code, {
                            transactionHashes,
                        });
                    }

                    throw error;
                }
            } else {
                // TODO: Maybe also only take receiverId and actions as with multisig path?
                const [, signedTransaction] =
                    await nearApiJs.transactions.signTransaction(
                        receiverId,
                        nonce,
                        actions,
                        blockHash,
                        this.connection.signer,
                        accountId,
                        CONFIG.NETWORK_ID
                    );
                ({ status, transaction } = await this.connection.provider.sendTransaction(
                    signedTransaction
                ));
            }

            // TODO: Shouldn't throw more specific errors on failure?
            if (status.Failure !== undefined) {
                throw new Error(
                    `Transaction failure for transaction hash: ${transaction.hash}, receiver_id: ${transaction.receiver_id} .`
                );
            }
            transactionHashes.push({
                hash: transaction.hash,
                nonceString: nonce.toString(),
            });
        }

        return transactionHashes;
    }

    dispatchShowLedgerModal(show) {
        const { actionStatus } = store.getState().status;
        const actions = Object.keys(actionStatus).filter(
            (action) => actionStatus[action]?.pending === true
        );
        const action = actions.length ? actions[actions.length - 1] : false;
        store.dispatch(showLedgerModal({ show, action }));
    }

    async signMessage(message, accountId = this.accountId) {
        const account = await this.getAccount(accountId);
        const signer = account.signerIgnoringLedger || account.connection.signer;
        const signed = await signer.signMessage(
            Buffer.from(message),
            accountId,
            CONFIG.NETWORK_ID
        );
        return {
            accountId,
            signed,
        };
    }

    async getPublicKey(accountId = this.accountId) {
        const account = await this.getAccount(accountId);
        const signer = account.signerIgnoringLedger || account.connection.signer;
        return signer.getPublicKey(accountId, CONFIG.NETWORK_ID);
    }
}

export const wallet = Wallet.get();
