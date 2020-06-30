exports.writeRawAnnotations = function (structure, annotations) {
  for (let annotation of annotations) {
    let pageIndex = annotation.position.pageIndex;
    let page = structure['/Root']['/Pages']['/Kids'][pageIndex];
    if (!page['/Annots']) {
      page['/Annots'] = [];
    }
    page['/Annots'].push(annotationToRaw(annotation));
  }
}

function rectsToQuads(rects) {
  let quads = [];
  for (let rect of rects) {
    quads.push(
      rect[0],
      rect[3],
      rect[2],
      rect[3],
      rect[0],
      rect[1],
      rect[2],
      rect[1]
    );
  }
  return quads;
}

function stringToRaw(text) {
  let out = [];
  for (let c of text) {
    c = c.charCodeAt(0);
    out.push(String.fromCharCode(c >> 8));
    out.push(String.fromCharCode(c & 0xFF));
  }
  return 'þÿ' + out.join('');
}

function colorToRaw(hex) {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return [
      parseInt(result[1], 16) / 255,
      parseInt(result[2], 16) / 255,
      parseInt(result[3], 16) / 255
    ];
  }
  return null;
}

// D:20190429115637+03'00'
function dateToRaw(str) {
  return 'D:' + (new Date(str)).toISOString().slice(0, 19).replace(/[^0-9]/g, '')
}

function annotationToRaw(annotation) {
  let containerRect = annotation.position.rects[0].slice();
  for (let rect of annotation.position.rects) {
    containerRect[0] = Math.min(containerRect[0], rect[0]);
    containerRect[1] = Math.min(containerRect[1], rect[1]);
    containerRect[2] = Math.max(containerRect[2], rect[2]);
    containerRect[3] = Math.max(containerRect[3], rect[3]);
  }

  containerRect = containerRect.map(x => x.toFixed(3));

  if (annotation.type === 'note') {
    return {
      '/Type': '/Annot',
      '/Rect': containerRect,
      '/Subtype': '/Text',
      '/M': '(' + dateToRaw(annotation.dateModified) + ')',
      '/T': '(' + stringToRaw(annotation.authorName) + ')',
      '/Contents': '(' + stringToRaw(annotation.comment) + ')',
      '/NM': '(' + 'Zotero-' + annotation.id + ')',
      '/F': 4,
      '/C': colorToRaw(annotation.color) || [1, 1, 0],
      '/CA': 1,
      '/Border': [0, 0, 1],
      // "/AP": {
      // 	"/N": {
      // 		"/BBox": [0, 0, 20, 20],
      // 		"/FormType": 1,
      // 		"/Subtype": "/Form",
      // 		"/Type": "/XObject",
      // 		"stream": "1 1 0 rg 0 G 0 i 0.60 w 4 M 1 j 0 J []0 d 19.62 7.52 m 19.62 5.72 18.12 4.26 16.28 4.26 c 9.07 4.25 l 4.93 0.32 l 6.03 4.26 l 3.70 4.26 l 1.86 4.26 0.36 5.72 0.36 7.52 c 0.36 14.37 l 0.36 16.17 1.86 17.63 3.70 17.63 c 16.28 17.63 l 18.12 17.63 19.62 16.17 19.62 14.37 c 19.62 7.52 l h B 0 g 3.87 14.41 m 3.70 14.41 3.57 14.28 3.57 14.11 c 3.57 13.95 3.70 13.81 3.87 13.81 c 16.10 13.81 l 16.27 13.81 16.41 13.95 16.41 14.11 c 16.41 14.28 16.27 14.41 16.10 14.41 c 3.87 14.41 l h f 3.87 11.23 m 3.70 11.23 3.57 11.10 3.57 10.93 c 3.57 10.76 3.70 10.63 3.87 10.63 c 16.10 10.63 l 16.27 10.63 16.41 10.76 16.41 10.93 c 16.41 11.10 16.27 11.23 16.10 11.23 c 3.87 11.23 l h f 3.87 8.05 m 3.70 8.05 3.57 7.91 3.57 7.75 c 3.57 7.58 3.70 7.45 3.87 7.45 c 12.84 7.45 l 13.01 7.45 13.15 7.58 13.15 7.75 c 13.15 7.91 13.01 8.05 12.84 8.05 c 3.87 8.05 l h f ",
      // 		"num": 0,
      // 		"gen": 0
      // 	}
      // },
      'num': 0,
      'gen': 0
    };
  }
  else if (annotation.type === 'highlight') {
    let p = '';
    for (let rect of annotation.position.rects) {
      rect = rect.map(x => x.toFixed(3));
      p += rect[0] + ' ' + rect[1] + ' m\r';
      p += rect[2] + ' ' + rect[1] + ' l\r';
      p += rect[2] + ' ' + rect[3] + ' l\r';
      p += rect[0] + ' ' + rect[3] + ' l\rh\r';
    }

    return {
      '/Type': '/Annot',
      '/Rect': containerRect,
      '/Subtype': '/Highlight',
      '/QuadPoints': rectsToQuads(annotation.position.rects).map(x => x.toFixed(3)),
      '/M': '(' + dateToRaw(annotation.dateModified) + ')',
      '/T': '(' + stringToRaw(annotation.authorName || '') + ')',
      '/Contents': '(' + stringToRaw(annotation.comment) + ')',
      '/NM': '(' + annotation.id + ')',
      '/C': colorToRaw(annotation.color) || [1, 1, 0],
      '/AP': {
        '/N': {
          '/BBox': containerRect,
          '/FormType': 1,
          '/Resources': {
            '/ExtGState': {
              '/G0': {
                '/BM': '/Multiply',
                '/CA': 1,
                '/ca': 1,
                'num': 0,
                'gen': 0
              },
              'num': 0,
              'gen': 0
            }, 'num': 0, 'gen': 0
          },
          '/Subtype': '/Form',
          '/Type': '/XObject',
          'stream': '/G0 gs\r1 0.552941 0 rg\r' + p + 'f\r',
          'num': 0,
          'gen': 0
        }
      },
      'num': 0,
      'gen': 0
    };
  }
  else if (annotation.type === 'square') {
    let p = [
      containerRect[0],
      containerRect[1],
      containerRect[2] - containerRect[0],
      containerRect[3] - containerRect[1]
    ].join(' ');

    return {
      '/Type': '/Annot',
      '/Subtype': '/Square',
      '/Rect': containerRect,
      '/BS': {
        '/W': 1
      },
      '/IC': [0.803922, 0.803922, 0.803922],
      '/C': colorToRaw(annotation.color) || [0.611765, 0.611765, 0.611765],
      '/CA': 0.3,
      '/M': '(' + dateToRaw(annotation.dateModified) + ')',
      '/T': '(' + stringToRaw(annotation.authorName) + ')',
      '/Contents': '(' + stringToRaw(annotation.comment) + ')',
      '/NM': '(' + annotation.id + ')',
      '/AP': {
        '/N': {
          '/BBox': containerRect,
          '/FormType': 1,
          '/Resources': {
            '/ExtGState': {
              '/G0': { '/CA': 0.377175, '/ca': 0.377175, 'num': 0, 'gen': 0 },
              'num': 0,
              'gen': 0
            }, 'num': 0, 'gen': 0
          },
          '/Subtype': '/Form',
          '/Type': '/XObject',
          'stream': '/G0 gs\r0.611765 0.611765 0.611765 RG\r0.803922 0.803922 0.803922 rg\r2.78738 w\r[] 0 d\r' + p + ' re\rh\rB*\r',
          'num': 0,
          'gen': 0
        }
      },
      'num': 0,
      'gen': 0
    };
  }
}
