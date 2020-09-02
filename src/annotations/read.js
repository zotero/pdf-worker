const { stringToPDFString } = require('../../pdf.js/build/lib/shared/util');
const { getClosestColor, arrayColorToHex } = require('../color');

const utils = require('../utils');
const putils = require('../putils');

/**
 * Convert a raw PDF string or return an empty string
 *
 * @param value
 * @returns {string}
 */
function getStr(value) {
  return typeof value === 'string' ? value.slice(1, -1) : '';
}

function isValidNumber(value) {
  return typeof value === 'number' && !isNaN(value);
}

exports.readRawAnnotations = function (structure) {
  let annotations = [];
  let rawPages = structure['/Root']['/Pages']['/Kids'];
  for (let pageIndex = 0; pageIndex < rawPages.length; pageIndex++) {
    let rawAnnots = rawPages[pageIndex] && rawPages[pageIndex]['/Annots'];
    if (!rawAnnots) continue;
    for (let rawAnnotIdx = 0; rawAnnotIdx < rawAnnots.length; rawAnnotIdx++) {
      let rawAnnot = rawAnnots[rawAnnotIdx];
      if (!rawAnnot) continue;
      let type = rawAnnot['/Subtype'];
      if (!type) continue;
      type = type.slice(1);
      // Supported raw types
      if (!['Text', 'Highlight'].includes(type)) continue;

      let annotation = {};
      annotation.type = type.toLowerCase();
      annotation.id = '';
      // TODO: Read only Zotero annotation id
      // Id can be used for item deduplication
      let str = getStr(rawAnnot['/NM']);
      if (str.startsWith('Zotero-')) {
        annotation.id = str.slice(7)
      }

      let rects;
      if (Array.isArray(rawAnnot['/QuadPoints'])
        && rawAnnot['/QuadPoints'].length % 8 === 0
        && rawAnnot['/QuadPoints'].every(x => isValidNumber(x))) {
        rects = utils.quadPointsToRects(rawAnnot['/QuadPoints']);
      }
      else if (Array.isArray(rawAnnot['/Rect'])
        && rawAnnot['/Rect'].length % 4 === 0
        && rawAnnot['/Rect'].every(x => isValidNumber(x))) {
        rects = [putils.normalizeRect(rawAnnot['/Rect'])];
      }
      else {
        continue;
      }

      annotation.position = {
        pageIndex,
        rects
      };

      // TODO: Extract `pageLabel`

      annotation.dateModified = utils.pdfDateToIso(getStr(rawAnnot['/M']));
      // annotation.authorName = stringToPDFString(getStr(rawAnnot['/T']));
      annotation.comment = stringToPDFString(getStr(rawAnnot['/Contents']));
      annotation.color = getClosestColor(arrayColorToHex(putils.getColorArray(rawAnnot['/C'])));

      annotations.push(annotation);
    }
  }

  return annotations;
}
