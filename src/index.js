const PDFAssembler = require('./pdfassembler');
const { getInfo } = require('./pdfinfo');
const { readRawAnnotations } = require('./annotations/read');
const { writeRawAnnotations } = require('./annotations/write');
const { deleteAnnotations } = require('./annotations/delete');
const {
	getRangeByHighlight,
	getClosestOffset,
	getPageLabelPoints,
	getPageLabel
} = require('./text');
const { Util } = require('../pdf.js/build/lib/shared/util');
const { resizeAndFitRect } = require('./annotations/read');
const { textApproximatelyEqual } = require('./utils');

// TODO: Highlights shouldn't be allowed to be outside of page view

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
			};
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
	if (!pdfDocument.chsCache) {
		pdfDocument.chsCache = {};
	}
	if (pdfDocument.chsCache[pageIndex]) {
		return pdfDocument.chsCache[pageIndex];
	}

	let page = await pdfDocument.getPage(pageIndex);
	let pageItems = await getText(page, cmapProvider);

	let chs = [];
	for (let item of pageItems) {
		for (let ch of item.chars) {
			if (ch.rotation % 90 === 0 && ch.c !== ' ') {
				chs.push(ch);
			}
		}
	}

	pdfDocument.chsCache[pageIndex] = chs;
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
	let str =	annotation.type + annotation.position.pageIndex;
	if (annotation.type === 'ink') {
		str += annotation.position.width;
		str += JSON.stringify(annotation.position.paths);
	}
	else {
		str += JSON.stringify(annotation.position.rects);
	}
	str += annotation.comment;
	return str;
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

/**
 * Note: It currently leaves gaps at the path cut points, but this can be solved by
 * repeating the previous point at the beginning of the newly cut path
 *
 * Note2: At some point this will be necessary on pdf-reader, if we'll implement ink drawing
 *
 * @param {Object} annotation
 * @returns {Array} Annotations annotations
 */
function splitAnnotation(annotation) {
	const MAX_ANNOTATION_POSITION_SIZE = 65000;
	if (JSON.stringify(annotation.position).length < MAX_ANNOTATION_POSITION_SIZE) {
		return [annotation];
	}
	let splitAnnotations = [];
	let tmpAnnotation = null;
	let totalLength = 0;
	if (annotation.position.rects) {
		for (let i = 0; i < annotation.position.rects.length; i++) {
			let rect = annotation.position.rects[i];
			if (!tmpAnnotation) {
				tmpAnnotation = JSON.parse(JSON.stringify(annotation));
				tmpAnnotation.position.rects = [];
				totalLength = JSON.stringify(tmpAnnotation.position).length;
			}
			// [],
			let length = rect.join(',').length + 3;
			if (totalLength + length <= MAX_ANNOTATION_POSITION_SIZE) {
				tmpAnnotation.position.rects.push(rect);
				totalLength += length;
			}
			else if (!tmpAnnotation.position.rects.length) {
				throw new Error(`Cannot fit single 'rect' into 'position'`);
			}
			else {
				splitAnnotations.push(tmpAnnotation);
				tmpAnnotation = null;
				i--;
			}
		}
		if (tmpAnnotation) {
			splitAnnotations.push(tmpAnnotation);
		}
	}
	else if (annotation.position.paths) {
		for (let i = 0; i < annotation.position.paths.length; i++) {
			let path = annotation.position.paths[i];
			for (let j = 0; j < path.length; j += 2) {
				if (!tmpAnnotation) {
					tmpAnnotation = JSON.parse(JSON.stringify(annotation));
					tmpAnnotation.position.paths = [[]];
					totalLength = JSON.stringify(tmpAnnotation.position).length;
				}
				let point = [path[j], path[j + 1]];
				// 1,2,
				let length = point.join(',').length + 1;
				if (totalLength + length <= MAX_ANNOTATION_POSITION_SIZE) {
					tmpAnnotation.position.paths[tmpAnnotation.position.paths.length - 1].push(...point);
					totalLength += length;
				}
				else if (tmpAnnotation.position.paths.length === 1
					&& !tmpAnnotation.position.paths[tmpAnnotation.position.paths.length - 1].length) {
					throw new Error(`Cannot fit single point into 'position'`);
				}
				else {
					splitAnnotations.push(tmpAnnotation);
					tmpAnnotation = null;
					j -= 2;
				}
			}
			// If not the last path
			if (i !== annotation.position.paths.length - 1) {
				// [],
				totalLength += 3;
				tmpAnnotation.position.paths.push([]);
			}
		}
		if (tmpAnnotation) {
			splitAnnotations.push(tmpAnnotation);
		}
	}
	return splitAnnotations;
}

function splitAnnotations(annotations) {
	let splitAnnotations = [];
	for (let annotation of annotations) {
		splitAnnotations.push(...splitAnnotation(annotation));
	}
	return splitAnnotations;
}

async function importAnnotations(buf, existingAnnotations, password, transfer, cmapProvider) {
	let pdf = new PDFAssembler();
	await pdf.init(buf, password);
	let pdfDocument = pdf.pdfManager.pdfDocument;
	let structure = await pdf.getPDFStructure();
	let annotations = await readRawAnnotations(structure, pdfDocument);
	let modified = false;

	if (transfer) {
		modified = deleteAnnotations(structure);
	}

	annotations = deduplicate(annotations);

	let imported = transfer ? annotations : getImported(annotations, existingAnnotations);
	let deleted = transfer ? existingAnnotations.map(x => x.id) : getDeleted(annotations, existingAnnotations);

	if (transfer) {
		imported = splitAnnotations(imported);
	}

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
					if (ch.rotation % 90 === 0 && ch.c !== ' ') {
						pageChs.push(ch);
					}
				}
			}
			pageHeight = page.view[3];
		}

		let points = await extractPageLabelPoints(pdfDocument, cmapProvider);
		if (points) {
			// annotation.pageLabel = '-';
			let pageLabel = await extractPageLabel(annotation.position.pageIndex, points, pdfDocument, cmapProvider);
			if (pageLabel) {
				annotation.pageLabel = pageLabel;
			}
		}

		if (!annotation.pageLabel) {
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
			let range = getRangeByHighlight(pageChs, annotation.position.rects);
			if (range) {
				offset = range.offset;
				annotation.text = range.text;

				if (textApproximatelyEqual(annotation.comment, annotation.text)) {
					// Note: Removing comment here might result to external item deletion/re-recreation, because
					// annotaiton will be deduplicated at the top of this function
					annotation.comment = '';
				}
			}
		}
		else if (['note', 'image'].includes(annotation.type)) {
			offset = getClosestOffset(pageChs, annotation.position.rects[0]);
		}
		// Ink
		else {

		}

		let top = 0;
		if (['highlight', 'note', 'image'].includes(annotation.type)) {
			top = pageHeight - annotation.position.rects[0][3];
		}
		// Ink
		else {
			// Flatten path arrays and sort
			let maxY = [].concat.apply([], annotation.position.paths).filter((x, i) => i % 2 === 1).sort()[0];
			top = pageHeight - maxY;
		}

		if (top < 0) {
			top = 0;
		}

		annotation.sortIndex = [
			annotation.position.pageIndex.toString().slice(0, 5).padStart(5, '0'),
			offset.toString().slice(0, 6).padStart(6, '0'),
			Math.floor(top).toString().slice(0, 5).padStart(5, '0')
		].join('|');
	}

	if (transfer && modified) {
		buf = await pdf.assemblePdf('ArrayBuffer');
		return { imported, deleted, buf };
	}

	return { imported, deleted };
}

function replaceReferences(node, refs, ref, visitedNodes = new Set()) {
	if (Array.isArray(node)) {
		visitedNodes.add(node);
		for (let i = 0; i < node.length; i++) {
			let child = node[i];
			if (refs.includes(child)) {
				node.splice(i, 1, ref);
			}
			else if ((typeof child === 'object' || Array.isArray(child))
				&& !visitedNodes.has(child)) {
				replaceReferences(child, refs, ref, visitedNodes);
			}
		}
	}
	else if (typeof node === 'object') {
		visitedNodes.add(node);
		for (let key in node) {
			if (refs.includes(node[key])) {
				node[key] = ref;
			}
			else if ((typeof node[key] === 'object' || Array.isArray(node[key]))
				&& !visitedNodes.has(node[key])) {
				replaceReferences(node[key], refs, ref, visitedNodes);
			}
		}
	}
}

function regeneratePageLabels(structure, pageIndexes) {
	if (typeof structure['/Root']['/PageLabels'] !== 'object'
		|| !Array.isArray(structure['/Root']['/PageLabels']['/Nums'])) {
		return;
	}
	// Validate page label data and create an object with key->value pairs
	// Nums list is [index, object, index, object, …]
	let _nums = structure['/Root']['/PageLabels']['/Nums'];
	if (_nums.length % 2 !== 0) {
		return;
	}
	let nums = {};
	for (let i = 0; i < _nums.length - 1; i += 2) {
		let key = _nums[i];
		let value = _nums[i + 1];
		if (!Number.isInteger(key) || key < 0 || typeof value !== 'object') {
			// Invalid PageLabel data
			return;
		}
		if (value['/St'] !== undefined && (!Number.isInteger(value['/St']) || value['/St'] < 1)) {
			// Invalid start in PageLabel dictionary
			return;
		}
		nums[key] = value;
	}
	// Generate a temporary page label list for each page number
	let allPageDicts = [];
	let currentIndex = 1;
	let numPages = structure['/Root']['/Pages']['/Kids'].length;
	let labelDict;
	for (let i = 0; i < numPages; i++) {
		if (i in nums) {
			labelDict = nums[i];
			if (labelDict['/St']) {
				currentIndex = labelDict['/St'];
			} else {
				currentIndex = 1;
			}
		}
		allPageDicts[i] = { '/St': currentIndex, num: 0, gen: 0 };
		if (labelDict['/S']) {
			allPageDicts[i]['/S'] = labelDict['/S'];
		}
		if (labelDict['/P']) {
			allPageDicts[i]['/P'] = labelDict['/P'];
		}
		currentIndex++;
	}
	// Remove deleted pages from page label list
	for (let pageIndex of pageIndexes) {
		allPageDicts.splice(pageIndex, 1);
	}
	// Compact page label list to remove intermediate values that are calculated anyway
	nums = [];
	let prev;
	for (let i = 0; i < allPageDicts.length; i++) {
		let value = allPageDicts[i];
		if (!prev
			|| prev['/S'] !== value['/S']
			|| prev['/P'] !== value['/P']
			|| prev['/St'] + 1 !== value['/St']) {
			prev = value;
			nums.push(i);
			nums.push(value);
		}
	}
	// Set the regenerated page labels
	structure['/Root']['/PageLabels']['/Nums'] = nums;
}

async function deletePages(buf, pageIndexes, password) {
	let pdf = new PDFAssembler();
	await pdf.init(buf, password);
	let structure = await pdf.getPDFStructure();
	// Deduplicate, sort integers, reverse
	pageIndexes = [...new Set(pageIndexes)].sort((a, b) => a - b).reverse();
	if (structure['/Root']['/PageLabels']) {
		regeneratePageLabels(structure, pageIndexes);
	}
	let deletedPages = [];
	for (let pageIndex of pageIndexes) {
		deletedPages.push(structure['/Root']['/Pages']['/Kids'][pageIndex]);
		structure['/Root']['/Pages']['/Kids'].splice(pageIndex, 1);
	}
	let firstPage = structure['/Root']['/Pages']['/Kids'][0];
	if (!firstPage) {
		throw new Error('At least one page must remain');
	}
	// Replace all deleted page references with the first page reference
	replaceReferences(structure, deletedPages, firstPage);
	return pdf.assemblePdf('ArrayBuffer');
}

async function rotatePages(buf, pageIndexes, degrees, password) {
	if (degrees % 90 !== 0 || degrees < 0) {
		throw new Error('Invalid degrees value');
	}
	let pdf = new PDFAssembler();
	await pdf.init(buf, password);
	let structure = await pdf.getPDFStructure();
	for (let pageIndex of pageIndexes) {
		let rotate = structure['/Root']['/Pages']['/Kids'][pageIndex]['/Rotate'];
		if (!rotate || rotate % 90 !== 0 || rotate < 0) {
			rotate = 0;
		}
		rotate += degrees;
		if (rotate > 360) {
			rotate -= Math.floor(rotate / 360) * 360;
		}
		structure['/Root']['/Pages']['/Kids'][pageIndex]['/Rotate'] = rotate;
	}
	return pdf.assemblePdf('ArrayBuffer');
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
	};
}

async function extractStructure() {

}

/**
 * Based on annotation position data (page index and rect) modifies each
 * annotation object adding or changing the following keys:
 *   * Descriptive page number (1-indexed)
 *   * Extract text content of the highlight from the PDF document (unless
 *     keepText = true)
 *   * Sort index
 *
 * It will also convert highlights that contain no text and are no taller than
 * 20 pixels to annotation type "image" (unless fixTiny = false). This extra
 * processing is used for Mendeley import.
 *
 * @param      {Array}    annotations            Array of annotation
 * @param      {Object}   pdf                    PDF document API
 * @param      {Object}   cmapProvider           cmap provider
 * @param      {Object}   [arg4={}]              Additional configuration
 * @param      {boolean}  [arg4.keepText=false]  Whether to keep text from
 *                                               annotation object rather than
 *                                               extract from pdf object
 * @param      {boolean}  [arg4.fixTiny=false]   Whether to convert certain
 *                                               highlights to image annotation
 *                                               (see above)
 * @return     {Promise}  Promise resolves with no value once all annotations
 *                        have been processed (inline).
 */
async function processAnnotations(annotations, pdf, cmapProvider, { keepText = false, fixTiny = false } = {}) {
	let pageChs;
	let pageHeight;
	let loadedPageIndex = null;
	const pdfDocument = pdf.pdfManager.pdfDocument;
	annotations = splitAnnotations(annotations);

	for (let annotation of annotations) {
		let pageIndex = annotation.position.pageIndex;
		if (loadedPageIndex !== pageIndex) {
			let page = await pdfDocument.getPage(pageIndex);
			let pageItems = await getText(page, cmapProvider);
			loadedPageIndex = pageIndex;
			pageChs = [];
			for (let item of pageItems) {
				for (let ch of item.chars) {
					if (ch.rotation % 90 === 0 && ch.c !== ' ') {
						pageChs.push(ch);
					}
				}
			}
			pageHeight = page.view[3];
		}

		let points = await extractPageLabelPoints(pdfDocument, cmapProvider);
		if (points) {
			// annotation.pageLabel = '-';
			// TODO: Improve extractPageLabel
			let pageLabel = await extractPageLabel(annotation.position.pageIndex, points, pdfDocument, cmapProvider);
			if (pageLabel) {
				annotation.pageLabel = pageLabel;
			}
		}

		if (!annotation.pageLabel) {
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
			let range = getRangeByHighlight(pageChs, annotation.position.rects);
			if (range) {
				offset = range.offset;
				annotation.text = (keepText && annotation.text) ? annotation.text : range.text;
			}
		}
		// 'note'
		else {
			offset = getClosestOffset(pageChs, annotation.position.rects[0]);
		}

		let top = pageHeight - annotation.position.rects[0][3];
		if (top < 0) {
			top = 0;
		}

		annotation.sortIndex = [
			annotation.position.pageIndex.toString().slice(0, 5).padStart(5, '0'),
			offset.toString().slice(0, 6).padStart(6, '0'),
			Math.floor(top).toString().slice(0, 5).padStart(5, '0')
		].join('|');

		if (fixTiny
			&& annotation.position.rects.length === 1
			&& annotation.type === 'highlight'
			// TODO: Consider to remove this minimal height check when range
			//  extraction precision is increased
			&& annotation.position.rects[0][2] - annotation.position.rects[0][0] > 20
			&& !annotation.text) {
			annotation.type = 'image';
			delete annotation.text;
		}
	}
}

async function importCitaviAnnotations(buf, citaviAnnotations, password, cmapProvider) {
	const pdf = new PDFAssembler();
	await pdf.init(buf, password);
	const annotations = citaviAnnotations.map(
		ca => ({
			...ca,
			position: {
				...ca.position,
				rects: ca.position.rects.map(rect => rect.map(n => Math.round(n * 1000) / 1000))
			}
		})
	);
	// Citavi annotations come with "text" field correctly pre-populated hence keepText: true
	await processAnnotations(annotations, pdf, cmapProvider, { keepText: true });
	return annotations;
}

async function importMendeleyAnnotations(buf, mendeleyAnnotations, password, cmapProvider) {
	let pdf = new PDFAssembler();
	await pdf.init(buf, password);
	let pdfDocument = pdf.pdfManager.pdfDocument;

	let annotations = [];
	for (let mendeleyAnnotation of mendeleyAnnotations) {
		try {
			let annotation = { position: {} };
			if (mendeleyAnnotation.id) {
				annotation.id = mendeleyAnnotation.id;
			}
			annotation.position.pageIndex = parseInt(mendeleyAnnotation.page) - 1;
			let page = await pdfDocument.getPage(annotation.position.pageIndex);
			if (!page) {
				continue;
			}
			if (mendeleyAnnotation.type === 'note') {
				let { x, y } = mendeleyAnnotation;
				const NOTE_SIZE = 22;
				let rect = resizeAndFitRect([x, y, x, y], NOTE_SIZE, NOTE_SIZE, page.view);
				annotation.type = 'note';
				annotation.position.rects = [rect.map(n => Math.round(n * 1000) / 1000)];
			}
			else if (mendeleyAnnotation.type === 'highlight') {
				let rects = mendeleyAnnotation.rects.map(rect => {
					return Util
					.normalizeRect([rect.x1, rect.y1, rect.x2, rect.y2])
					.map(n => Math.round(n * 1000) / 1000);
				});
				// Some Mendeley annotations don't have rects, for unknown reason
				if (!rects.length) {
					continue;
				}
				// Sort rects from page top to bottom, left to right
				rects.sort((a, b) => b[1] - a[1] || a[0] - b[0]);

				annotation.type = 'highlight';

				if (rects.length === 1) {
					let rect = rects[0];
					let width = rect[3] - rect[1];
					let height = rect[2] - rect[0];
					let min = Math.min(width, height);
					let max = Math.max(width, height);
					if (min > 30 && max / min < 10) {
						annotation.type = 'image';
					}
				}
				annotation.position.rects = rects;
			}

			annotations.push(annotation);
		}
		catch (e) {
			console.log(e);
		}
	}

	// some Mendeley annotations are incorrectly marked as highlights instead of images. Using
	// fixTiny to convert these to images
	await processAnnotations(annotations, pdf, cmapProvider, { fixTiny: true });
	return annotations;
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

		// console.log('Received message', e.data);

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
			try {
				let { buf, existingAnnotations, password, transfer } = message.data;
				let data = await importAnnotations(buf, existingAnnotations, password, transfer, cmapProvider);
				self.postMessage({ responseID: message.id, data }, data.buf ? [data.buf] : []);
			}
			catch (e) {
				self.postMessage({
					responseID: message.id,
					error: errObject(e)
				}, []);
			}
		}
		else if (message.action === 'importMendeley') {
			try {
				let annotations = await importMendeleyAnnotations(message.data.buf, message.data.mendeleyAnnotations, message.data.password, cmapProvider);
				self.postMessage({
					responseID: message.id,
					data: annotations
				}, []);
			}
			catch (e) {
				self.postMessage({
					responseID: message.id,
					error: errObject(e)
				}, []);
			}
		}
		else if (message.action === 'importCitavi') {
			try {
				let annotations = await importCitaviAnnotations(message.data.buf, message.data.citaviAnnotations, message.data.password, cmapProvider);
				self.postMessage({
					responseID: message.id,
					data: annotations
				}, []);
			}
			catch (e) {
				self.postMessage({
					responseID: message.id,
					error: errObject(e)
				}, []);
			}
		}
		else if (message.action === 'deletePages') {
			try {
				let buf = await deletePages(message.data.buf, message.data.pageIndexes, message.data.password, 0, cmapProvider);
				self.postMessage({ responseID: message.id, data: { buf } }, [buf]);
			}
			catch (e) {
				self.postMessage({
					responseID: message.id,
					error: errObject(e)
				}, []);
			}
		}
		else if (message.action === 'rotatePages') {
			try {
				let buf = await rotatePages(message.data.buf, message.data.pageIndexes, message.data.degrees, message.data.password, 0, cmapProvider);
				self.postMessage({ responseID: message.id, data: { buf } }, [buf]);
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
	importAnnotations,
	deletePages,
	rotatePages,
	extractFulltext,
	extractStructure,
	extractInfo,
	importCitaviAnnotations,
	importMendeleyAnnotations
};
