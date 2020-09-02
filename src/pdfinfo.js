const { LocalPdfManager } = require('../pdf.js/build/lib/core/pdf_manager');
const { XRefParseException } = require('../pdf.js/build/lib/core/core_utils');
const utils = require('./utils');

async function getInfo(arrayBuffer, userPassword = '') {
  let recoveryMode = false;
  let pdfManager = new LocalPdfManager(1, arrayBuffer, userPassword, {}, '');
  await pdfManager.ensureDoc('checkHeader', []);
  await pdfManager.ensureDoc('parseStartXRef', []);
  // Enter into recovery mode if the initial parse fails
  try {
    await pdfManager.ensureDoc('parse', [recoveryMode]);
  }
  catch (e) {
    if (!(e instanceof XRefParseException) && !recoveryMode) {
      throw e;
    }
    recoveryMode = true;
    await pdfManager.ensureDoc('parse', [recoveryMode]);
  }
  await pdfManager.ensureDoc('numPages');
  await pdfManager.ensureDoc('fingerprint');
  await pdfManager.ensureDoc('documentInfo');

  console.log(pdfManager.pdfDocument.documentInfo);

  let documentInfo = pdfManager.pdfDocument.documentInfo;

  let data = {
    ...documentInfo,
    ModDate: utils.pdfDateToIso(documentInfo.ModDate),
    CreationDate: utils.pdfDateToIso(documentInfo.CreationDate),
    NumPages: pdfManager.pdfDocument.numPages,
    FileSize: arrayBuffer.byteLength
  };

  return data;
}

exports.getInfo = getInfo;
