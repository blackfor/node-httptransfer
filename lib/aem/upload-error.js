/*
 * Copyright 2019 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

'use strict';

const errorCodes = require('./error-codes');

/**
 * Concatenates to message values together if both are provided.
 *
 * @param {string} overallMessage Will be prepended to specificMessage, delimited with a colon, if supplied.
 * @param {string} specificMessage Will be concatenated with overallMessage, if supplied. Otherwise the return value of
 *  the method will be specificMessage as-is.
 * @returns {string} A message value.
 */
function getFullMessage(overallMessage, specificMessage) {
    if (overallMessage) {
        return `${overallMessage}: ${specificMessage}`;
    }
    return specificMessage;
}

/**
 * Custom Error class containing additional information specific to the upload process. This primarily consists of an
 * error code, which can be used by consumers to provide more specific information about the nature of an error.
 */
class UploadError extends Error {
    /**
     * Constructs a new UploadError instance out of a given error message. The method will attempt to create the
     * most specific type of error it can based on what it receives.
     *
     * @param {*} error Object from which to create the UploadError instance. Can be several things, including an
     *  UploadError instance, an error as thrown by axios, a string, or another Error instance.
     * @param {string} errorMessage Will appear in the error's "message" value.
     * @returns {UploadError} An upload error instance.
     */
    static fromError(error, errorMessage = '') {
        const {
            message,
            code,
            uploadError,
            stack,
        } = error;

        if (uploadError) {
            return error;
        }

        const status = (error.response && error.response.status) || error.status;
        if (status) {
            let code = errorCodes.UNKNOWN;
            if (status === 409) {
                code = errorCodes.ALREADY_EXISTS;
            } else if (status === 403) {
                code = errorCodes.FORBIDDEN;
            } else if (status === 400) {
                code = errorCodes.INVALID_OPTIONS;
            } else if (status === 401) {
                code = errorCodes.NOT_AUTHORIZED;
            } else if (status === 404) {
                code = errorCodes.NOT_FOUND;
            } else if (status === 413) {
                code = errorCodes.TOO_LARGE;
            } else if (status === 501) {
                code = errorCodes.NOT_SUPPORTED;
            }
            return new UploadError(`Request failed with status code ${status}`, code, stack);
        }

        if (message && code) {
            return new UploadError(getFullMessage(errorMessage, message), code, stack);
        }

        if (message) {
            return new UploadError(getFullMessage(errorMessage, message), errorCodes.UNKNOWN, stack);
        }

        if (typeof error === 'string') {
            return new UploadError(getFullMessage(errorMessage, error), errorCodes.UNKNOWN);
        }

        try {
            return new UploadError(getFullMessage(errorMessage, JSON.stringify(error)), errorCodes.UNKNOWN, stack);
        // eslint-disable-next-line no-unused-vars
        } catch (e) {
            return new UploadError(getFullMessage(errorMessage, error), errorCodes.UNKNOWN, stack);
        }
    }

    /**
     * Constructs a new instance containing the provided information.
     *
     * @param {string} message The message that will appear with the Error instance.
     * @param {string} code The code indicating the specific type of error.
     * @param {string} [innerStack] Additional stack information if the UploadError instance originated
     *  from another Error.
     */
    constructor(message, code, innerStack = '') {
        super(message);
        this.code = code;
        this.innerStack = innerStack;
        this.uploadError = true;
    }

    /**
     * Retrieves the error code representing the specific type of error. See ErrorCodes for more
     * information.
     *
     * @returns {string} An error code value.
     */
    getCode() {
        return this.code;
    }

    /**
     * Retrieves the upload error's status as an HTTP status code.
     *
     * @returns {number} An HTTP status code.
     */
    getHttpStatusCode() {
        const code = this.getCode();

        if (code === errorCodes.ALREADY_EXISTS) {
            return 409;
        } else if (code === errorCodes.FORBIDDEN) {
            return 403;
        } else if (code === errorCodes.INVALID_OPTIONS) {
            return 400;
        } else if (code === errorCodes.NOT_AUTHORIZED) {
            return 401;
        } else if (code === errorCodes.NOT_FOUND) {
            return 404;
        } else if (code === errorCodes.TOO_LARGE) {
            return 413;
        } else if (code === errorCodes.NOT_SUPPORTED) {
            return 501;
        } else {
            return 500;
        }
    }

    /**
     * Retrieves a message describing the error.
     *
     * @returns {string} The error's message.
     */
    getMessage() {
        return this.message;
    }

    /**
     * Retrieves the inner stack of the error, as provided to the constructor.
     *
     * @returns {string} The error's inner stack.
     */
    getInnerStack() {
        return this.innerStack;
    }

    /**
     * Converts the error instance into a simplified object form.
     *
     * @returns {object} Simple object representation of the error.
     */
    toJSON() {
        const json = {
            message: this.message,
            code: this.code,
        };

        if (this.innerStack) {
            json.innerStack = this.innerStack;
        }

        return json;
    }

    /**
     * Converts the error to a string, which will be a stringified version of the error's toJSON() method.
     *
     * @returns {string} String representation of the error.
     */
    toString() {
        return JSON.stringify(this);
    }
}

module.exports = UploadError;
