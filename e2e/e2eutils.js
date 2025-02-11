/*
 * Copyright 2021 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

"use strict";

const Path = require('path');

// load .env values in the e2e folder, if any
require('dotenv').config({ path: Path.join(__dirname, '.env') });

/**
 * Retrieves the root URL of the AEM endpoint that the test's should
 * use.
 * @returns {string} URL for an AEM instance.
 */
module.exports.getAemEndpoint = function() {
    const endpoint = process.env.AEM_ENDPOINT;

    if (!endpoint) {
        throw new Error('AEM_ENDPOINT environment variable must be supplied');
    }

    return endpoint;
};

/**
 * Updates the given options to include authentication information required
 * to communicate with AEM.
 * @param {DirectBinaryUploadOptions} uploadOptions Will be updated with auth info.
 */
module.exports.getAuthorizationHeader = function() {
    const basic = process.env.BASIC_AUTH;
    const token = process.env.LOGIN_TOKEN;

    if (basic) {
        return {
            authorization: `Basic ${Buffer.from(basic).toString("base64")}`
        };
    } else if (token) {
        return {
            'Cookie': token
        };
    }

    throw new Error('Either BASIC_AUTH or LOGIN_TOKEN env variable must be set');
};

/**
 * Retrieves an ID that can be used to uniquely identify an execution of a test.
 *
 * @returns {string} Identifier for the test.
 */
module.exports.getUniqueTestId = function() {
    return `node-httptransfer_aem-e2e_${new Date().getTime()}`;
};
