'use strict';

// The Cloud Functions for Firebase SDK to create Cloud Functions and set up triggers.
const functions = require('firebase-functions/v2');
const path = require('path');
const os = require('os');
const fs = require('fs');
const spawn = require('child-process-promise').spawn;
const exec = require('child-process-promise').exec;
// The Firebase Admin SDK to access Firestore.
const admin = require('firebase-admin');
const convert = require('heic-convert');
const promisify = require('util.promisify');

admin.initializeApp();
functions.setGlobalOptions({region: "europe-west4", maxInstances: 2});

exports.image = functions.storage.onObjectFinalized({memory: "1GiB", cpu: 0.5}, async (event) => {
    const fileBucket = event.data.bucket; // The Storage bucket that contains the file.
    const filePath = event.data.name; // File path in the bucket.
    const contentType = event.data.contentType; // File content type.

    // Exit if this is triggered on a file that is not an image.
    if (!contentType.startsWith('image/')) {
        return functions.logger.log('This is not an image.');
    }

    // Get the file name.
    const fileName = path.basename(filePath);
    // Exit if the image is already a .webp
    if (fileName.endsWith('.webp')) {
        return functions.logger.log('Already a in correct format.');
    }

    // [START ImageConversion]
    // Download file from bucket.
    const bucket = admin.storage().bucket(fileBucket);
    let tempFilePath = path.join(os.tmpdir(), fileName);

    await bucket.file(filePath).download({ destination: tempFilePath });
    functions.logger.log('Image downloaded locally to', tempFilePath);

    if (fileName.toUpperCase().endsWith('.HEIC')) {
        functions.logger.log('HEIC image begin pre-processing');
        const inputBuffer = await promisify(fs.readFile)(tempFilePath);
        const outputBuffer = await convert({
            buffer: inputBuffer, // the HEIC file buffer
            format: 'JPEG',      // output format
            quality: 1           // the jpeg compression quality, between 0 and 1
          });
          await promisify(fs.writeFile)(changeExtension(tempFilePath, ".jpeg"), outputBuffer);
          tempFilePath = changeExtension(tempFilePath, ".jpeg");
    }

    // Generate a webp using ImageMagick.
    const child = spawn('convert', [tempFilePath, '-quality', '25', '-define', 'webp:lossless=true', tempFilePath]);
    child.childProcess.stdout.setEncoding('utf8');
    child.childProcess.stdout.on('data', function(data) {
        functions.logger.error('[spawn] stderr: ', data.toString());
    });
    child.childProcess.stderr.setEncoding('utf8');
    child.childProcess.stderr.on('data', function(data) {
        functions.logger.log('[spawn] stdout: ', data.toString());
    });

    await child
    functions.logger.log('webp created at', tempFilePath);
    const convertedFileName = `${fileName}`;
    const convertedFilePath = path.join(path.dirname(filePath), convertedFileName);

    // Uploading the webp.
    await bucket.upload(tempFilePath, {
        destination: changeExtension(convertedFilePath, ".webp"),
    });

    if (path.dirname(filePath) === "quick_content") {
        await admin.storage().bucket().file(filePath).delete();
        return fs.unlinkSync(tempFilePath);
    }

    // Generate thumbnail
    const childThumb = spawn('convert', [tempFilePath, '-thumbnail', '564x900>', tempFilePath]);
    childThumb.childProcess.stdout.setEncoding('utf8');
    childThumb.childProcess.stdout.on('data', function(data) {
        functions.logger.error('[spawn] stderr: ', data.toString());
    });
    childThumb.childProcess.stderr.setEncoding('utf8');
    childThumb.childProcess.stderr.on('data', function(data) {
        functions.logger.log('[spawn] stdout: ', data.toString());
    });

    await childThumb
    const compressedFileName = `thumbnail_${fileName}`;
    const compressedFilePath = path.join(path.dirname(filePath), compressedFileName);

    // Uploading the webp.
    await bucket.upload(tempFilePath, {
        destination: changeExtension(compressedFilePath, ".webp"),
    });

    await admin.storage().bucket().file(filePath).delete();

    // Once the webp has been uploaded delete the local file to free up disk space.
    return fs.unlinkSync(tempFilePath);
    // [END ImageConversion]
});

// webm is not supported by ios
// exports.video = functions.storage.onObjectFinalized( async (event) => {
//     const fileBucket = event.data.bucket;; // The Storage bucket that contains the file.
//     const filePath = event.data.name; // File path in the bucket.
//     const contentType = event.data.contentType; // File content type.

//     // Exit if this is triggered on a file that is not an video.
//     if (!contentType.startsWith('video/')) {
//         return functions.logger.log('This is not an video.');
//     }

//     // Get the file name.
//     const fileName = path.basename(filePath);
//     // Exit if the video is already a .webm
//     if (fileName.endsWith('.webm')) {
//         return functions.logger.log('Already a in correct format.');
//     }

//     // [START VideoConversion]
//     // Download file from bucket.
//     const bucket = admin.storage().bucket(fileBucket);
//     const tempFilePath = path.join(os.tmpdir(), fileName);
//     await bucket.file(filePath).download({ destination: tempFilePath });
//     functions.logger.log('Video downloaded locally to', tempFilePath);


//     const output = changeExtension(path.join(os.tmpdir(), "movie"), ".webm")
//     const logFolder = path.join(os.tmpdir(), "log");
//     functions.logger.log('output will be', output);

//     const pass1 = `ffmpeg -i "${tempFilePath}" -passlogfile ${logFolder} -b:v 0 -crf 45 -pass 1 -an -f webm -y /dev/null`
//     const pass2 = `ffmpeg -i "${tempFilePath}" -passlogfile ${logFolder} -b:v 0 -crf 45 -pass 2 -speed 8 -y ${output}`
//     await exec(pass1);
//     functions.logger.log('pass 1 completed', tempFilePath);
//     await exec(pass2);
//     functions.logger.log('pass 2 completed', tempFilePath);
//     functions.logger.log('webm created at', output);

//     const convertedFilePath = path.join(path.dirname(filePath), fileName);

//     // Uploading the webp.
//     await bucket.upload(output, {
//         destination: changeExtension(convertedFilePath, ".webm"),
//     });

//     if (path.dirname(filePath) === "quick_content") {
//         await admin.storage().bucket().file(filePath).delete();
//     }

//     // Once the webm has been uploaded delete the local file to free up disk space.
//     return fs.unlinkSync(output) && fs.unlinkSync(tempFilePath);
//     // [END VideoConversion]
// });

function changeExtension(file, extension) {
    const basename = path.basename(file, path.extname(file))
    return path.join(path.dirname(file), basename + extension)
}