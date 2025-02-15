import React, { useEffect, useState } from 'react';
import InfiniteScroll from 'react-infinite-scroller';
import { Translate } from 'react-localize-redux';
import { useDispatch, useSelector } from 'react-redux';

import Container from '../../components/common/styled/Container.css';
import GroupedTransactions from '../../components/transactions/GroupedTransactions';
import TransactionItemModal from '../../components/transactions/TransactionItemModal';
import { selectAccountId } from '../../redux/slices/account';
import {
    transactionHistoryActions,
    transactionHistorySelector,
} from '../../redux/slices/transactionHistory';
import styled from 'styled-components';
import { AppDispatch } from '../..';

const TransactionHistory = () => {
    const dispatch: AppDispatch = useDispatch();
    const accountId = useSelector(selectAccountId);
    const { transactions, isLoading, hasMore } = useSelector(transactionHistorySelector);
    const [page, setPage] = useState(0);

    // reset on change account
    useEffect(() => {
        setPage(0);
        dispatch(transactionHistoryActions.setTransactions([]));
        dispatch(transactionHistoryActions.fetchTransactions({ accountId, page: 1 }));
    }, [accountId]);

    if (!transactions) {
        return null;
    }

    async function loadMore() {
        if (accountId && !isLoading) {
            dispatch(transactionHistoryActions.fetchTransactions({ accountId, page }));
            setPage((p) => p + 1);
        }
    }

    return (
        <Container>
            <StyledContainer>
                <h2 className='page-title'>
                    <Translate id='dashboard.activity' />
                </h2>
                <InfiniteScroll pageStart={0} loadMore={loadMore} hasMore={hasMore}>
                    <GroupedTransactions transactions={transactions} />
                </InfiniteScroll>
                {isLoading ? (
                    <div className='loader text-center' key={0}>
                        <Translate id='loading' />
                    </div>
                ) : (
                    <StyledLoadMore onClick={loadMore}>Load More</StyledLoadMore>
                )}
                <TransactionItemModal />
            </StyledContainer>
        </Container>
    );
};

export default TransactionHistory;

const StyledContainer = styled.div`
    .page-title {
        font-size: 24px;
        font-weight: bold;
        color: #555;
    }
`;

const StyledLoadMore = styled.div`
    text-align: center;
    text-decoration: underline;
    cursor: pointer;
    color: var(--mnw-color-1);
`;
