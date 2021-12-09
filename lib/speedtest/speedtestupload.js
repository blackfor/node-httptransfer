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

const { Asset } = require("../asset/asset");
const { AssetMetadata } = require("../asset/assetmetadata");
const { AssetMultipart } = require("../asset/assetmultipart");
const { TransferAsset } = require("../asset/transferasset");
const { TransferController, TransferEvents } = require("../controller/transfercontroller");
const { CreateTransferParts } = require("../functions/transferpartscreate");
const { JoinTransferParts } = require("../functions/transferpartsjoin");
const { MapConcurrent } = require("../generator/mapconcurrent");
const { Transfer } = require("../functions/transfer");
const { executePipeline, Pipeline } = require("../generator/pipeline");
const { RandomFileAccess } = require("../randomfileaccess");
const EventEmitter = require("events");
const UploadError = require("../aem/upload-error");

/**
 * Generate speedtest upload transfer assets
 * 
 * @generator
 * @param {SpeedTestUploadOptions} options 
 * @yields {TransferAsset} Transfer asset
 */
async function* generateSpeedTestUploadTransferRecord(options) {
    
	for (const uploadFile of options.uploadFiles) {
        let sourceBlob = uploadFile.blob;
        
        const source = new Asset(sourceBlob);
		const target = new Asset(uploadFile.putUrls[0]);
        const multiPartTarget = new AssetMultipart(
			uploadFile.putUrls,
			options.minPartSize,
			options.maxPartSize
	    );

        const transferAsset = new TransferAsset(
			source, 
			target,
			{
				multipartTarget : multiPartTarget,
				acceptRanges : true,
				metadata: new AssetMetadata("dummy", undefined, uploadFile.blobSize),

			}
			
		);

        yield transferAsset;
    }
}

class speedTestUpload extends EventEmitter {

    /**
     * @typedef {Object} SpeedTestUploadFile
     * @property {String[]} putUrls Presigned PUT url where to upload the file
     * @property {Number} blobSize Size of the file to upload
     * @property {Blob} blob Browser blob to upload
     */
    /**
     * @typedef {Object} SpeedTestUploadOptions
     * @property {SpeedTestUploadFile[]} uploadFiles List of files that will be uploaded to the provided presigned PUT target URLs. 
     * @property {Boolean} concurrent If true, multiple files in the supplied list of upload files will transfer simultaneously. If false, only one file will transfer at a time, and the next file will not begin transferring until the current file finishes.
     * @property {Number} maxConcurrent Maximum number of concurrent HTTP requests that are allowed
     * @property {Number} minPartSize Min part size
     * @property {Number} maxPartSize Min part size
     */

    /**
     * Upload files to an arbitary backend supporting presigned PUT uploads
     * 
     * @param {SpeedTestUploadOptions} options upload options
     */
    async uploadFiles(options) {
        const preferredPartSize = options && options.preferredPartSize;
        const maxConcurrent = (options && options.concurrent && options.maxConcurrent) || 1;

        const controller = new TransferController();
        controller.on(TransferEvents.JOIN_TRANSFER_PARTS, transferEvent => {
            this.emit("fileprogress", {
                ...transferEvent.transferAsset.eventData,
                transferred: transferEvent.props.transferBytes
            });
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
                new CreateTransferParts({ preferredPartSize }),
                new MapConcurrent(new Transfer(randomFileAccess, retryOptions), { maxConcurrent }),
                new JoinTransferParts,
            );
			console.log("triggering speedtest pipeline");
            await executePipeline(pipeline, generateSpeedTestUploadTransferRecord(options), controller);
        } finally {
            await randomFileAccess.close();
        }
    }
}

module.exports = {
    speedTestUpload
};
