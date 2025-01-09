import { JsonRpcProvider, TypedError } from 'near-api-js/lib/providers';
import {
    parseRpcError,
    getErrorTypeFromErrorMessage,
} from 'near-api-js/lib/utils/rpc_errors';
import fetch from 'node-fetch';

import { ConnectionInfo, RpcRetryConfig } from './type';
import { RpcRotator } from '..';

let nextId: number = 1234;

const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

export class RpcProvider extends JsonRpcProvider {
    readonly rotator: RpcRotator;
    readonly retryConfig: RpcRetryConfig;

    constructor(
        rpcConfig: string | ConnectionInfo | RpcRotator,
        retryConfig: RpcRetryConfig = {
            attempt: 2,
            wait: 100,
            waitExponentialBackoff: 1.1,
        }
    ) {
        let rotator: RpcRotator;

        switch (rpcConfig.constructor.name) {
            case 'String':
                rotator = new RpcRotator([
                    {
                        id: 'custom',
                        data: {
                            url: rpcConfig as string,
                        },
                    },
                ]);
                break;
            case 'Object':
                rotator = new RpcRotator([
                    {
                        id: 'custom',
                        data: {
                            url: (rpcConfig as ConnectionInfo).url,
                            headers: (rpcConfig as ConnectionInfo).headers,
                        },
                    },
                ]);
                break;
            case RpcRotator.name:
                rotator = rpcConfig as RpcRotator;
                break;
            default:
                throw 'Invalid rpcConfig type: ' + rpcConfig.constructor.name;
        }

        super(rotator.getConnection(0));
        this.rotator = rotator;
        this.retryConfig = retryConfig;
    }

    async sendJsonRpc<T>(method: string, params: object): Promise<T> {
        const requestBody = {
            method,
            params,
            id: nextId++,
            jsonrpc: '2.0',
        };

        let stopRetry = false;

        for (
            let currentAttempt = 0;
            currentAttempt < this.retryConfig.attempt;
            currentAttempt++
        ) {
            try {
                if (currentAttempt > 0) {
                    await sleep(
                        Math.floor(
                            this.retryConfig.wait *
                                Math.pow(
                                    this.retryConfig.waitExponentialBackoff,
                                    currentAttempt - 1
                                )
                        )
                    );
                }

                const connection = this.rotator.getConnection(currentAttempt);

                const httpResponse = await fetch(connection.url, {
                    method: 'POST',
                    body: JSON.stringify(requestBody),
                    headers: connection.headers,
                });

                if (!httpResponse.ok) {
                    continue;
                }

                const jsonResponse: any = await httpResponse.json();

                if (jsonResponse.error) {
                    if (
                        jsonResponse.error.data &&
                        typeof jsonResponse.error.data === 'object'
                    ) {
                        if (
                            typeof jsonResponse.error.data.error_message === 'string' &&
                            typeof jsonResponse.error.data.error_type === 'string'
                        ) {
                            // if error data has error_message and error_type properties, we consider that node returned an error in the old format
                            stopRetry = true;
                            throw new TypedError(
                                jsonResponse.error.data.error_message,
                                jsonResponse.error.data.error_type
                            );
                        }

                        stopRetry = true;
                        throw parseRpcError(jsonResponse.error.data);
                    } else {
                        const errorMessage = `[${jsonResponse.error.code}] ${jsonResponse.error.message}: ${jsonResponse.error.data}`;
                        // NOTE: All this hackery is happening because structured errors not implemented
                        // TODO: Fix when https://github.com/nearprotocol/nearcore/issues/1839 gets resolved
                        if (
                            jsonResponse.error.data === 'Timeout' ||
                            errorMessage.includes('Timeout error') ||
                            errorMessage.includes('query has timed out')
                        ) {
                            throw new TypedError(errorMessage, 'TimeoutError');
                        }

                        stopRetry = true;
                        throw new TypedError(
                            errorMessage,
                            getErrorTypeFromErrorMessage(jsonResponse.error.data)
                        );
                    }
                }

                const { result } = jsonResponse;

                return result;
            } catch (err) {
                if (stopRetry) {
                    throw err;
                }
                continue;
            }
        }

        throw new TypedError(
            `Exceeded ${this.retryConfig.attempt} attempts for request to ${method}.`,
            'RetriesExceeded'
        );
    }
}
