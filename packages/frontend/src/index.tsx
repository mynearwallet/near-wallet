import 'regenerator-runtime/runtime';
import { configureStore } from '@reduxjs/toolkit';
// eslint-disable-next-line no-duplicate-imports
import type { PreloadedState } from '@reduxjs/toolkit';
import { routerMiddleware } from 'connected-react-router';
import { createBrowserHistory } from 'history';
import React from 'react';
import ReactDOM from 'react-dom';
import { GoogleReCaptchaProvider } from 'react-google-recaptcha-v3-near';
import { LocalizeProvider } from 'react-localize-redux';
import { QueryClientProvider } from '@tanstack/react-query';
import { Provider } from 'react-redux';

import App from './app';
import CONFIG from './config';
import createRootReducer from './redux/createReducers';
import { readyStatePromise } from './redux/middleware';
import initSentry from './utils/sentry';
import './translations';
import { queryClient } from './utils/query/queryClient';

initSentry();

const history = createBrowserHistory();
const rootReducer = createRootReducer(history);

export const setupStore = (preloadedState?: PreloadedState<RootState>) => {
    return configureStore({
        reducer: rootReducer,
        preloadedState,
        middleware: (getDefaultMiddleware) =>
            getDefaultMiddleware({
                serializableCheck: false,
                immutableCheck: false,
            }).concat(readyStatePromise, routerMiddleware(history)),
    });
};

export const store = setupStore({});
export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = typeof store.dispatch;

export const addAccountReducer = () => {
    store.replaceReducer(createRootReducer(history));
};

const rootNode = document.getElementById('root');
ReactDOM.render(
    <GoogleReCaptchaProvider
        reCaptchaKey={CONFIG.RECAPTCHA_ENTERPRISE_SITE_KEY}
        useRecaptchaNet={true}
        useEnterprise={true}
    >
        <QueryClientProvider client={queryClient}>
            <Provider store={store}>
                <LocalizeProvider store={store}>
                    <App history={history} />
                </LocalizeProvider>
            </Provider>
        </QueryClientProvider>
    </GoogleReCaptchaProvider>,
    rootNode
);
