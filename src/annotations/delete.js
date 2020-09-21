let { readRawAnnotation } = require('./read');
let { getRawPageView } = require('./common');
const utils = require('../utils');

exports.deleteAnnotations = function (structure, ids) {
  for (let pageIndex = 0; pageIndex < structure['/Root']['/Pages']['/Kids'].length; pageIndex++) {
    let rawPage = structure['/Root']['/Pages']['/Kids'][pageIndex];
    if (!rawPage['/Annots']) continue;
    for (let i = 0; i < rawPage['/Annots'].length; i++) {
      let rawAnnot = rawPage['/Annots'][i];
      let nm = rawAnnot['/NM'];
      if (nm) {
        let id = nm.slice(1, -1);
        if (ids.includes(id)) {
          rawPage['/Annots'].splice(i, 1);
          i--;
        }
      }
    }

    if (!rawPage['/Annots'].length) {
      delete rawPage['/Annots'];
    }
  }
}

function similarAnnotations(a, b) {
  return (
    a.position.pageIndex === b.position.pageIndex
    && a.type === b.type
    && a.comment === b.comment
    && JSON.stringify(a.position.rects) === JSON.stringify(b.position.rects)
  );
}

exports.deleteMatchedAnnotations = function (structure, annotations) {
  for (let pageIndex = 0; pageIndex < structure['/Root']['/Pages']['/Kids'].length; pageIndex++) {
    let rawPage = structure['/Root']['/Pages']['/Kids'][pageIndex];
    if (!rawPage['/Annots']) continue;
    for (let i = 0; i < rawPage['/Annots'].length; i++) {
      let rawAnnot = rawPage['/Annots'][i];
      if (!rawAnnot) continue;
      let view = getRawPageView(rawPage);
      let a = readRawAnnotation(rawAnnot, pageIndex, view);
      if (a) {
        if (annotations.some(b => similarAnnotations(a, b))) {
          rawPage['/Annots'].splice(i, 1);
          console.log('Deleting matching annotation', pageIndex + 1);
          i--;
        }
      }
    }

    if (!rawPage['/Annots'].length) {
      delete rawPage['/Annots'];
    }
  }
}
