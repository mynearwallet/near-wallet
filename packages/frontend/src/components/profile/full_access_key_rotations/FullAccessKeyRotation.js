import bip39 from 'bip39-light';
import * as nearApiJs from 'near-api-js';
import { parseSeedPhrase } from 'near-seed-phrase';
import React from 'react';
import { Translate } from 'react-localize-redux';
import { useDispatch, useSelector } from 'react-redux';
import styled from 'styled-components';

import CONFIG from '../../../config';
import {
    getAccessKeys,
    recoverAccountSecretKey,
    refreshAccount,
    removeAccessKey,
} from '../../../redux/actions/account';
import { showCustomAlert } from '../../../redux/actions/status';
import {
    selectAccountId,
    selectAccountFullAccessKeys,
} from '../../../redux/slices/account';
import { wallet } from '../../../utils/wallet';
import FormButton from '../../common/FormButton';
import FormButtonGroup from '../../common/FormButtonGroup';

const Container = styled.div`
    &&& {
        border: 2px solid #f0f0f0;
        border-radius: 8px;
        padding: 20px;

        .title {
            color: #3f4045;
            font-weight: 600;
            margin-bottom: 25px;
            display: flex;
            align-items: center;
            justify-content: space-between;

            > button {
                margin: 0;
            }
        }

        .key {
            color: #3f4045;
            background-color: #fafafa;
            border: 1px solid #f0f0f1;
            border-radius: 4px;
            padding: 8px;
            font-size: 12px;
            word-break: break-all;
        }

        hr {
            border-style: dashed !important;
            border-color: #f0f0f0;
            margin: 15px 0 !important;
        }

        .fee {
            display: flex;
            align-items: center;
            justify-content: space-between;
            span {
                :first-of-type {
                    color: #72727a;
                }
                :last-of-type {
                    color: #272729;
                    font-weight: 600;
                    text-align: right;
                }
            }
        }
    }
`;

const Link = styled.div`
    a {
        display: block;
        width: 100%;
        text-align: center;
        text-decoration: underline;
        @media (max-width: 992px) {
            text-align: start;
        }
        @media (max-width: 580px) {
            text-align: center;
        }
    }
`;

const FullAccessKeyRotation = ({ fullAccessKey }) => {
    const dispatch = useDispatch();

    const [confirmDeAuthorize, setConfirmDeAuthorize] = React.useState(false);
    const [confirmRotate, setConfirmRotate] = React.useState(false);
    const [deAuthorizing, setDeAuthorizing] = React.useState(false);
    const [rotating, setRotating] = React.useState(false);
    const [inputSeedPhrase, setInputSeedPhrase] = React.useState('');
    const [publicKey, setPublicKey] = React.useState('');

    const fullAccessKeys = useSelector(selectAccountFullAccessKeys);

    const accountId = useSelector(selectAccountId);

    React.useEffect(() => {
        wallet.signer
            .getPublicKey(accountId, CONFIG.NETWORK_ID)
            .then((publicKey) => publicKey.toString())
            .then((publicKey) => setPublicKey(publicKey));
    }, [accountId, wallet.signer]);

    async function deauthorizeKey() {
        setDeAuthorizing(true);

        try {
            let inputSecretKey;

            try {
                bip39.validateMnemonic(inputSeedPhrase.trim());
                inputSecretKey = parseSeedPhrase(inputSeedPhrase).secretKey;
            } catch (err) {
                inputSecretKey = inputSeedPhrase;
            }

            const inputKeyPair = nearApiJs.KeyPair.fromString(inputSecretKey);
            const inputPublicKey = inputKeyPair.publicKey.toString();

            if (inputPublicKey === fullAccessKey.public_key) {
                throw new Error(
                    'The key you trying to deauthorize is the same key with the seed phrase you entered'
                );
            }

            if (
                fullAccessKeys.filter(
                    (accessKey) => accessKey.public_key === inputPublicKey
                ).length === 0
            ) {
                throw new Error(
                    'The seed phrase you entered is not a valid recovery key for this account'
                );
            }

            await dispatch(removeAccessKey(fullAccessKey.public_key));
            await dispatch(getAccessKeys());
        } catch (error) {
            dispatch(
                showCustomAlert({
                    success: false,
                    messageCodeHeader: 'error',
                    messageCode: 'fullAccessKeys.deAuthorizeConfirm.title',
                    errorMessage: error.message,
                })
            );
        } finally {
            setDeAuthorizing(false);
        }
    }

    async function rotateKey() {
        setRotating(true);

        try {
            let inputSecretKey;

            try {
                bip39.validateMnemonic(inputSeedPhrase.trim());
                inputSecretKey = parseSeedPhrase(inputSeedPhrase).secretKey;
            } catch (err) {
                inputSecretKey = inputSeedPhrase;
            }

            const inputKeyPair = nearApiJs.KeyPair.fromString(inputSecretKey);
            const inputPublicKey = inputKeyPair.publicKey.toString();

            if (inputPublicKey === fullAccessKey.public_key) {
                throw new Error(
                    'The seed phrase you entered is the same key with the key you trying to rotate'
                );
            }

            if (
                fullAccessKeys.filter(
                    (accessKey) => accessKey.public_key === inputPublicKey
                ).length === 0
            ) {
                throw new Error(
                    'The seed phrase you entered is not a valid recovery key for this account'
                );
            }

            await dispatch(recoverAccountSecretKey(inputKeyPair.secretKey.toString()));
            await dispatch(refreshAccount());
        } catch (error) {
            dispatch(
                showCustomAlert({
                    success: false,
                    messageCodeHeader: 'error',
                    messageCode: 'fullAccessKeys.rotateKey.title',
                    errorMessage: error.message,
                })
            );
        } finally {
            setRotating(false);
        }
    }

    const createdAt = new Date(fullAccessKey?.created?.block_timestamp / 1000000);

    const transactionHash = fullAccessKey?.created?.transaction_hash;

    return (
        <Container className='authorized-app-box'>
            {confirmDeAuthorize ? (
                <>
                    <div className='title disable'>
                        <Translate id='fullAccessKeys.deAuthorizeConfirm.title' />
                    </div>
                    <div className='desc'>
                        <Translate id='fullAccessKeys.deAuthorizeConfirm.desc' />
                    </div>
                    <div className='key font-monospace mt-4'>
                        {fullAccessKey.public_key}
                    </div>
                    <div className='desc mt-4'>
                        <Translate id='fullAccessKeys.deAuthorizeConfirm.seedPhrasePrompt' />
                    </div>
                    <form
                        onSubmit={(e) => {
                            deauthorizeKey();
                            e.preventDefault();
                        }}
                        autoComplete='off'
                    >
                        <Translate>
                            {({ translate }) => (
                                <input
                                    placeholder={translate(
                                        'fullAccessKeys.deAuthorizeConfirm.seedPhrase'
                                    )}
                                    value={inputSeedPhrase}
                                    onChange={(e) =>
                                        setInputSeedPhrase(e.target.value.toLowerCase())
                                    }
                                    autoComplete='off'
                                    spellCheck='false'
                                    disabled={deAuthorizing}
                                    autoFocus={true}
                                />
                            )}
                        </Translate>
                        <FormButtonGroup>
                            <FormButton
                                onClick={() => {
                                    setConfirmDeAuthorize(false);
                                }}
                                color='gray-white'
                                disabled={deAuthorizing}
                                type='button'
                            >
                                <Translate id='button.cancel' />
                            </FormButton>
                            <FormButton
                                disabled={deAuthorizing}
                                sending={deAuthorizing}
                                sendingString='button.deAuthorizing'
                                color='red'
                                type='submit'
                            >
                                <Translate id='button.approve' />
                            </FormButton>
                        </FormButtonGroup>
                    </form>
                </>
            ) : confirmRotate ? (
                <>
                    <div className='title disable'>
                        <Translate id='fullAccessKeys.rotateKey.title' />
                    </div>
                    <div className='desc'>
                        <Translate id='fullAccessKeys.rotateKey.desc' />
                    </div>
                    <div className='key font-monospace mt-4'>
                        {fullAccessKey.public_key}
                    </div>
                    <div className='desc mt-4'>
                        <Translate id='fullAccessKeys.rotateKey.seedPhrasePrompt' />
                    </div>
                    <form
                        onSubmit={(e) => {
                            rotateKey();
                            e.preventDefault();
                        }}
                        autoComplete='off'
                    >
                        <Translate>
                            {({ translate }) => (
                                <input
                                    placeholder={translate(
                                        'fullAccessKeys.rotateKey.seedPhrase'
                                    )}
                                    value={inputSeedPhrase}
                                    onChange={(e) =>
                                        setInputSeedPhrase(e.target.value.toLowerCase())
                                    }
                                    autoComplete='off'
                                    spellCheck='false'
                                    disabled={deAuthorizing}
                                    autoFocus={true}
                                />
                            )}
                        </Translate>
                        <FormButtonGroup>
                            <FormButton
                                onClick={() => {
                                    setConfirmRotate(false);
                                }}
                                color='gray-white'
                                disabled={rotating}
                                type='button'
                            >
                                <Translate id='button.cancel' />
                            </FormButton>
                            <FormButton
                                disabled={rotating}
                                sending={rotating}
                                sendingString='button.rotatingKey'
                                color='red'
                                type='submit'
                            >
                                <Translate id='button.approve' />
                            </FormButton>
                        </FormButtonGroup>
                    </form>
                </>
            ) : (
                <>
                    <div className='title'>
                        <Translate id='fullAccessKeys.createdAt' />{' '}
                        {createdAt.toLocaleString()}
                        {fullAccessKey.meta.type === 'ledger' ? (
                            <>
                                &nbsp; - &nbsp;
                                <Translate id='hardwareDevices.ledger.title' />
                            </>
                        ) : (
                            ''
                        )}
                        {fullAccessKey.public_key === publicKey ? (
                            <>
                                &nbsp; - &nbsp;
                                <Translate id='fullAccessKeys.rotateKey.inUse' />
                                <FormButton
                                    color='gray-blue'
                                    className='small'
                                    onClick={() => {
                                        setConfirmRotate(true);
                                    }}
                                    disabled={rotating}
                                    sending={rotating}
                                    sendingString='button.rotatingKey'
                                >
                                    <Translate id='button.rotateKey' />
                                </FormButton>
                            </>
                        ) : (
                            <FormButton
                                color='gray-red'
                                className='small'
                                onClick={() => {
                                    setConfirmDeAuthorize(true);
                                }}
                                disabled={deAuthorizing}
                                sending={deAuthorizing}
                                sendingString='button.deAuthorizing'
                            >
                                <Translate id='button.deauthorize' />
                            </FormButton>
                        )}
                    </div>
                    <div className='key font-monospace'>{fullAccessKey.public_key}</div>
                    <hr />
                    <div className='fee'>
                        <span>
                            <Translate id='fullAccessKeys.transaction' />
                        </span>
                        <Link>
                            <a
                                href={`${CONFIG.EXPLORER_URL}/txns/${transactionHash}`}
                                target='_blank'
                                rel='noreferrer'
                            >
                                {transactionHash}
                            </a>
                        </Link>
                    </div>{' '}
                </>
            )}
        </Container>
    );
};

export default FullAccessKeyRotation;