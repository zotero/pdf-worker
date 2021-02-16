const PDFAssembler = require('./pdfassembler');
const { getInfo } = require('./pdfinfo');
const { readRawAnnotations } = require('./annotations/read');
const { writeRawAnnotations } = require('./annotations/write');
const { deleteMatchedAnnotations } = require('./annotations/delete');
const { extractRange } = require('./text/range');
const { getClosestOffset } = require('./text/offset');
const { getPageLabelPoints, getPageLabel } = require('./text/page');

let chsCache = {};

async function getText(page, cmapProvider) {
	let handler = {};
	handler.send = function (z, b) {
	};

	class fakeReader {
		constructor(op, data) {
			this.op = op;
			this.data = data;
			this.called = false;
		}

		async read() {
			if (this.op !== 'FetchBuiltInCMap') return;

			if (this.called) {
				return { done: true };
			}

			this.called = true;
			return {
				value: await cmapProvider(this.data.name)
			}
		}
	}

	handler.sendWithStream = function (op, data, sink) {
		if (op === 'FetchBuiltInCMap') {
			return {
				getReader() {
					return new fakeReader(op, data);
				}
			};
		}
	};

	let task = {
		ensureNotTerminated() {
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

async function getPageChs(pageIndex, pdfDocument, cmapProvider) {
	if (chsCache[pageIndex]) return chsCache[pageIndex];

	let page = await pdfDocument.getPage(pageIndex);
	let pageItems = await getText(page, cmapProvider);

	let chs = [];
	for (let item of pageItems) {
		for (let ch of item.chars) {
			chs.push(ch);
		}
	}

	chsCache[pageIndex] = chs;
	return chs;
}

async function extractPageLabelPoints(pdfDocument, cmapProvider) {
	for (let i = 0; i < 5 && i + 3 < pdfDocument.numPages; i++) {
		let pageHeight = (await pdfDocument.getPage(i + 1)).view[3];
		let chs1 = await getPageChs(i, pdfDocument, cmapProvider);
		let chs2 = await getPageChs(i + 1, pdfDocument, cmapProvider);
		let chs3 = await getPageChs(i + 2, pdfDocument, cmapProvider);
		let chs4 = await getPageChs(i + 3, pdfDocument, cmapProvider);
		let res = await getPageLabelPoints(i, chs1, chs2, chs3, chs4, pageHeight);
		if (res) {
			return res;
		}
	}
	return null;
}

async function extractPageLabel(pageIndex, points, pdfDocument, cmapProvider) {
	let chsPrev, chsCur, chsNext;
	if (pageIndex > 0) {
		chsPrev = await getPageChs(pageIndex - 1, pdfDocument, cmapProvider);
	}
	chsCur = await getPageChs(pageIndex, pdfDocument, cmapProvider);

	if (pageIndex < pdfDocument.numPages - 1) {
		chsNext = await getPageChs(pageIndex + 1, pdfDocument, cmapProvider);
	}
	return getPageLabel(pageIndex, chsPrev, chsCur, chsNext, points);
}

async function writeAnnotations(buf, annotations, password) {
	let pdf = new PDFAssembler();
	await pdf.init(buf, password);
	let structure = await pdf.getPDFStructure();
	writeRawAnnotations(structure, annotations);
	return await pdf.assemblePdf('ArrayBuffer');
}

function getKey(annotation) {
	return annotation.type + annotation.position.pageIndex + JSON.stringify(annotation.position.rects) + annotation.comment;
}

function duplicated(a, b) {
	return getKey(a) === getKey(b);
}

function deduplicate(annotations) {
	return [...new Map(annotations.map(a => [getKey(a), a]))].map(([, v]) => v);
}

function getImported(current, existing) {
	return current.filter(a => !existing.some(b => duplicated(a, b)));
}

function getDeleted(current, existing) {
	return existing.filter(a => !current.some(b => duplicated(a, b))).map(a => a.id);
}

async function readAnnotations(buf, existingAnnotations, password, cmapProvider) {
	let pdf = new PDFAssembler();
	await pdf.init(buf, password);
	let pdfDocument = pdf.pdfManager.pdfDocument;
	let structure = await pdf.getPDFStructure();
	let annotations = await readRawAnnotations(structure, pdfDocument);

	annotations = deduplicate(annotations);

	let imported = getImported(annotations, existingAnnotations);
	let deleted = getDeleted(annotations, existingAnnotations);

	let pageChs;
	let pageHeight;
	let loadedPageIndex = null;
	for (let annotation of imported) {
		let pageIndex = annotation.position.pageIndex;
		if (loadedPageIndex !== pageIndex) {
			let page = await pdfDocument.getPage(pageIndex);
			let pageItems = await getText(page, cmapProvider);
			loadedPageIndex = pageIndex;
			pageChs = [];
			for (let item of pageItems) {
				for (let ch of item.chars) {
					pageChs.push(ch);
				}
			}
			pageHeight = page.view[3];
		}

		let points = await extractPageLabelPoints(pdfDocument, cmapProvider);
		if (points) {
			annotation.pageLabel = '-';
			let pageLabel = await extractPageLabel(annotation.position.pageIndex, points, pdfDocument, cmapProvider);
			if (pageLabel) {
				annotation.pageLabel = pageLabel;
			}
		}
		else {
			let pageLabels = pdf.pdfManager.pdfDocument.catalog.pageLabels;
			if (pageLabels && pageLabels[pageIndex]) {
				annotation.pageLabel = pageLabels[pageIndex];
			}
			else {
				annotation.pageLabel = (pageIndex + 1).toString();
			}
		}

		let offset = 0;
		if (annotation.type === 'highlight') {
			let range = extractRange(pageChs, annotation.position.rects);
			if (range) {
				offset = range.offset;
				annotation.text = range.text;
			}
		}
		// 'note'
		else {
			offset = getClosestOffset(pageChs, annotation.position.rects[0]);
		}

		let top = pageHeight - annotation.position.rects[0][3];
		annotation.sortIndex = [
			annotation.position.pageIndex.toString().slice(0, 5).padStart(5, '0'),
			offset.toString().slice(0, 6).padStart(6, '0'),
			parseInt(top).toString().slice(0, 5).padStart(5, '0')
		].join('|');
	}
	return { imported, deleted };
}

async function extractFulltext(buf, password, pagesNum, cmapProvider) {
	let pdf = new PDFAssembler();
	await pdf.init(buf, password);

	let fulltext = [];

	let actualCount = pdf.pdfManager.pdfDocument.numPages;

	if (!pagesNum || pagesNum > actualCount) {
		pagesNum = actualCount;
	}

	let pageIndex = 0;
	for (; pageIndex < pagesNum; pageIndex++) {
		let page = await pdf.pdfManager.pdfDocument.getPage(pageIndex);
		let pageItems = await getText(page, cmapProvider);
		let text = pageItems.map(x => x.str).join(' ');
		fulltext += text + '\n\n';
	}

	return {
		text: fulltext,
		pages: pageIndex
	}
}

async function extractStructure() {

}

function errObject(err) {
	return JSON.parse(JSON.stringify(err, Object.getOwnPropertyNames(err)));
}

async function extractInfo(buf, password) {
	return getInfo(buf, password);
}

if (typeof self !== 'undefined') {
	let promiseID = 0;
	let waitingPromises = {};

	self.query = async function (action, data) {
		return new Promise(function (resolve) {
			promiseID++;
			waitingPromises[promiseID] = resolve;
			self.postMessage({ id: promiseID, action, data });
		});
	};

	self.onmessage = async function (e) {
		let message = e.data;

		if (message.responseID) {
			let resolve = waitingPromises[message.responseID];
			if (resolve) {
				resolve(message.data);
			}
			return;
		}

		console.log('Worker: Message received from the main script');

		// console.log(e);

		async function cmapProvider(name) {
			return query('FetchBuiltInCMap', name);
		}

		if (message.action === 'export') {
			let buf;
			try {
				buf = await writeAnnotations(message.data.buf, message.data.annotations, message.data.password);
				self.postMessage({ responseID: message.id, data: { buf } }, [buf]);
			}
			catch (e) {
				console.log(e);
				self.postMessage({
					responseID: message.id,
					error: errObject(e)
				}, []);
			}
		}
		else if (message.action === 'import') {
			let annotations;
			try {
				let {
					imported,
					deleted
				} = await readAnnotations(message.data.buf, message.data.existingAnnotations, message.data.password, cmapProvider);
				self.postMessage({
					responseID: message.id,
					data: { imported, deleted }
				}, []);
			}
			catch (e) {
				self.postMessage({
					responseID: message.id,
					error: errObject(e)
				}, []);
			}
		}
		else if (message.action === 'extractFulltext') {
			let res;
			try {
				res = await extractFulltext(message.data.buf, message.data.password, 0, cmapProvider);
				self.postMessage({ responseID: message.id, data: res }, []);
			}
			catch (e) {
				self.postMessage({
					responseID: message.id,
					error: errObject(e)
				}, []);
			}
		}
		else if (message.action === 'getInfo') {
			let res;
			try {
				res = await extractInfo(message.data.buf, message.data.password);
				self.postMessage({ responseID: message.id, data: res }, []);
			}
			catch (e) {
				self.postMessage({
					responseID: message.id,
					error: errObject(e)
				}, []);
			}
		}
	};
}

module.exports = {
	writeAnnotations,
	readAnnotations,
	extractFulltext,
	extractStructure,
	extractInfo
};
