import bip39 from 'bip39-light';
import * as nearApiJs from 'near-api-js';
import { parseSeedPhrase } from 'near-seed-phrase';
import React from 'react';
import { Translate } from 'react-localize-redux';
import { Link } from 'react-router-dom';
import styled from 'styled-components';

import Container from '../../common/styled/Container.css';
import FullAccessKeyRotation from '../../profile/full_access_key_rotations/FullAccessKeyRotation';
import { useQuery } from 'react-query';
import { getAccessKeyMeta } from '../../../services/accessKey/api';

const StyledContainer = styled(Container)`
    .authorized-app-box {
        margin: 30px 0;
    }

    h1 {
        display: flex;
        align-items: center;
        svg {
            width: 30px;
            height: 30px;
            margin-right: 15px;
        }
    }
`;

const bip39SeedPhrasePattern = /^(\w+\s+){11,23}\w+$/;
const ed25519PrivateKeyPattern =
    /^(ed25519:)?[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{88}$/;

export default ({ fullAccessKeys, accountId }) => {
    const [filterKey, setFilterKey] = React.useState('');

    const fullAccessKeysWithMetadata = useQuery({
        queryKey: ['fullAccessKeysWithMeta', fullAccessKeys, accountId],
        queryFn: async () => {
            return getAccessKeyMeta(fullAccessKeys, accountId);
        },
        initialData: fullAccessKeys,
        initialDataUpdatedAt: 1, // This is to force the initialData to be refetched immediately,
        enabled: !!fullAccessKeys && !!accountId,
    });

    const filteredFullAccessKeys = React.useMemo(() => {
        if (!filterKey) {
            return fullAccessKeysWithMetadata.data;
        }

        let inputSecretKey;

        if (ed25519PrivateKeyPattern.test(filterKey.trim())) {
            inputSecretKey = filterKey;
        } else if (bip39SeedPhrasePattern.test(filterKey.trim())) {
            try {
                bip39.validateMnemonic(filterKey.trim());
                inputSecretKey = parseSeedPhrase(filterKey).secretKey;
            } catch (err) {
                return [];
            }
        } else {
            return [];
        }

        const keyPair = nearApiJs.KeyPair.fromString(inputSecretKey);
        const publicKey = keyPair.publicKey.toString();

        return fullAccessKeysWithMetadata.data.filter(
            (key) => key.public_key === publicKey
        );
    }, [filterKey, fullAccessKeysWithMetadata.data]);

    return (
        <StyledContainer className='medium centered'>
            <h1>
                <Translate id='fullAccessKeys.pageTitle' /> ({fullAccessKeys?.length})
            </h1>
            <Translate>
                {({ translate }) => (
                    <input
                        type='text'
                        value={filterKey}
                        placeholder={translate('fullAccessKeys.filterKey')}
                        onChange={(e) => setFilterKey(e.target.value)}
                    />
                )}
            </Translate>
            <div className='access-keys'>
                {fullAccessKeys?.length === 0 ? (
                    <Translate id='fullAccessKeys.dashboardLoading' />
                ) : filteredFullAccessKeys?.length === 0 ? (
                    <Translate id='fullAccessKeys.dashboardNoKeys' />
                ) : (
                    filteredFullAccessKeys?.map((accessKey, index) => (
                        <FullAccessKeyRotation key={index} fullAccessKey={accessKey} />
                    ))
                )}
            </div>
            <Link to={`/set-recovery/${accountId}?addKey=true`}>
                <Translate id='fullAccessKeys.addKey' />
            </Link>
        </StyledContainer>
    );
};
