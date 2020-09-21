const { stringToPDFString } = require('../../pdf.js/build/lib/shared/util');
const { getClosestColor, arrayColorToHex } = require('../color');
const { getRawPageView } = require('./common');

const utils = require('../utils');
const putils = require('../putils');

const NOTE_WIDTH = 20;
const NOTE_HEIGHT = 20;

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
      let view = getRawPageView(rawPages[pageIndex]);
      let annotation = exports.readRawAnnotation(rawAnnot, pageIndex, view);
      if (annotation) {
        annotations.push(annotation);
      }
    }
  }

  return annotations;
}

function resizeAndFitRect(rect, width, height, view) {
  let point = [rect[0] + (rect[2] - rect[0]) / 2, rect[1] + (rect[3] - rect[1]) / 2];
  rect = [
    point[0] - NOTE_WIDTH / 2,
    point[1] - NOTE_HEIGHT / 2,
    point[0] + NOTE_WIDTH / 2,
    point[1] + NOTE_HEIGHT / 2
  ];

  if (rect[0] < 0) {
    rect[0] = 0;
    rect[2] = width;
  }

  if (rect[1] < 0) {
    rect[1] = 0;
    rect[3] = height;
  }

  if (rect[2] > view[2]) {
    rect[0] = view[2] - width;
    rect[2] = view[2];
  }

  if (rect[3] > view[3]) {
    rect[1] = view[3] - height;
    rect[3] = view[3];
  }

  return rect;
}

exports.readRawAnnotation = function (rawAnnot, pageIndex, view) {
  let type = rawAnnot['/Subtype'];
  if (!type) {
    return null;
  }
  type = type.slice(1);
  if (!['Text', 'Highlight'].includes(type)) {
    return null;
  }

  type = type.toLowerCase();

  if (type === 'text') {
    type = 'note';
  }

  let annotation = {};
  annotation.type = type.toLowerCase();
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
    return null;
  }

  if (annotation.type === 'note') {
    if (rects.length > 1) {
      return null;
    }
    rects = [resizeAndFitRect(rects[0], NOTE_WIDTH, NOTE_HEIGHT, view)];
  }

  annotation.position = {
    pageIndex,
    rects
  };

  annotation.dateModified = utils.pdfDateToIso(getStr(rawAnnot['/M']));
  // annotation.authorName = stringToPDFString(getStr(rawAnnot['/T']));
  annotation.comment = stringToPDFString(getStr(rawAnnot['/Contents']));
  annotation.color = getClosestColor(arrayColorToHex(putils.getColorArray(rawAnnot['/C'])));
  console.log('raw', annotation)
  return annotation;
}
