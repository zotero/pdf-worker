const NOTE_SIZE = 22;

exports.writeRawAnnotations = function (structure, annotations) {
	for (let annotation of annotations) {
		let pageIndex = annotation.position.pageIndex;
		let page = structure['/Root']['/Pages']['/Kids'][pageIndex];
		if (!page['/Annots']) {
			page['/Annots'] = [];
		}
		let rawAnnotation = annotationToRaw(annotation);
		page['/Annots'].push(rawAnnotation);
		if (annotation.type === 'highlight' && annotation.comment) {
			page['/Annots'].push(addPopup(rawAnnotation));
		}
	}
};

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
	return 'D:' + (new Date(str)).toISOString().slice(0, 19)
	.replace(/[^0-9]/g, '');
}

function annotationToRaw(annotation) {
	annotation = JSON.parse(JSON.stringify(annotation));
	annotation.position.rects = annotation.position.rects.map(r => r.map(n => Math.round(n * 1000) / 1000));
	let containerRect = annotation.position.rects[0].slice();
	for (let rect of annotation.position.rects) {
		containerRect[0] = Math.min(containerRect[0], rect[0]);
		containerRect[1] = Math.min(containerRect[1], rect[1]);
		containerRect[2] = Math.max(containerRect[2], rect[2]);
		containerRect[3] = Math.max(containerRect[3], rect[3]);
	}

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
			'/C': colorToRaw(annotation.color),
			'/CA': 1,
			'/Border': [0, 0, 1],
			'/AP': {
				'/N': {
					'/BBox': [0, 0, NOTE_SIZE, NOTE_SIZE],
					'/FormType': 1,
					'/Subtype': '/Form',
					'/Type': '/XObject',
					'stream': colorToRaw(annotation.color).join(' ') + ' rg\n' +
						'21.457 0.488 m 21.457 21.457 l 0.457 21.457 l 0.457 10.516 l 10.5 0.488\n' +
						' l h\n' +
						'21.457 0.488 m f\n' +
						'0 0 0 rg\n' +
						'21.914 0.031 m 10.312 0.031 l 0 10.328 l 0 21.91 l 21.914 21.91 l h\n' +
						'1.559 10.059 m 10.043 1.59 l 10.043 10.059 l h\n' +
						'0.914 21 m 0.914 10.973 l 10.957 10.973 l 10.957 0.945 l 21 0.945 l 21 \n' +
						'21 l h\n' +
						'0.914 21 m f',
					'num': 0,
					'gen': 0
				}
			},
			num: 0,
			gen: 0
		};
	}
	else if (annotation.type === 'highlight') {
		let p = '';
		for (let rect of annotation.position.rects) {
			p += rect[0] + ' ' + rect[1] + ' m\r';
			p += rect[2] + ' ' + rect[1] + ' l\r';
			p += rect[2] + ' ' + rect[3] + ' l\r';
			p += rect[0] + ' ' + rect[3] + ' l\rh\r';
		}

		return {
			'/Type': '/Annot',
			'/Rect': containerRect,
			'/Subtype': '/Highlight',
			'/QuadPoints': rectsToQuads(annotation.position.rects),
			'/M': '(' + dateToRaw(annotation.dateModified) + ')',
			'/T': '(' + stringToRaw(annotation.authorName) + ')',
			'/Contents': '(' + stringToRaw(annotation.comment) + ')',
			'/NM': '(' + 'Zotero-' + annotation.id + ')',
			'/C': colorToRaw(annotation.color),
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
								num: 0,
								gen: 0
							},
							num: 0,
							gen: 0
						}, num: 0, gen: 0
					},
					'/Subtype': '/Form',
					'/Type': '/XObject',
					stream: '/G0 gs\r' + colorToRaw(annotation.color).join(' ') + ' rg\r' + p + 'f\r',
					num: 0,
					gen: 0
				}
			},
			num: 0,
			gen: 0
		};
	}
	else if (annotation.type === 'image') {
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
				'/W': 2
			},
			'/C': colorToRaw(annotation.color),
			'/M': '(' + dateToRaw(annotation.dateModified) + ')',
			'/T': '(' + stringToRaw(annotation.authorName) + ')',
			'/Contents': '(' + stringToRaw(annotation.comment) + ')',
			'/NM': '(' + 'Zotero-' + annotation.id + ')',
			'/Zotero:Key': '(' + annotation.id + ')',
			'/AP': {
				'/N': {
					'/BBox': containerRect,
					'/FormType': 1,
					'/Resources': {
						'/ExtGState': {
							'/G0': { '/CA': 1, '/ca': 1, num: 0, gen: 0 },
							num: 0,
							gen: 0
						}, num: 0, gen: 0
					},
					'/Subtype': '/Form',
					'/Type': '/XObject',
					stream: '/G0 gs\r' + colorToRaw(annotation.color).join(' ') + ' RG\r0 0 0 0 k\r2 w\r[] 0 d\r' + p + ' re\rS\r',
					num: 0,
					gen: 0
				}
			},
			num: 0,
			gen: 0
		};
	}
}

function addPopup(annotation) {
	let popup = {
		'/Type': '/Annot',
		'/Subtype': '/Popup',
		'/Parent': annotation,
		'/Rect': annotation['/Rect'],
		num: 0,
		gen: 0
	};

	annotation['/Popup'] = popup;
	return popup;
}
