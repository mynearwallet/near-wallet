import React, { Suspense } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../src/translations';
import '../src/app/index.css';
import GlobalStyle from '../src/components/GlobalStyle';
import { setupStore } from '../src';
import { Provider } from 'react-redux';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** @type { import('@storybook/react').Preview } */
const preview = {
    parameters: {
        actions: { argTypesRegex: '^on[A-Z].*' },
        controls: {
            matchers: {
                color: /(background|color)$/i,
                date: /Date$/,
            },
        },
    },
};

const store = setupStore({});
const queryClient = new QueryClient();

const withProviders = (Story, context) => {
    return (
        <Provider store={store}>
            <Suspense fallback={<div>loading translations...</div>}>
                <I18nextProvider i18n={i18n}>
                    <QueryClientProvider client={queryClient}>
                        <GlobalStyle />
                        <Story {...context} />
                    </QueryClientProvider>
                </I18nextProvider>
            </Suspense>
        </Provider>
    );
};

export const decorators = [withProviders];

export default preview;
