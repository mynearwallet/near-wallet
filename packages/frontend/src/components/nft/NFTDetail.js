import BN from 'bn.js';
import React, { useMemo, useState } from 'react';
import { Translate } from 'react-localize-redux';
import styled from 'styled-components';
import { useQuery } from '@tanstack/react-query';

import { NFTMedia } from './NFTMedia';
import NFTTransferModal from './NFTTransferModal';
import CONFIG from '../../config';
import UserIconGrey from '../../images/UserIconGrey';
import BackArrowButton from '../common/BackArrowButton';
import FormButton from '../common/FormButton';
import Container from '../common/styled/Container.css';
import SendIcon from '../svg/SendIcon';
import { coreIndexerAdapter } from '../../services/coreIndexer/CoreIndexerAdapter';
import LoadingDots from '../common/loader/LoadingDots';

const StyledContainer = styled(Container)`
    display: flex;
    justify-content: center;
    @media (max-width: 767px) {
        margin-bottom: 4rem;
    }

    .container {
        max-width: 429px;
        position: relative;

        video,
        img {
            width: 100%;
            max-width: 429px;
            margin-bottom: 30px;

            filter: drop-shadow(0px 100px 80px rgba(0, 0, 0, 0.07))
                drop-shadow(0px 41.7776px 33.4221px rgba(0, 0, 0, 0.0503198))
                drop-shadow(0px 22.3363px 17.869px rgba(0, 0, 0, 0.0417275))
                drop-shadow(0px 12.5216px 10.0172px rgba(0, 0, 0, 0.035))
                drop-shadow(0px 6.6501px 5.32008px rgba(0, 0, 0, 0.0282725))
                drop-shadow(0px 2.76726px 2.21381px rgba(0, 0, 0, 0.0196802));
        }

        img {
            max-width: 500px;
            min-height: 320px;
            object-fit: contain;
            border-radius: 10px;
        }

        .sections__item__subtitle {
            margin-bottom: 3px;
        }

        .sections__item__desc {
            font-weight: 500;
            font-size: 16px;
            line-height: 150%;
            display: flex;
            align-items: center;
            color: #404040;
        }
    }

    .owner {
        p {
            display: flex;
            align-items: center;
        }

        .inner {
            display: flex;
            align-items: center;
            word-break: break-all;
            span {
                font-weight: 500;
                font-size: 16px;
                line-height: 150%;
                display: flex;
                align-items: center;
                color: #272729;
            }
        }
    }

    &&& {
        .transfer-btn {
            width: 100%;
            margin-top: 2rem;

            svg {
                margin-right: 10px;
            }
        }
    }

    .back-arrow-button {
        position: relative;
        top: 0;
        left: -8px;
        float: left;
        @media (min-width: 767px) {
            position: absolute;
            top: -6px;
            left: -78px;
        }
    }

    .title {
        margin-bottom: 0.8rem;
        line-height: 2.5rem;
    }

    .sections {
        display: flex;
        flex-direction: column;
        gap: 2.3rem;
    }

    .section-title {
        margin-bottom: 0.3rem;
        font-weight: 500;
        font-size: 12px;
        line-height: 150%;
        letter-spacing: 0.115em;
        color: #a2a2a8;
    }
    .attributes {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 0.5rem;
        margin-top: 4px;
    }
    .attributes__item {
        background: #f9f9f9;
        border-radius: 4px;
        padding: 0.7rem 0.7rem;
    }
    .attributes__key {
        font-size: 0.75rem;
    }
    .attributes__value {
        font-weight: bold;
    }
`;

const UserIcon = styled.div`
    background-size: 21px;
    flex: 0 0 40px;
    height: 40px;
    border-radius: 50%;
    background-color: #f8f8f8;
    text-align: center;
    margin: 0 12px 0 0;

    svg {
        width: 26px;
        height: 26px;
        margin: 7px;
    }

    @media (min-width: 940px) {
        display: inline-block;
    }
`;

export function NFTDetail({ nft, accountId, nearBalance, ownerId, history }) {
    const [transferNftDetail, setTransferNftDetail] = useState();

    const transferMax = new BN(
        (parseInt(CONFIG.NFT_TRANSFER_GAS, 10) + CONFIG.TOKEN_TRANSFER_DEPOSIT).toString()
    );
    const hasSufficientBalance = new BN(nearBalance).gte(transferMax);

    const { data: indexerData = {}, isLoading } = useQuery({
        queryKey: ['nftDetail', nft?.metadata?.reference],
        queryFn: async () => {
            return coreIndexerAdapter.getNftDetailByReference(nft?.metadata?.reference);
        },
        enabled: !!nft?.metadata?.reference,
        staleTime: 120_000,
    });

    const attributes = useMemo(() => {
        if (indexerData.attributes?.length) {
            return indexerData.attributes;
        }
        try {
            if (nft?.metadata?.extra) {
                return JSON.parse(nft?.metadata?.extra).attributes;
            }
        } catch (err) {
            console.log('Failed to parse nft extra');
        }
        return [];
    }, [indexerData.attributes, nft?.metadata]);

    return (
        <StyledContainer className='medium centered'>
            {nft && (
                <div className='container'>
                    <NFTMedia
                        mediaUrl={nft.metadata.mediaUrl}
                        mimeType={indexerData.mime_type}
                    />
                    <BackArrowButton
                        onClick={() => history.goBack()}
                        className='back-btn'
                    ></BackArrowButton>

                    <h1 className='title'>{nft.metadata.title}</h1>
                    <div className='sections'>
                        <div className='sections__item'>
                            <div className='sections__item__subtitle'>
                                <Translate id='NFTDetail.description' />
                            </div>
                            <p className='sections__item__desc'>
                                {nft.metadata.description ||
                                    indexerData.description ||
                                    '-'}
                            </p>
                        </div>

                        {isLoading && <LoadingDots />}

                        {!!attributes?.length && (
                            <div className='sections__item'>
                                <div className='sections__item__subtitle'>
                                    <Translate id='NFTDetail.attributes' />
                                </div>
                                <div className='attributes'>
                                    {attributes.map((item) => (
                                        <div
                                            key={item.trait_type}
                                            className='attributes__item'
                                        >
                                            <div className='attributes__key'>
                                                {item.trait_type}
                                            </div>
                                            <div className='attributes__value'>
                                                {item.value}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className='sections__item'>
                            <div className='owner'>
                                <p className='section-title'>
                                    <Translate id='NFTDetail.owner' />
                                </p>

                                <div className='inner'>
                                    <UserIcon>
                                        <UserIconGrey color='#9a9a9a' />
                                    </UserIcon>
                                    <span>{ownerId}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {ownerId === accountId && (
                        <FormButton
                            className='transfer-btn'
                            color='gray-gray'
                            data-test-id='nft-transfer-button'
                            disabled={!hasSufficientBalance}
                            onClick={() => setTransferNftDetail(nft)}
                        >
                            <SendIcon />
                            <Translate id='NFTDetail.transfer' />
                        </FormButton>
                    )}
                    {transferNftDetail && (
                        <NFTTransferModal
                            onClose={() => setTransferNftDetail()}
                            nft={transferNftDetail}
                            accountId={accountId}
                            nearBalance={nearBalance}
                        />
                    )}
                </div>
            )}
        </StyledContainer>
    );
}
