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

'use strict';

require("core-js/stable");

const fileUrl = require("file-url");
const { Asset } = require("../asset/asset");
const { TransferAsset } = require("../asset/transferasset");
const { AssetMetadata } = require("../asset/assetmetadata");
const { NameConflictPolicy } = require("../asset/nameconflictpolicy");
const { TransferController, TransferEvents } = require("../controller/transfercontroller");
const { AEMInitiateUpload } = require("../functions/aeminitiateupload");
const { AEMCompleteUpload } = require("../functions/aemcompleteupload");
const { CreateTransferParts } = require("../functions/transferpartscreate");
const { JoinTransferParts } = require("../functions/transferpartsjoin");
const { FailUnsupportedAssets } = require("../functions/failunsupportedassets");
const { CloseFiles } = require("../functions/closefiles");
const { MapConcurrent } = require("../generator/mapconcurrent");
const { Transfer } = require("../functions/transfer");
const { executePipeline, Pipeline } = require("../generator/pipeline");
const { RandomFileAccess } = require("../randomfileaccess");
const EventEmitter = require("events");
const UploadError = require("./upload-error");
const { FilterFailedAssets } = require("../functions/filterfailedassets");
const { IllegalArgumentError } = require("../error");

/**
 * Generate AEM upload transfer assets
 * 
 * @generator
 * @param {AEMUploadOptions} options 
 * @yields {TransferAsset} Transfer asset
 */
async function* generateAEMUploadTransferRecords(options) {
    for (const uploadFile of options.uploadFiles) {
        let sourceUrl = uploadFile.blob;
        if (!sourceUrl) {
            if (!uploadFile.filePath) {
                throw new IllegalArgumentError(
                    'Either blob or filePath must be provided in uploadFiles',
                    JSON.stringify(uploadFile)
                );
            }
            sourceUrl = fileUrl(uploadFile.filePath);
        }
        const targetUrl = new URL(uploadFile.fileUrl);

        const source = new Asset(sourceUrl);
        const target = new Asset(targetUrl, options.headers, uploadFile.multipartHeaders);

        const transferAsset = new TransferAsset(source, target, {
            acceptRanges: true,
            metadata: new AssetMetadata(uploadFile.filePath, undefined, uploadFile.fileSize),
            nameConflictPolicy: new NameConflictPolicy({
                createVersion: uploadFile.createVersion,
                versionLabel: uploadFile.versionLabel,
                versionComment: uploadFile.versionComment,
                replace: uploadFile.replace
            })
        });

        yield transferAsset;
    }
}

class AEMUpload extends EventEmitter {

    /**
     * @typedef {Object} UploadFile
     * @property {String} fileUrl AEM url where to upload the file
     * @property {Number} fileSize Size of the file to upload
     * @property {String} filePath Path on the local disk to upload
     * @property {Blob} [blob] Browser blob to upload (instead of fileUrl)
     * @property {Boolean} [createVersion=false] Create version on duplicates
     * @property {String} [versionLabel] Version label to apply to the created/updated file
     * @property {String} [versionComment] Version comment to apply to the created/updated file
     * @property {Boolean} [replace=false] True if the existing file should be replaced
     */
    /**
     * @typedef {Object} AEMUploadOptions
     * @property {UploadFile[]} uploadFiles List of files that will be uploaded to the target URL. 
     * @property {*} headers HTTP headers that will be included in each request sent to AEM
     * @property {Boolean} concurrent If true, multiple files in the supplied list of upload files will transfer simultaneously. If false, only one file will transfer at a time, and the next file will not begin transferring until the current file finishes.
     * @property {Number} maxConcurrent Maximum number of concurrent HTTP requests that are allowed
     * @property {Number} [preferredPartSize] Preferred part size
     */
    /**
     * Upload files to AEM
     * 
     * @param {AEMUploadOptions} options AEM upload options
     */
    async uploadFiles(options) {
        const preferredPartSize = options && options.preferredPartSize;
        const maxConcurrent = (options && options.concurrent && options.maxConcurrent) || 1;

        const controller = new TransferController();
        controller.on(TransferEvents.AEM_INITIATE_UPLOAD, transferEvent => {
            this.emit("filestart", transferEvent.transferAsset.eventData);
        });
        controller.on(TransferEvents.JOIN_TRANSFER_PARTS, transferEvent => {
            this.emit("fileprogress", {
                ...transferEvent.transferAsset.eventData,
                transferred: transferEvent.props.transferBytes
            });
        });
        controller.on(TransferEvents.AFTER_AEM_COMPLETE_UPLOAD, transferEvent => {
            this.emit("fileend", transferEvent.transferAsset.eventData);
        });
        controller.on(TransferEvents.ERROR, transferEvent => {
            if (transferEvent.props.firstError) {
                this.emit("fileerror", {
                    ...transferEvent.transferAsset.eventData,
                    errors: [ UploadError.fromError(transferEvent.error) ]
                });
            }
        });

        const retryOptions = {
            retryMaxCount: 5
        };
        
        // Build and execute pipeline
        const randomFileAccess = new RandomFileAccess();
        try {
            const pipeline = new Pipeline(
                new FailUnsupportedAssets(),
                new MapConcurrent(new AEMInitiateUpload(retryOptions), { maxBatchLength: 100 }),
                new CreateTransferParts({ preferredPartSize }),
                new MapConcurrent(new Transfer(randomFileAccess, retryOptions), { maxConcurrent }),
                new JoinTransferParts,
                new CloseFiles(randomFileAccess),
                new MapConcurrent(new AEMCompleteUpload(retryOptions)),
            );
            pipeline.setFilterFunction(new FilterFailedAssets);
            await executePipeline(pipeline, generateAEMUploadTransferRecords(options), controller);
        } finally {
            await randomFileAccess.close();
        }
    }
}

module.exports = {
    AEMUpload
};
