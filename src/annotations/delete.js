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

exports.deleteMatchedAnnotations = function (structure, annotations) {
  for (let pageIndex = 0; pageIndex < structure['/Root']['/Pages']['/Kids'].length; pageIndex++) {
    let rawPage = structure['/Root']['/Pages']['/Kids'][pageIndex];
    if (!rawPage['/Annots']) continue;
    for (let i = 0; i < rawPage['/Annots'].length; i++) {
      let rawAnnot = rawPage['/Annots'][i];
      if (!rawAnnot) continue;
      let quadPoints = rawAnnot['/QuadPoints'];
      if (quadPoints) {
        let rects = utils.quadPointsToRects(quadPoints);
        if (annotations.some(x => x.position.pageIndex === pageIndex && JSON.stringify(x.position.rects) === JSON.stringify(rects))) {
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
