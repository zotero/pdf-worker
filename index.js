const PDFAssembler = require('./pdfassembler');
const util = require("./pdf.js/build/lib/shared/util");

async function getText(page) {
	let handler = {};
	handler.send = function (z, b) {
	};
	
	handler.sendWithPromise = function (op, data) {
		if (op === 'FetchBuiltInCMap') {
			return query(op, data);
		}
	};
	
	
	let task = {
		ensureNotTerminated: function () {
		}
	};
	
	let items = [];
	let sink = {
		desiredSize: 999999999,
		enqueue: function (z) {
			items = items.concat(z.items);
		}
	};
	
	await page.extractTextContent({
		handler: handler,
		task: task,
		sink: sink,
		page
	});
	
	return items;
}

function quadPointsToRects(quadPoints) {
	let rects = [];
	for (let j = 0; j < quadPoints.length; j += 8) {
		let topLeft = {x: quadPoints[j + 4], y: quadPoints[j + 5]};
		let bottomRight = {x: quadPoints[j + 2], y: quadPoints[j + 3]};
		let x = Math.min(topLeft.x, bottomRight.x);
		let y = Math.min(topLeft.y, bottomRight.y);
		let width = Math.abs(topLeft.x - bottomRight.x);
		let height = Math.abs(topLeft.y - bottomRight.y);
		rects.push([x, y, x + width, y + height]);
	}
	return rects;
}

function normalizeRect(rect) {
	let normalizedRect = {};
	if (rect[0] < rect[2]) {
		normalizedRect[0] = rect[0];
		normalizedRect[2] = rect[2];
	}
	else {
		normalizedRect[0] = rect[2];
		normalizedRect[2] = rect[0];
	}
	
	if (rect[1] < rect[3]) {
		normalizedRect[1] = rect[1];
		normalizedRect[3] = rect[3];
	}
	else {
		normalizedRect[1] = rect[3];
		normalizedRect[3] = rect[1];
	}
	return normalizedRect;
}


class Processor {
	constructor() {
		this.pdf = null;
		this.structure = null;
	}
	
	async init(data) {
		this.pdf = new PDFAssembler(data);
		this.structure = await this.pdf.getPDFStructure();
	}
	
	async getAnnotations() {
		
		let nextId = 1;
		
		let annotations = [];
		
		for (let pageIndex = 0; pageIndex < this.structure['/Root']['/Pages']['/Kids'].length; pageIndex++) {
			let rawPage = this.structure['/Root']['/Pages']['/Kids'][pageIndex];
			if (!rawPage['/Annots']) continue;
			
			let pageItems = null;
			
			for (let rawAnnotIdx = 0; rawAnnotIdx < rawPage['/Annots'].length; rawAnnotIdx++) {
				let rawAnnot = rawPage['/Annots'][rawAnnotIdx];
				let type = rawAnnot['/Subtype'].slice(1);
				let supportedTypes = [
					'Text',
					'Line',
					'Square',
					'Circle',
					'PolyLine',
					'Polygon',
					'Ink',
					'Highlight',
					'Underline',
					'Squiggly',
					'StrikeOut',
					'Stamp',
					'FileAttachment'
				];
				
				if (supportedTypes.includes(type)) {
					let annotation = {};
					
					annotation.type = type;
					annotation.external = true;
					
					let nm = rawAnnot['/NM'];
					
					if (nm) {
						annotation.id = nm.slice(1, -1);
					}
					else {
						annotation.id = (nextId++).toString();
					}
					
					let rects;
					if (rawAnnot['/QuadPoints']) {
						rects = quadPointsToRects(rawAnnot['/QuadPoints']);
					}
					else if (rawAnnot['/Rect']) {
						rects = [normalizeRect(rawAnnot['/Rect'])];
						let rect = rects[0];
						let containerRect = rects[0];
						containerRect[0] = Math.min(containerRect[0], rect[0]);
						containerRect[1] = Math.min(containerRect[1], rect[1]);
						containerRect[2] = Math.max(containerRect[2], rect[2]);
						containerRect[3] = Math.max(containerRect[3], rect[3]);
					}
					else {
						continue;
					}
					
					annotation.position = {
						pageNumber: pageIndex + 1,
						rects
					};
					
					if (rawAnnot['/M']) {
						annotation.dateModfied = pdfToIsoDate(rawAnnot['/M'].slice(1, -1));
					}
					
					if (rawAnnot['/T']) {
						annotation.label = util.stringToPDFString(rawAnnot['/T'].slice(1, -1));
					}
					
					if (rawAnnot['/Contents']) {
						annotation.comment = util.stringToPDFString(rawAnnot['/Contents'].slice(1, -1));
					}
					
					if (annotation.type === 'Highlight') {
						if (!pageItems) {
							let page = await this.pdf.pdfManager.pdfDocument.getPage(pageIndex);
							pageItems = await getText(page);
						}

						let highlightedText = this.extractText(pageItems, annotation.position.rects);
						
						if (highlightedText) {
							annotation.text = highlightedText;
						}
					}
					
					annotations.push(annotation);
				}
			}
		}
		
		return annotations;
	}
	
	extractText(pageItems, rects) {
		let text = '';
		for (let rect of rects) {
			for (let item of pageItems) {
				for (let char of item.chars) {
					if (
						rect[1] < char.y1 + 1 && rect[3] > char.y1 + 1 &&
						rect[0] < char.x1 && rect[2] > char.x2
					) {
						text += char.glyphUnicode;
					}
				}
			}
		}
		
		if (text.length) {
			return text;
		}
		
		return null;
	}
	
	deleteAnnotations(ids) {
		for (let pageIndex = 0; pageIndex < this.structure['/Root']['/Pages']['/Kids'].length; pageIndex++) {
			let rawPage = this.structure['/Root']['/Pages']['/Kids'][pageIndex];
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
	
	writeAnnotations(annotations) {
		for (let annotation of annotations) {
			if (!this.structure['/Root']['/Pages']['/Kids'][annotation.position.pageNumber - 1]['/Annots']) {
				this.structure['/Root']['/Pages']['/Kids'][annotation.position.pageNumber - 1]['/Annots'] = [];
			}
			this.structure['/Root']['/Pages']['/Kids'][annotation.position.pageNumber - 1]['/Annots'].push(annotationToRaw(annotation))
		}
	}
}

function stringToPdfString(text) {
	let out = [];
	for (let c of text) {
		c = c.charCodeAt(0);
		out.push(String.fromCharCode(c >> 8));
		out.push(String.fromCharCode(c & 0xFF));
	}
	return out.join('');
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

function pdfToIsoDate(str) {
	let m = str.match(/([0-9]{4})([0-9]{2}|)([0-9]{2}|)([0-9]{2}|)([0-9]{2}|)([0-9]{2}|)/);
	if (!m) return;
	let d = [];
	for (let i = 1; i <= 6; i++) {
		if (!m[i]) break;
		d.push(parseInt(m[i]));
	}
	
	if (d[1]) {
		d[1] -= 1;
	}
	
	return (new Date(Date.UTC(...d))).toISOString();
}

// D:20190429115637+03'00'
function isoToPdfDate(str) {
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
	
	if (annotation.type === 'text') {
		return {
			"/Type": "/Annot",
			"/Rect": containerRect,
			"/Subtype": "/Text",
			"/M": "(" + isoToPdfDate(annotation.dateModified) + ")",
			"/T": "(þÿ" + stringToPdfString(annotation.label) + ")",
			"/Contents": "(þÿ" + stringToPdfString(annotation.comment) + ")",
			"/NM": "(" + annotation.id + ")",
			"/F": 4,
			"/C": [
				1,
				1,
				0
			],
			"/CA": 1,
			"/Border": [
				0,
				0,
				1
			],
			"/AP": {
				"/N": {
					"/BBox": [0, 0, 20, 20],
					"/FormType": 1,
					"/Subtype": "/Form",
					"/Type": "/XObject",
					"stream": "1 1 0 rg 0 G 0 i 0.60 w 4 M 1 j 0 J []0 d 19.62 7.52 m 19.62 5.72 18.12 4.26 16.28 4.26 c 9.07 4.25 l 4.93 0.32 l 6.03 4.26 l 3.70 4.26 l 1.86 4.26 0.36 5.72 0.36 7.52 c 0.36 14.37 l 0.36 16.17 1.86 17.63 3.70 17.63 c 16.28 17.63 l 18.12 17.63 19.62 16.17 19.62 14.37 c 19.62 7.52 l h B 0 g 3.87 14.41 m 3.70 14.41 3.57 14.28 3.57 14.11 c 3.57 13.95 3.70 13.81 3.87 13.81 c 16.10 13.81 l 16.27 13.81 16.41 13.95 16.41 14.11 c 16.41 14.28 16.27 14.41 16.10 14.41 c 3.87 14.41 l h f 3.87 11.23 m 3.70 11.23 3.57 11.10 3.57 10.93 c 3.57 10.76 3.70 10.63 3.87 10.63 c 16.10 10.63 l 16.27 10.63 16.41 10.76 16.41 10.93 c 16.41 11.10 16.27 11.23 16.10 11.23 c 3.87 11.23 l h f 3.87 8.05 m 3.70 8.05 3.57 7.91 3.57 7.75 c 3.57 7.58 3.70 7.45 3.87 7.45 c 12.84 7.45 l 13.01 7.45 13.15 7.58 13.15 7.75 c 13.15 7.91 13.01 8.05 12.84 8.05 c 3.87 8.05 l h f ",
					"num": 0,
					"gen": 0
				}
			},
			"num": 0,
			"gen": 0
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
			"/Type": "/Annot",
			"/Rect": containerRect,
			"/Subtype": "/Highlight",
			"/QuadPoints": rectsToQuads(annotation.position.rects).map(x => x.toFixed(3)),
			"/M": "(" + isoToPdfDate(annotation.dateModified) + ")",
			"/T": "(þÿ" + stringToPdfString(annotation.label) + ")",
			"/Contents": "(þÿ" + stringToPdfString(annotation.comment) + ")",
			"/NM": "(" + annotation.id + ")",
			"/C": [
				1,
				1,
				0
			],
			"/AP": {
				"/N": {
					"/BBox": containerRect,
					"/FormType": 1,
					"/Resources": {
						"/ExtGState": {
							"/G0": {"/BM": "/Multiply", "/CA": 1, "/ca": 1, "num": 0, "gen": 0},
							"num": 0,
							"gen": 0
						}, "num": 0, "gen": 0
					},
					"/Subtype": "/Form",
					"/Type": "/XObject",
					"stream": "/G0 gs\r1 0.552941 0 rg\r" + p + "f\r",
					"num": 0,
					"gen": 0
				}
			},
			"num": 0,
			"gen": 0
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
			"/Type": "/Annot",
			"/Subtype": "/Square",
			"/Rect": containerRect,
			"/BS": {
				"/W": 1
			},
			"/IC": [0.803922, 0.803922, 0.803922],
			"/C": [0.611765, 0.611765, 0.611765],
			"/CA": 0.3,
			"/M": "(" + isoToPdfDate(annotation.dateModified) + ")",
			"/T": "(þÿ" + stringToPdfString(annotation.label) + ")",
			"/Contents": "(þÿ" + stringToPdfString(annotation.comment) + ")",
			"/NM": "(" + annotation.id + ")",
			"/AP": {
				"/N": {
					"/BBox": containerRect,
					"/FormType": 1,
					"/Resources": {
						"/ExtGState": {
							"/G0": {"/CA": 0.377175, "/ca": 0.377175, "num": 0, "gen": 0},
							"num": 0,
							"gen": 0
						}, "num": 0, "gen": 0
					},
					"/Subtype": "/Form",
					"/Type": "/XObject",
					"stream": "/G0 gs\r0.611765 0.611765 0.611765 RG\r0.803922 0.803922 0.803922 rg\r2.78738 w\r[] 0 d\r" + p + " re\rh\rB*\r",
					"num": 0,
					"gen": 0
				}
			},
			"num": 0,
			"gen": 0
		};
	}
}

async function writeAnnotations(buf, annotations) {
	let processor = new Processor();
	await processor.init(buf);
	let ids = annotations.map(x => x.id);
	processor.deleteAnnotations(ids);
	processor.writeAnnotations(annotations);
	return await processor.pdf.assemblePdf('ArrayBuffer');
}

async function readAnnotations(buf) {
	let processor = new Processor();
	await processor.init(buf);
	return await processor.getAnnotations();
}

if (typeof self !== 'undefined') {
	let promiseId = 0;
	let waitingPromises = {};
	
	self.query = async function(op, data) {
		return new Promise(function (resolve) {
			promiseId++;
			waitingPromises[promiseId] = resolve;
			self.postMessage({id: promiseId, op, data});
		});
	};
	
	self.onmessage = async function (e) {
		
		let message = e.data;
		
		if (message.responseId) {
			let resolve = waitingPromises[message.responseId];
			if (resolve) {
				resolve(message.data);
			}
			return;
		}
		
		console.log('Worker: Message received from the main script');
		console.log(e);
		
		if (message.op === 'write') {
			console.log('Writing annotations', message.data);
			let buf = await writeAnnotations(message.data.buf, message.data.annotations);
			self.postMessage({responseId: message.id, data: {buf}}, [buf]);
		}
		else if (message.op === 'read') {
			let annotations = await readAnnotations(message.data.buf);
			self.postMessage({responseId: message.id, data: {annotations}}, []);
		}
	};
}

exports.writeAnnotations = writeAnnotations;
exports.readAnnotations = readAnnotations;
