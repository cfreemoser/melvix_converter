// The Cloud Functions for Firebase SDK to create Cloud Functions and set up triggers.
const functions = require('firebase-functions');
const path = require('path');
const os = require('os');
const fs = require('fs');
const spawn = require('child-process-promise').spawn;

// The Firebase Admin SDK to access Firestore.
const admin = require('firebase-admin');
admin.initializeApp();

exports.imageConverter = functions.storage.object().onFinalize(async (object) => {
    const fileBucket = object.bucket; // The Storage bucket that contains the file.
    const filePath = object.name; // File path in the bucket.
    const contentType = object.contentType; // File content type.

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
    const tempFilePath = path.join(os.tmpdir(), fileName);
    const metadata = {
        contentType: contentType,
    };
    await bucket.file(filePath).download({ destination: tempFilePath });
    functions.logger.log('Image downloaded locally to', tempFilePath);

    // Generate a webp using ImageMagick.
    await spawn('convert', [tempFilePath, '-quality', '25', '-define', "webp:lossless=true", tempFilePath]);
    functions.logger.log('webp created at', tempFilePath);

    const compressedFileName = `${fileName}`;
    const compressedFilePath = path.join(path.dirname(filePath), compressedFileName);

    // Uploading the webp.
    await bucket.upload(tempFilePath, {
        destination: changeExtension(compressedFilePath, ".webp"),
        metadata: metadata,
    });

    // Once the webp has been uploaded delete the local file to free up disk space.
    return fs.unlinkSync(tempFilePath);
    // [END ImageConversion]
});


function changeExtension(file, extension) {
    const basename = path.basename(file, path.extname(file))
    return path.join(path.dirname(file), basename + extension)
}